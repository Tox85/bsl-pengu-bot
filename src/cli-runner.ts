import { WalletManager } from './core/wallet-manager.js';
import { StateManager } from './orchestrator/state.js';
import { retry } from './utils/retry.js';
import { BotError } from './errors/BotError.js';
import { OPERATION_INTENTS } from './utils/operationId.js';
import { logger } from './core/logger.js';

export interface RunFlowOptions {
  simulateStubs?: boolean;
  mnemonicCount?: number;
  concurrency?: number;
  mnemonicIndexStart?: number;
  resume?: boolean;
  fresh?: boolean;
}

export interface WalletResult {
  wallet: string;
  status: 'success' | 'partial' | 'failed';
  steps: string[];
  errorCode?: string;
  txHash?: string;
  durationMs: number;
  retries: number;
}

export interface FlowResult {
  wallets: WalletResult[];
  totalDurationMs: number;
  successCount: number;
  partialCount: number;
  failedCount: number;
}

/**
 * Runner pour exécuter le flow multi-wallet
 */
export class MultiWalletRunner {
  private walletManager: WalletManager;
  private stateManager: StateManager;

  constructor() {
    this.walletManager = new WalletManager();
    this.stateManager = new StateManager();
  }

  /**
   * Exécuter le flow pour plusieurs wallets
   */
  async runFlowForWallets(options: RunFlowOptions = {}): Promise<WalletResult[]> {
    const {
      simulateStubs = false,
      mnemonicCount = 10,
      concurrency = 5,
      mnemonicIndexStart = 0,
      resume = false,
      fresh = false
    } = options;

    const mnemonic = process.env.MNEMONIC || 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    
    logger.info({
      mnemonicCount,
      concurrency,
      simulateStubs,
      message: 'Démarrage du flow multi-wallet'
    });

    const results: WalletResult[] = [];
    const startTime = Date.now();

    // Créer les wallets
    const wallets = [];
    for (let i = mnemonicIndexStart; i < mnemonicIndexStart + mnemonicCount; i++) {
      try {
        const walletInfo = await this.walletManager.createOrLoadWallet(mnemonic, i);
        wallets.push(walletInfo);
      } catch (error) {
        logger.error({
          index: i,
          error: error instanceof Error ? error.message : 'Unknown error',
          message: 'Erreur lors de la création du wallet'
        });
        results.push({
          wallet: `wallet-${i}`,
          status: 'failed',
          steps: [],
          errorCode: 'WALLET_CREATION_FAILED',
          durationMs: 0,
          retries: 0
        });
      }
    }

    // Exécuter le flow pour chaque wallet avec concurrence limitée
    const semaphore = new Array(concurrency).fill(null);
    const walletPromises = wallets.map(async (walletInfo, index) => {
      // Attendre qu'un slot soit disponible
      const slotIndex = index % concurrency;
      await semaphore[slotIndex];
      
      // Exécuter le flow pour ce wallet
      semaphore[slotIndex] = this.runFlowForWallet(walletInfo, simulateStubs, resume, fresh);
      const result = await semaphore[slotIndex];
      semaphore[slotIndex] = null;
      
      return result;
    });

    const walletResults = await Promise.all(walletPromises);
    results.push(...walletResults);

    const totalDuration = Date.now() - startTime;
    logger.info({
      totalDuration,
      successCount: results.filter(r => r.status === 'success').length,
      partialCount: results.filter(r => r.status === 'partial').length,
      failedCount: results.filter(r => r.status === 'failed').length,
      message: 'Flow multi-wallet terminé'
    });

    return results;
  }

  /**
   * Exécuter le flow pour un wallet individuel
   */
  private async runFlowForWallet(
    walletInfo: { address: string; signer: any; nonceManager: any },
    simulateStubs: boolean,
    resume: boolean,
    fresh: boolean
  ): Promise<WalletResult> {
    const startTime = Date.now();
    const steps: string[] = [];
    let retries = 0;
    let status: 'success' | 'partial' | 'failed' = 'success';
    let errorCode: string | undefined;
    let txHash: string | undefined;

    try {
      // Charger l'état existant si resume
      let state = this.stateManager.loadState(walletInfo.address);
      if (fresh || !state) {
        state = this.stateManager.createState(walletInfo.address);
      }

      // Bridge
      if (!resume || state.currentStep === 'idle') {
        await this.executeBridge(walletInfo, simulateStubs);
        steps.push('bridge');
        state.currentStep = 'bridge_done';
        this.stateManager.saveState(state);
      }

      // Swap
      if (!resume || state.currentStep === 'bridge_done') {
        await this.executeSwap(walletInfo, simulateStubs);
        steps.push('swap');
        state.currentStep = 'swap_done';
        this.stateManager.saveState(state);
      }

      // LP
      if (!resume || state.currentStep === 'swap_done') {
        await this.executeLP(walletInfo, simulateStubs);
        steps.push('lp');
        state.currentStep = 'lp_done';
        this.stateManager.saveState(state);
      }

      // Collect
      if (!resume || state.currentStep === 'lp_done') {
        await this.executeCollect(walletInfo, simulateStubs);
        steps.push('collect');
        state.currentStep = 'collect_done';
        this.stateManager.saveState(state);
      }

    } catch (error) {
      status = 'partial';
      if (error instanceof BotError) {
        errorCode = error.code;
      } else {
        errorCode = 'UNKNOWN';
      }
      
      logger.error({
        wallet: walletInfo.address,
        error: error instanceof Error ? error.message : 'Unknown error',
        steps,
        message: 'Erreur lors de l\'exécution du flow'
      });
    }

    return {
      wallet: walletInfo.address,
      status,
      steps,
      errorCode,
      txHash,
      durationMs: Date.now() - startTime,
      retries
    };
  }

  /**
   * Exécuter l'étape bridge
   */
  private async executeBridge(walletInfo: any, simulateStubs: boolean): Promise<void> {
    if (simulateStubs) {
      // Simuler un bridge réussi
      await new Promise(resolve => setTimeout(resolve, 100));
      logger.debug({
        wallet: walletInfo.address,
        message: 'Bridge simulé réussi'
      });
      return;
    }

    // Ici on appellerait le vrai service de bridge
    throw new BotError('UNKNOWN', 'Bridge non implémenté en mode réel');
  }

  /**
   * Exécuter l'étape swap
   */
  private async executeSwap(walletInfo: any, simulateStubs: boolean): Promise<void> {
    if (simulateStubs) {
      // Simuler un swap réussi
      await new Promise(resolve => setTimeout(resolve, 100));
      logger.debug({
        wallet: walletInfo.address,
        message: 'Swap simulé réussi'
      });
      return;
    }

    // Ici on appellerait le vrai service de swap
    throw new BotError('UNKNOWN', 'Swap non implémenté en mode réel');
  }

  /**
   * Exécuter l'étape LP
   */
  private async executeLP(walletInfo: any, simulateStubs: boolean): Promise<void> {
    if (simulateStubs) {
      // Simuler une création de position LP réussi
      await new Promise(resolve => setTimeout(resolve, 100));
      logger.debug({
        wallet: walletInfo.address,
        message: 'LP simulé réussi'
      });
      return;
    }

    // Ici on appellerait le vrai service de LP
    throw new BotError('UNKNOWN', 'LP non implémenté en mode réel');
  }

  /**
   * Exécuter l'étape collect
   */
  private async executeCollect(walletInfo: any, simulateStubs: boolean): Promise<void> {
    if (simulateStubs) {
      // Simuler un collect réussi
      await new Promise(resolve => setTimeout(resolve, 100));
      logger.debug({
        wallet: walletInfo.address,
        message: 'Collect simulé réussi'
      });
      return;
    }

    // Ici on appellerait le vrai service de collect
    throw new BotError('UNKNOWN', 'Collect non implémenté en mode réel');
  }
}

// Fonction de convenance pour les tests
export async function runFlowForWallets(options: RunFlowOptions = {}): Promise<WalletResult[]> {
  const runner = new MultiWalletRunner();
  return runner.runFlowForWallets(options);
}

