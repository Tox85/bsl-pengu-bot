import { promises as fs } from 'fs';
import { join } from 'path';
import { logger } from './logger.js';

/**
 * Interface pour l'état d'un wallet
 */
export interface WalletState {
  address: string;
  index: number;
  lastStep: string | null;
  tokenIds: number[];
  lastBridgeTx: string | null;
  lastSwapTx: string | null;
  lpParams: {
    tokenId: number | null;
    tickLower: number | null;
    tickUpper: number | null;
    liquidity: string | null;
  } | null;
  lastCollectAt: number | null;
  errors: string[];
  createdAt: number;
  updatedAt: number;
}

/**
 * Interface pour l'état global
 */
export interface GlobalState {
  wallets: Record<string, WalletState>;
  lastRunId: string | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * Gestionnaire du state store
 */
export class StateStore {
  private stateFile: string;
  private state: GlobalState;

  constructor(stateDir: string = 'state') {
    this.stateFile = join(stateDir, 'wallet-state.json');
    this.state = {
      wallets: {},
      lastRunId: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  /**
   * Initialiser le state store
   */
  async initialize(): Promise<void> {
    try {
      // Créer le dossier state s'il n'existe pas
      const stateDir = join(this.stateFile, '..');
      await fs.mkdir(stateDir, { recursive: true });

      // Charger l'état existant
      await this.loadState();
    } catch (error) {
      logger.warn({
        error: error instanceof Error ? error.message : String(error),
        message: 'Impossible de charger l\'état existant, création d\'un nouvel état'
      });
    }
  }

  /**
   * Charger l'état depuis le fichier
   */
  private async loadState(): Promise<void> {
    try {
      const data = await fs.readFile(this.stateFile, 'utf-8');
      this.state = JSON.parse(data);
      logger.info({
        walletCount: Object.keys(this.state.wallets).length,
        message: 'État chargé depuis le fichier'
      });
    } catch (error) {
      // Fichier n'existe pas ou erreur de lecture, utiliser l'état par défaut
      logger.info({
        message: 'Création d\'un nouvel état'
      });
    }
  }

  /**
   * Sauvegarder l'état dans le fichier
   */
  private async saveState(): Promise<void> {
    try {
      this.state.updatedAt = Date.now();
      await fs.writeFile(this.stateFile, JSON.stringify(this.state, null, 2));
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        message: 'Erreur lors de la sauvegarde de l\'état'
      });
      throw error;
    }
  }

  /**
   * Obtenir l'état d'un wallet
   */
  getWalletState(address: string): WalletState | null {
    return this.state.wallets[address] || null;
  }

  /**
   * Créer ou mettre à jour l'état d'un wallet
   */
  async updateWalletState(address: string, updates: Partial<WalletState>): Promise<void> {
    const existingState = this.state.wallets[address];
    
    this.state.wallets[address] = {
      address,
      index: updates.index ?? existingState?.index ?? 0,
      lastStep: updates.lastStep ?? existingState?.lastStep ?? null,
      tokenIds: updates.tokenIds ?? existingState?.tokenIds ?? [],
      lastBridgeTx: updates.lastBridgeTx ?? existingState?.lastBridgeTx ?? null,
      lastSwapTx: updates.lastSwapTx ?? existingState?.lastSwapTx ?? null,
      lpParams: updates.lpParams ?? existingState?.lpParams ?? null,
      lastCollectAt: updates.lastCollectAt ?? existingState?.lastCollectAt ?? null,
      errors: updates.errors ?? existingState?.errors ?? [],
      createdAt: existingState?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    };

    await this.saveState();
    
    logger.debug({
      address,
      updates,
      message: 'État du wallet mis à jour'
    });
  }

  /**
   * Ajouter une erreur à un wallet
   */
  async addWalletError(address: string, error: string): Promise<void> {
    const walletState = this.state.wallets[address];
    if (walletState) {
      walletState.errors.push(`${new Date().toISOString()}: ${error}`);
      walletState.updatedAt = Date.now();
      await this.saveState();
    }
  }

  /**
   * Marquer une étape comme terminée
   */
  async markStepCompleted(address: string, step: string, txHash?: string): Promise<void> {
    const updates: Partial<WalletState> = {
      lastStep: step,
      updatedAt: Date.now(),
    };

    // Mettre à jour les transactions spécifiques
    switch (step) {
      case 'bridge_completed':
        updates.lastBridgeTx = txHash || null;
        break;
      case 'swap_completed':
        updates.lastSwapTx = txHash || null;
        break;
      case 'lp_completed':
        // Les paramètres LP sont mis à jour séparément
        break;
      case 'collect_completed':
        updates.lastCollectAt = Date.now();
        break;
    }

    await this.updateWalletState(address, updates);
    
    logger.info({
      address,
      step,
      txHash,
      message: 'Étape marquée comme terminée'
    });
  }

  /**
   * Obtenir le prochain step à exécuter pour un wallet
   */
  getNextStep(address: string): string | null {
    const walletState = this.state.wallets[address];
    if (!walletState) {
      return 'bridge'; // Premier step
    }

    const lastStep = walletState.lastStep;
    if (!lastStep) {
      return 'bridge'; // Premier step
    }

    // Déterminer le prochain step basé sur le dernier step
    switch (lastStep) {
      case 'bridge_completed':
        return 'swap';
      case 'swap_completed':
        return 'lp';
      case 'lp_completed':
        return 'collect';
      case 'collect_completed':
        return null; // Séquence terminée
      default:
        return 'bridge'; // Recommencer depuis le début
    }
  }

  /**
   * Vérifier si un wallet peut être repris
   */
  canResumeWallet(address: string): boolean {
    const nextStep = this.getNextStep(address);
    return nextStep !== null;
  }

  /**
   * Obtenir tous les wallets avec leur statut
   */
  getAllWalletStates(): Record<string, WalletState> {
    return { ...this.state.wallets };
  }

  /**
   * Obtenir les statistiques globales
   */
  getStats(): {
    totalWallets: number;
    completedWallets: number;
    inProgressWallets: number;
    errorWallets: number;
    lastRunId: string | null;
  } {
    const wallets = Object.values(this.state.wallets);
    
    return {
      totalWallets: wallets.length,
      completedWallets: wallets.filter(w => w.lastStep === 'collect_completed').length,
      inProgressWallets: wallets.filter(w => w.lastStep && w.lastStep !== 'collect_completed').length,
      errorWallets: wallets.filter(w => w.errors.length > 0).length,
      lastRunId: this.state.lastRunId,
    };
  }

  /**
   * Réinitialiser l'état d'un wallet
   */
  async resetWalletState(address: string): Promise<void> {
    delete this.state.wallets[address];
    await this.saveState();
    
    logger.info({
      address,
      message: 'État du wallet réinitialisé'
    });
  }

  /**
   * Réinitialiser tous les états
   */
  async resetAllStates(): Promise<void> {
    this.state.wallets = {};
    this.state.lastRunId = null;
    await this.saveState();
    
    logger.info({
      message: 'Tous les états réinitialisés'
    });
  }

  /**
   * Marquer le début d'une nouvelle exécution
   */
  async startNewRun(runId: string): Promise<void> {
    this.state.lastRunId = runId;
    await this.saveState();
    
    logger.info({
      runId,
      message: 'Nouvelle exécution démarrée'
    });
  }

  /**
   * Exporter l'état pour sauvegarde
   */
  async exportState(): Promise<GlobalState> {
    return { ...this.state };
  }

  /**
   * Importer un état depuis une sauvegarde
   */
  async importState(state: GlobalState): Promise<void> {
    this.state = state;
    await this.saveState();
    
    logger.info({
      walletCount: Object.keys(this.state.wallets).length,
      message: 'État importé depuis la sauvegarde'
    });
  }

  /**
   * Nettoyer les anciens états (plus de X jours)
   */
  async cleanupOldStates(maxAgeDays: number = 30): Promise<void> {
    const cutoffTime = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);
    const initialCount = Object.keys(this.state.wallets).length;
    
    Object.keys(this.state.wallets).forEach(address => {
      const walletState = this.state.wallets[address];
      if (walletState.updatedAt < cutoffTime) {
        delete this.state.wallets[address];
      }
    });

    const finalCount = Object.keys(this.state.wallets).length;
    const removedCount = initialCount - finalCount;
    
    if (removedCount > 0) {
      await this.saveState();
      logger.info({
        removedCount,
        maxAgeDays,
        message: 'Anciens états nettoyés'
      });
    }
  }
}

/**
 * Instance globale du state store
 */
export const stateStore = new StateStore();
