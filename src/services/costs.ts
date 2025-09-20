import { ethers } from 'ethers';
import { logger } from '../core/logger.js';
import { tokenService } from './token.js';
import { CONSTANTS } from '../config/env.js';
import type { OrchestratorState } from '../orchestrator/types.js';

export interface CostMetrics {
  base: {
    ethDelta: string; // ΔETH en Base (peut être négatif)
    gasUsed: bigint;
    gasCost: string; // Coût total du gas en ETH
  };
  abstract: {
    ethDelta: string; // ΔETH en Abstract
    gasUsed: bigint;
    gasCost: string;
  };
  tokens: {
    usdcDelta: string; // ΔUSDC.e
    penguDelta: string; // ΔPENGU
    wethDelta: string; // ΔWETH (si applicable)
  };
  total: {
    duration: number; // Durée totale en ms
    totalGasUsed: bigint;
    totalGasCost: string;
  };
}

// Service de reporting des coûts
export class CostsReporter {
  private startTime: number;
  private startBalances: {
    base: { eth: bigint };
    abstract: { eth: bigint; usdc: bigint; pengu: bigint; weth: bigint };
  } = {
    base: { eth: 0n },
    abstract: { eth: 0n, usdc: 0n, pengu: 0n, weth: 0n }
  };

  constructor() {
    this.startTime = Date.now();
  }

  // Initialiser les soldes de départ
  async initializeBalances(walletAddress: string): Promise<void> {
    try {
      logger.info({
        wallet: walletAddress,
        message: 'Initialisation des soldes de départ pour le calcul des coûts'
      });

      // Base
      this.startBalances.base.eth = await tokenService.getNativeBalance(
        walletAddress, 
        CONSTANTS.CHAIN_IDS.BASE
      );

      // Abstract
      this.startBalances.abstract.eth = await tokenService.getNativeBalance(
        walletAddress, 
        CONSTANTS.CHAIN_IDS.ABSTRACT
      );

      this.startBalances.abstract.usdc = (await tokenService.getTokenBalance(
        CONSTANTS.TOKENS.USDC,
        walletAddress,
        CONSTANTS.CHAIN_IDS.ABSTRACT
      )).balance;

      this.startBalances.abstract.pengu = (await tokenService.getTokenBalance(
        CONSTANTS.TOKENS.PENGU,
        walletAddress,
        CONSTANTS.CHAIN_IDS.ABSTRACT
      )).balance;

      this.startBalances.abstract.weth = (await tokenService.getTokenBalance(
        CONSTANTS.TOKENS.WETH,
        walletAddress,
        CONSTANTS.CHAIN_IDS.ABSTRACT
      )).balance;

      logger.info({
        wallet: walletAddress,
        baseEth: ethers.formatEther(this.startBalances.base.eth),
        abstractEth: ethers.formatEther(this.startBalances.abstract.eth),
        abstractUsdc: ethers.formatUnits(this.startBalances.abstract.usdc, 6),
        abstractPengu: ethers.formatUnits(this.startBalances.abstract.pengu, 18),
        abstractWeth: ethers.formatEther(this.startBalances.abstract.weth),
        message: 'Soldes de départ enregistrés'
      });

    } catch (error) {
      logger.warn({
        wallet: walletAddress,
        error: error instanceof Error ? error.message : 'Unknown error',
        message: 'Impossible d\'initialiser tous les soldes de départ'
      });
    }
  }

  // Calculer et afficher le bilan des coûts
  async generateReport(
    walletAddress: string,
    state: OrchestratorState
  ): Promise<CostMetrics> {
    const endTime = Date.now();
    const duration = endTime - this.startTime;

    try {
      // Obtenir les soldes finaux
      const endBalances = {
        base: { eth: await tokenService.getNativeBalance(walletAddress, CONSTANTS.CHAIN_IDS.BASE) },
        abstract: {
          eth: await tokenService.getNativeBalance(walletAddress, CONSTANTS.CHAIN_IDS.ABSTRACT),
          usdc: (await tokenService.getTokenBalance(CONSTANTS.TOKENS.USDC, walletAddress, CONSTANTS.CHAIN_IDS.ABSTRACT)).balance,
          pengu: (await tokenService.getTokenBalance(CONSTANTS.TOKENS.PENGU, walletAddress, CONSTANTS.CHAIN_IDS.ABSTRACT)).balance,
          weth: (await tokenService.getTokenBalance(CONSTANTS.TOKENS.WETH, walletAddress, CONSTANTS.CHAIN_IDS.ABSTRACT)).balance,
        }
      };

      // Calculer les deltas
      const baseEthDelta = endBalances.base.eth - this.startBalances.base.eth;
      const abstractEthDelta = endBalances.abstract.eth - this.startBalances.abstract.eth;
      const usdcDelta = endBalances.abstract.usdc - this.startBalances.abstract.usdc;
      const penguDelta = endBalances.abstract.pengu - this.startBalances.abstract.pengu;
      const wethDelta = endBalances.abstract.weth - this.startBalances.abstract.weth;

      // Calculer le gas utilisé (simplifié - en réalité il faudrait parser les receipts)
      const totalGasUsed = this.calculateTotalGasUsed(state);
      const totalGasCost = this.calculateTotalGasCost(state);

      const metrics: CostMetrics = {
        base: {
          ethDelta: ethers.formatEther(baseEthDelta),
          gasUsed: 0n, // TODO: Calculer depuis les receipts
          gasCost: "0", // TODO: Calculer depuis les receipts
        },
        abstract: {
          ethDelta: ethers.formatEther(abstractEthDelta),
          gasUsed: totalGasUsed,
          gasCost: ethers.formatEther(totalGasCost),
        },
        tokens: {
          usdcDelta: ethers.formatUnits(usdcDelta, 6),
          penguDelta: ethers.formatUnits(penguDelta, 18),
          wethDelta: ethers.formatEther(wethDelta),
        },
        total: {
          duration,
          totalGasUsed,
          totalGasCost: ethers.formatEther(totalGasCost),
        }
      };

      // Afficher le rapport
      this.displayReport(metrics, state);

      return metrics;

    } catch (error) {
      logger.error({
        wallet: walletAddress,
        error: error instanceof Error ? error.message : 'Unknown error',
        message: 'Erreur lors de la génération du rapport de coûts'
      });

      // Retourner un rapport vide en cas d'erreur
      return {
        base: { ethDelta: "0", gasUsed: 0n, gasCost: "0" },
        abstract: { ethDelta: "0", gasUsed: 0n, gasCost: "0" },
        tokens: { usdcDelta: "0", penguDelta: "0", wethDelta: "0" },
        total: { duration, totalGasUsed: 0n, totalGasCost: "0" }
      };
    }
  }

  // Calculer le gas total utilisé (simplifié)
  private calculateTotalGasUsed(state: OrchestratorState): bigint {
    // En réalité, il faudrait parser les receipts des transactions
    // Pour l'instant, on retourne 0
    return 0n;
  }

  // Calculer le coût total du gas (simplifié)
  private calculateTotalGasCost(state: OrchestratorState): bigint {
    // En réalité, il faudrait parser les receipts et calculer gasUsed * gasPrice
    // Pour l'instant, on retourne 0
    return 0n;
  }

  // Afficher le rapport de coûts
  private displayReport(metrics: CostMetrics, state: OrchestratorState): void {
    console.log('\n📊 BILAN DES COÛTS');
    console.log('═'.repeat(50));

    // Base
    console.log(`\n🔵 Base:`);
    console.log(`  ΔETH: ${metrics.base.ethDelta} ETH`);
    console.log(`  Gas utilisé: ${metrics.base.gasUsed.toString()}`);
    console.log(`  Coût gas: ${metrics.base.gasCost} ETH`);

    // Abstract
    console.log(`\n🟣 Abstract:`);
    console.log(`  ΔETH: ${metrics.abstract.ethDelta} ETH`);
    console.log(`  Gas utilisé: ${metrics.abstract.gasUsed.toString()}`);
    console.log(`  Coût gas: ${metrics.abstract.gasCost} ETH`);

    // Tokens
    console.log(`\n🪙 Tokens:`);
    console.log(`  ΔUSDC.e: ${metrics.tokens.usdcDelta}`);
    console.log(`  ΔPENGU: ${metrics.tokens.penguDelta}`);
    console.log(`  ΔWETH: ${metrics.tokens.wethDelta}`);

    // Total
    console.log(`\n⏱️  Total:`);
    console.log(`  Durée: ${metrics.total.duration}ms`);
    console.log(`  Gas total: ${metrics.total.totalGasUsed.toString()}`);
    console.log(`  Coût total: ${metrics.total.totalGasCost} ETH`);

    // Résumé des étapes
    console.log(`\n📋 Étapes exécutées:`);
    if (state.bridgeResult?.success) {
      console.log(`  ✅ Bridge: ${state.bridgeResult.txHash}`);
    }
    if (state.swapResult?.success) {
      console.log(`  ✅ Swap: ${state.swapResult.txHash}`);
    }
    if (state.positionResult?.success) {
      console.log(`  ✅ LP: ${state.positionResult.txHash} (TokenID: ${state.positionResult.tokenId})`);
    }
    if (state.collectResult?.success) {
      console.log(`  ✅ Collect: ${state.collectResult.txHash}`);
    }

    console.log('═'.repeat(50));
  }
}

// Instance singleton du reporter de coûts
export const costsReporter = new CostsReporter();
