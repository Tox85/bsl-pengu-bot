import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { logger, logError } from '../core/logger.js';
import type { OrchestratorState } from './types.js';

// Service de gestion de l'état de l'orchestrateur
export class StateManager {
  private stateDir: string;
  private stateFile: string;

  constructor() {
    this.stateDir = '.state';
    this.stateFile = join(this.stateDir, 'orchestrator-state.json');
    
    // Créer le dossier d'état s'il n'existe pas
    if (!existsSync(this.stateDir)) {
      try {
        mkdirSync(this.stateDir, { recursive: true });
      } catch (error) {
        logError(error, { stateDir: this.stateDir });
      }
    }
  }

  // Charger l'état depuis le fichier
  loadState(wallet: string): OrchestratorState | null {
    try {
      const walletStateFile = join(this.stateDir, `orchestrator-${wallet.toLowerCase()}.json`);
      
      if (!existsSync(walletStateFile)) {
        logger.debug({
          wallet,
          message: 'Aucun état existant trouvé'
        });
        return null;
      }

      const stateData = readFileSync(walletStateFile, 'utf8');
      const state = JSON.parse(stateData) as OrchestratorState;

      logger.info({
        wallet,
        currentStep: state.currentStep,
        createdAt: state.createdAt,
        updatedAt: state.updatedAt,
        message: 'État chargé'
      });

      return state;
    } catch (error) {
      logError(error, { wallet });
      return null;
    }
  }

  // Sauvegarder l'état dans le fichier
  saveState(state: OrchestratorState): void {
    try {
      // S'assurer que le dossier d'état existe
      if (!existsSync(this.stateDir)) {
        mkdirSync(this.stateDir, { recursive: true });
      }
      
      const walletStateFile = join(this.stateDir, `orchestrator-${state.wallet.toLowerCase()}.json`);
      
      const stateData = JSON.stringify(state, (key, value) => {
        // Convertir les BigInt en string pour la sérialisation JSON
        if (typeof value === 'bigint') {
          return value.toString();
        }
        return value;
      }, 2);

      writeFileSync(walletStateFile, stateData, 'utf8');

      logger.debug({
        wallet: state.wallet,
        currentStep: state.currentStep,
        message: 'État sauvegardé'
      });
    } catch (error) {
      logError(error, { wallet: state.wallet });
    }
  }

  // Créer un nouvel état
  createState(wallet: string): OrchestratorState {
    const now = Date.now();
    
    const state: OrchestratorState = {
      wallet,
      currentStep: 'idle',
      createdAt: now,
      updatedAt: now,
    };

    this.saveState(state);
    
    logger.info({
      wallet,
      message: 'Nouvel état créé'
    });

    return state;
  }

  // Mettre à jour l'état
  updateState(
    state: OrchestratorState,
    updates: Partial<OrchestratorState>
  ): OrchestratorState {
    const updatedState: OrchestratorState = {
      ...state,
      ...updates,
      updatedAt: Date.now(),
    };

    this.saveState(updatedState);

    logger.debug({
      wallet: state.wallet,
      currentStep: updatedState.currentStep,
      message: 'État mis à jour'
    });

    return updatedState;
  }

  // Supprimer l'état
  deleteState(wallet: string): void {
    try {
      const walletStateFile = join(this.stateDir, `orchestrator-${wallet.toLowerCase()}.json`);
      
      if (existsSync(walletStateFile)) {
        require('fs').unlinkSync(walletStateFile);
        
        logger.info({
          wallet,
          message: 'État supprimé'
        });
      }
    } catch (error) {
      logError(error, { wallet });
    }
  }

  // Lister tous les états
  listStates(): string[] {
    try {
      const files = require('fs').readdirSync(this.stateDir);
      return files
        .filter((file: string) => file.startsWith('orchestrator-') && file.endsWith('.json'))
        .map((file: string) => file.replace('orchestrator-', '').replace('.json', ''));
    } catch (error) {
      logError(error, { stateDir: this.stateDir });
      return [];
    }
  }

  // Vérifier si un état existe
  hasState(wallet: string): boolean {
    const walletStateFile = join(this.stateDir, `orchestrator-${wallet.toLowerCase()}.json`);
    return existsSync(walletStateFile);
  }

  // Obtenir le chemin du fichier d'état
  getStateFilePath(wallet: string): string {
    return join(this.stateDir, `orchestrator-${wallet.toLowerCase()}.json`);
  }
}

// Instance singleton du gestionnaire d'état
export const stateManager = new StateManager();
