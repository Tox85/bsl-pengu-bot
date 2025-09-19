#!/usr/bin/env node

import { Command } from 'commander';
import { liquidityPositionService } from '../lp/index.js';
import { CONSTANTS } from '../config/env.js';
import { logger } from '../core/logger.js';
import { parseAmount, formatAmount } from '../core/math.js';

const program = new Command();

program
  .name('lp')
  .description('CLI pour le module LP concentrée (Uniswap v3)')
  .version('1.0.0');

program
  .command('add')
  .description('Créer une position LP concentrée')
  .requiredOption('--privateKey <key>', 'Clé privée du wallet')
  .requiredOption('--pair <pair>', 'Paire de tokens (PENGU/ETH|PENGU/USDC)')
  .requiredOption('--pct <percent>', 'Range en pourcentage (±5%)')
  .requiredOption('--amount0 <amount>', 'Montant du token0')
  .requiredOption('--amount1 <amount>', 'Montant du token1')
  .option('--fee <fee>', 'Fee tier du pool (500|3000|10000)', '0')
  .option('--dry-run', 'Mode simulation (pas de transaction réelle)', false)
  .action(async (options) => {
    try {
      logger.info({
        pair: options.pair,
        pct: options.pct,
        amount0: options.amount0,
        amount1: options.amount1,
        fee: options.fee,
        dryRun: options.dryRun,
        message: 'Création de position LP'
      });

      const { token0, token1 } = getPairTokens(options.pair);
      const amount0Desired = parseAmount(options.amount0, 18);
      const amount1Desired = parseAmount(options.amount1, 18);

      // Obtenir les informations du pool pour calculer le range
      const pool = await getPoolInfo(token0, token1, options.fee ? parseInt(options.fee) : undefined);

      // Calculer le range de ticks
      const { tickLower, tickUpper } = liquidityPositionService.calculateTickRange({
        currentTick: pool.tick,
        tickSpacing: pool.tickSpacing,
        rangePercent: parseFloat(options.pct),
      });

      const result = await liquidityPositionService.createPosition({
        token0,
        token1,
        fee: pool.fee,
        tickLower,
        tickUpper,
        amount0Desired,
        amount1Desired,
        amount0Min: 0n, // Pas de slippage pour le test
        amount1Min: 0n, // Pas de slippage pour le test
        recipient: '0x0000000000000000000000000000000000000000', // Sera remplacé par l'adresse du wallet
        deadline: Math.floor(Date.now() / 1000) + 600, // 10 minutes
      }, options.privateKey, {
        dryRun: options.dryRun,
      });

      if (result.success) {
        console.log('\n✅ Position LP créée avec succès!');
        console.log(`  Token0: ${token0}`);
        console.log(`  Token1: ${token1}`);
        console.log(`  Fee: ${pool.fee} (${pool.fee / 100}%)`);
        console.log(`  Tick Lower: ${tickLower}`);
        console.log(`  Tick Upper: ${tickUpper}`);
        console.log(`  Montant0: ${formatAmount(amount0Desired, 18)}`);
        console.log(`  Montant1: ${formatAmount(amount1Desired, 18)}`);
        if (result.tokenId) {
          console.log(`  Token ID: ${result.tokenId.toString()}`);
        }
        if (result.liquidity) {
          console.log(`  Liquidité: ${result.liquidity.toString()}`);
        }
        if (result.txHash) {
          console.log(`  TX Hash: ${result.txHash}`);
        }
      } else {
        console.log('\n❌ Création de position échouée:');
        console.log(`  Erreur: ${result.error}`);
        process.exit(1);
      }

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : 'Unknown error',
        message: 'Erreur lors de la création de position'
      });
      process.exit(1);
    }
  });

program
  .command('collect')
  .description('Collecter les frais d\'une position')
  .requiredOption('--privateKey <key>', 'Clé privée du wallet')
  .requiredOption('--tokenId <id>', 'ID de la position')
  .option('--dry-run', 'Mode simulation (pas de transaction réelle)', false)
  .action(async (options) => {
    try {
      logger.info({
        tokenId: options.tokenId,
        dryRun: options.dryRun,
        message: 'Collecte des frais'
      });

      const tokenId = BigInt(options.tokenId);

      const result = await liquidityPositionService.collectFees({
        tokenId,
        recipient: '0x0000000000000000000000000000000000000000', // Sera remplacé par l'adresse du wallet
        amount0Max: ethers.MaxUint128, // Collecter tous les frais
        amount1Max: ethers.MaxUint128, // Collecter tous les frais
      }, options.privateKey, {
        dryRun: options.dryRun,
      });

      if (result.success) {
        console.log('\n✅ Frais collectés avec succès!');
        console.log(`  Token ID: ${tokenId.toString()}`);
        if (result.amount0) {
          console.log(`  Montant0: ${result.amount0.toString()}`);
        }
        if (result.amount1) {
          console.log(`  Montant1: ${result.amount1.toString()}`);
        }
        if (result.txHash) {
          console.log(`  TX Hash: ${result.txHash}`);
        }
      } else {
        console.log('\n❌ Collecte des frais échouée:');
        console.log(`  Erreur: ${result.error}`);
        process.exit(1);
      }

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : 'Unknown error',
        message: 'Erreur lors de la collecte des frais'
      });
      process.exit(1);
    }
  });

program
  .command('info')
  .description('Obtenir les informations d\'une position')
  .requiredOption('--tokenId <id>', 'ID de la position')
  .action(async (options) => {
    try {
      logger.info({
        tokenId: options.tokenId,
        message: 'Récupération des informations de position'
      });

      const tokenId = BigInt(options.tokenId);
      const position = await liquidityPositionService.getPosition(tokenId);

      console.log('\n📊 Informations de position:');
      console.log(`  Token ID: ${position.tokenId.toString()}`);
      console.log(`  Token0: ${position.token0}`);
      console.log(`  Token1: ${position.token1}`);
      console.log(`  Fee: ${position.fee} (${position.fee / 100}%)`);
      console.log(`  Tick Lower: ${position.tickLower}`);
      console.log(`  Tick Upper: ${position.tickUpper}`);
      console.log(`  Liquidité: ${position.liquidity.toString()}`);
      console.log(`  Frais Owed0: ${position.tokensOwed0.toString()}`);
      console.log(`  Frais Owed1: ${position.tokensOwed1.toString()}`);

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : 'Unknown error',
        message: 'Erreur lors de la récupération des informations'
      });
      process.exit(1);
    }
  });

program
  .command('increase')
  .description('Augmenter la liquidité d\'une position')
  .requiredOption('--privateKey <key>', 'Clé privée du wallet')
  .requiredOption('--tokenId <id>', 'ID de la position')
  .requiredOption('--amount0 <amount>', 'Montant du token0 à ajouter')
  .requiredOption('--amount1 <amount>', 'Montant du token1 à ajouter')
  .option('--dry-run', 'Mode simulation (pas de transaction réelle)', false)
  .action(async (options) => {
    try {
      logger.info({
        tokenId: options.tokenId,
        amount0: options.amount0,
        amount1: options.amount1,
        dryRun: options.dryRun,
        message: 'Augmentation de liquidité'
      });

      const tokenId = BigInt(options.tokenId);
      const amount0Desired = parseAmount(options.amount0, 18);
      const amount1Desired = parseAmount(options.amount1, 18);

      const result = await liquidityPositionService.increaseLiquidity({
        tokenId,
        amount0Desired,
        amount1Desired,
        amount0Min: 0n, // Pas de slippage pour le test
        amount1Min: 0n, // Pas de slippage pour le test
        deadline: Math.floor(Date.now() / 1000) + 600, // 10 minutes
      }, options.privateKey, {
        dryRun: options.dryRun,
      });

      if (result.success) {
        console.log('\n✅ Liquidité augmentée avec succès!');
        console.log(`  Token ID: ${tokenId.toString()}`);
        if (result.amount0) {
          console.log(`  Montant0: ${result.amount0.toString()}`);
        }
        if (result.amount1) {
          console.log(`  Montant1: ${result.amount1.toString()}`);
        }
        if (result.liquidity) {
          console.log(`  Liquidité: ${result.liquidity.toString()}`);
        }
        if (result.txHash) {
          console.log(`  TX Hash: ${result.txHash}`);
        }
      } else {
        console.log('\n❌ Augmentation de liquidité échouée:');
        console.log(`  Erreur: ${result.error}`);
        process.exit(1);
      }

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : 'Unknown error',
        message: 'Erreur lors de l\'augmentation de liquidité'
      });
      process.exit(1);
    }
  });

program
  .command('decrease')
  .description('Diminuer la liquidité d\'une position')
  .requiredOption('--privateKey <key>', 'Clé privée du wallet')
  .requiredOption('--tokenId <id>', 'ID de la position')
  .requiredOption('--liquidity <amount>', 'Montant de liquidité à retirer')
  .option('--dry-run', 'Mode simulation (pas de transaction réelle)', false)
  .action(async (options) => {
    try {
      logger.info({
        tokenId: options.tokenId,
        liquidity: options.liquidity,
        dryRun: options.dryRun,
        message: 'Diminution de liquidité'
      });

      const tokenId = BigInt(options.tokenId);
      const liquidity = BigInt(options.liquidity);

      const result = await liquidityPositionService.decreaseLiquidity({
        tokenId,
        liquidity,
        amount0Min: 0n, // Pas de slippage pour le test
        amount1Min: 0n, // Pas de slippage pour le test
        deadline: Math.floor(Date.now() / 1000) + 600, // 10 minutes
      }, options.privateKey, {
        dryRun: options.dryRun,
      });

      if (result.success) {
        console.log('\n✅ Liquidité diminuée avec succès!');
        console.log(`  Token ID: ${tokenId.toString()}`);
        if (result.amount0) {
          console.log(`  Montant0: ${result.amount0.toString()}`);
        }
        if (result.amount1) {
          console.log(`  Montant1: ${result.amount1.toString()}`);
        }
        if (result.txHash) {
          console.log(`  TX Hash: ${result.txHash}`);
        }
      } else {
        console.log('\n❌ Diminution de liquidité échouée:');
        console.log(`  Erreur: ${result.error}`);
        process.exit(1);
      }

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : 'Unknown error',
        message: 'Erreur lors de la diminution de liquidité'
      });
      process.exit(1);
    }
  });

// Fonction utilitaire pour obtenir les tokens d'une paire
function getPairTokens(pair: string): { token0: string; token1: string } {
  const [token0Symbol, token1Symbol] = pair.split('/');
  
  const token0 = getTokenAddress(token0Symbol);
  const token1 = getTokenAddress(token1Symbol);
  
  return { token0, token1 };
}

// Fonction utilitaire pour obtenir l'adresse d'un token
function getTokenAddress(token: string): string {
  switch (token.toUpperCase()) {
    case 'ETH':
      return CONSTANTS.NATIVE_ADDRESS;
    case 'USDC':
      return CONSTANTS.TOKENS.USDC;
    case 'PENGU':
      return CONSTANTS.TOKENS.PENGU;
    default:
      throw new Error(`Token non supporté: ${token}`);
  }
}

// Fonction utilitaire pour obtenir les informations du pool
async function getPoolInfo(token0: string, token1: string, fee?: number): Promise<any> {
  // Cette fonction devrait utiliser le service de découverte de pools
  // Pour simplifier, on retourne des valeurs par défaut
  return {
    address: '0x0000000000000000000000000000000000000000',
    token0,
    token1,
    fee: fee || 3000,
    tickSpacing: 60,
    liquidity: 0n,
    sqrtPriceX96: 0n,
    tick: 0,
  };
}

// Parser les arguments de la ligne de commande
program.parse();
