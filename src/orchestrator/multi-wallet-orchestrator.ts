import { ethers } from 'ethers';
import { logger } from '../core/logger.js';
import { WalletManager, type WalletInfo } from '../core/wallet-manager.js';
import { HubDistributor, type HubDistributionConfig } from '../cex/hub-distributor.js';
import { CONSTANTS, cfg } from '../config/env.js';
import { buildContext, type BotContext } from '../core/context.js';
import { OrchestratorService } from './run.js';
import type {
  OrchestratorParams,
  OrchestratorResult,
  OrchestratorState
} from './types.js';
import { OrchestratorStep } from './types.js';

/**
 * Configuration pour l'orchestrateur multi-wallet
 */
export interface MultiWalletOrchestratorConfig {
  // Configuration de distribution
  distributionConfig: HubDistributionConfig;
  
  // Configuration des wallets
  walletCount: number;
  mnemonic: string;
  
  // Mode d'exécution
  sequential: boolean; // true = un wallet après l'autre, false = parallèle
  maxConcurrentWallets?: number; // limite pour l'exécution parallèle
  
  // Paramètres DeFi pour chaque wallet
  defiParams: Omit<OrchestratorParams, 'privateKey'>;
}

/**
 * Résultat de l'orchestration multi-wallet
 */
export interface MultiWalletResult {
  success: boolean;
  totalWallets: number;
  successfulWallets: number;
  failedWallets: number;
  results: Array<{
    wallet: string;
    success: boolean;
    result?: OrchestratorResult;
    error?: string;
  }>;
  distributionResult?: any;
  errors: string[];
}

/**
 * Orchestrateur pour la gestion multi-wallet
 */
export class MultiWalletOrchestrator {
  private walletManager: WalletManager;
  private hubDistributor: HubDistributor;
  private orchestratorService: OrchestratorService;
  private config: MultiWalletOrchestratorConfig;

  constructor(config: MultiWalletOrchestratorConfig) {
    this.config = config;
    this.walletManager = new WalletManager();
    this.hubDistributor = new HubDistributor(config.distributionConfig);
    this.orchestratorService = new OrchestratorService();

    logger.info({
      walletCount: config.walletCount,
      sequential: config.sequential,
      maxConcurrent: config.maxConcurrentWallets,
      message: 'MultiWalletOrchestrator initialisé'
    });
  }

  /**
   * Exécuter l'orchestration complète multi-wallet
   */
  async execute(): Promise<MultiWalletResult> {
    const result: MultiWalletResult = {
      success: false,
      totalWallets: 0,
      successfulWallets: 0,
      failedWallets: 0,
      results: [],
      errors: [],
    };

    try {
      // Étape 1: Créer les wallets depuis le mnémonique
      logger.info({
        walletCount: this.config.walletCount,
        message: 'Création des wallets depuis le mnémonique'
      });

      const wallets = this.walletManager.createMultipleWallets(
        this.config.mnemonic,
        this.config.walletCount,
        0
      );

      result.totalWallets = wallets.length;

      // Étape 2: Distribution des fonds depuis Bybit via le Hub
      logger.info({
        walletCount: wallets.length,
        message: 'Début de la distribution des fonds'
      });

      const distributionResult = await this.hubDistributor.executeFullDistribution(wallets);
      result.distributionResult = distributionResult;

      if (!distributionResult.success) {
        result.errors.push(...distributionResult.errors);
        logger.error({
          errors: distributionResult.errors,
          message: 'Distribution des fonds échouée'
        });
        // Continuer quand même avec les wallets qui ont reçu des fonds
      }

      // Étape 3: Exécution des opérations DeFi pour chaque wallet
      logger.info({
        walletCount: wallets.length,
        sequential: this.config.sequential,
        message: 'Début des opérations DeFi par wallet'
      });

      if (this.config.sequential) {
        // Exécution séquentielle
        await this.executeSequential(wallets, result);
      } else {
        // Exécution parallèle
        await this.executeParallel(wallets, result);
      }

      // Calculer les statistiques finales
      result.successfulWallets = result.results.filter(r => r.success).length;
      result.failedWallets = result.results.filter(r => !r.success).length;
      result.success = result.failedWallets === 0;

      logger.info({
        totalWallets: result.totalWallets,
        successfulWallets: result.successfulWallets,
        failedWallets: result.failedWallets,
        success: result.success,
        message: 'Orchestration multi-wallet terminée'
      });

      const walletSummaries = result.results.map(item => ({
        wallet: item.wallet,
        status: item.success ? 'success' : 'failed',
        finalStep: item.result?.state.currentStep ?? OrchestratorStep.ERROR,
        skippedReason: item.result?.state.collectResult?.skippedReason,
        error: item.error || item.result?.error,
      }));

      logger.info({
        message: 'Résumé multi-wallet',
        totals: {
          total: result.totalWallets,
          success: result.successfulWallets,
          failed: result.failedWallets,
        },
        wallets: walletSummaries,
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.errors.push(`Erreur générale: ${errorMessage}`);
      logger.error({
        error: errorMessage,
        message: 'Erreur lors de l\'orchestration multi-wallet'
      });
    }

    return result;
  }

  /**
   * Exécution séquentielle des wallets
   */
  private async executeSequential(wallets: WalletInfo[], result: MultiWalletResult): Promise<void> {
    for (const walletInfo of wallets) {
      try {
        logger.info({
          wallet: walletInfo.address,
          index: walletInfo.index,
          message: 'Exécution séquentielle du wallet'
        });

        const defiResult = await this.executeWalletDefiSequence(walletInfo);
        
        result.results.push({
          wallet: walletInfo.address,
          success: defiResult.success,
          result: defiResult,
        });

        if (defiResult.success) {
          logger.info({
            wallet: walletInfo.address,
            message: 'Wallet traité avec succès'
          });
        } else {
          logger.warn({
            wallet: walletInfo.address,
            error: defiResult.error,
            message: 'Wallet échoué'
          });
        }

        // Petite pause entre les wallets pour éviter le rate limiting
        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        result.results.push({
          wallet: walletInfo.address,
          success: false,
          error: errorMessage,
        });
        
        logger.error({
          wallet: walletInfo.address,
          error: errorMessage,
          message: 'Erreur lors du traitement du wallet'
        });
      }
    }
  }

  /**
   * Exécution parallèle des wallets
   */
  private async executeParallel(wallets: WalletInfo[], result: MultiWalletResult): Promise<void> {
    const maxConcurrent = this.config.maxConcurrentWallets || 5;
    const chunks = this.chunkArray(wallets, maxConcurrent);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      
      logger.info({
        chunkIndex: i + 1,
        totalChunks: chunks.length,
        chunkSize: chunk.length,
        message: 'Exécution parallèle du chunk de wallets'
      });

      // Exécuter le chunk en parallèle
      const chunkPromises = chunk.map(async (walletInfo) => {
        try {
          logger.info({
            wallet: walletInfo.address,
            index: walletInfo.index,
            message: 'Exécution parallèle du wallet'
          });

          const defiResult = await this.executeWalletDefiSequence(walletInfo);
          
          return {
            wallet: walletInfo.address,
            success: defiResult.success,
            result: defiResult,
          };

        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          
          logger.error({
            wallet: walletInfo.address,
            error: errorMessage,
            message: 'Erreur lors du traitement parallèle du wallet'
          });

          return {
            wallet: walletInfo.address,
            success: false,
            error: errorMessage,
          };
        }
      });

      // Attendre que tous les wallets du chunk soient traités
      const chunkResults = await Promise.all(chunkPromises);
      result.results.push(...chunkResults);

      // Pause entre les chunks
      if (i < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }

  /**
   * Exécuter la séquence DeFi pour un wallet spécifique
   */
  private async executeWalletDefiSequence(walletInfo: WalletInfo): Promise<OrchestratorResult> {
    // Créer les paramètres pour ce wallet spécifique
    const walletParams: OrchestratorParams = {
      ...this.config.defiParams,
      privateKey: walletInfo.wallet.privateKey,
    };

    // Créer le contexte pour ce wallet
    const context = buildContext({
      privateKey: walletInfo.wallet.privateKey,
      autoGasTopUp: this.config.defiParams.autoGasTopUp,
      fresh: false,
      dryRun: this.config.defiParams.dryRun,
      minNativeOnDest: this.config.defiParams.minNativeOnDest,
      gasTopUpTarget: this.config.defiParams.gasTopUpTarget,
      routerOverride: this.config.defiParams.routerOverride,
      npmOverride: this.config.defiParams.npmOverride,
      factoryOverride: this.config.defiParams.factoryOverride,
      autoTokenTopUp: this.config.defiParams.autoTokenTopUp,
      tokenTopUpSafetyBps: this.config.defiParams.tokenTopUpSafetyBps,
      tokenTopUpMin: this.config.defiParams.tokenTopUpMin,
      tokenTopUpSourceChainId: this.config.defiParams.tokenTopUpSourceChainId,
      tokenTopUpMaxWaitSec: this.config.defiParams.tokenTopUpMaxWaitSec,
    });

    // Exécuter la séquence DeFi standard
    return await this.orchestratorService.run(walletParams);
  }

  /**
   * Diviser un tableau en chunks
   */
  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  /**
   * Obtenir des statistiques sur les wallets
   */
  getWalletStats(): {
    totalWallets: number;
    addresses: string[];
    nonceStats: Record<string, number>;
  } {
    return this.walletManager.getStats();
  }

  /**
   * Vérifier les balances du Hub
   */
  async checkHubBalances(): Promise<{ usdc: number; eth: number }> {
    return await this.hubDistributor.checkHubBalances();
  }
}

/**
 * Factory pour créer un orchestrateur multi-wallet
 */
export function createMultiWalletOrchestrator(config: MultiWalletOrchestratorConfig): MultiWalletOrchestrator {
  return new MultiWalletOrchestrator(config);
}
