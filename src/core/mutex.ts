import { logger } from './logger.js';

/**
 * Mutex simple pour éviter les collisions de nonce/gas par wallet
 */
export class Mutex {
  private locked = false;
  private waitingQueue: Array<() => void> = [];

  /**
   * Exécuter une fonction de manière exclusive
   */
  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const execute = async () => {
        try {
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          this.unlock();
        }
      };

      if (this.locked) {
        this.waitingQueue.push(execute);
      } else {
        this.lock();
        execute();
      }
    });
  }

  private lock(): void {
    this.locked = true;
  }

  private unlock(): void {
    this.locked = false;
    const next = this.waitingQueue.shift();
    if (next) {
      this.lock();
      next();
    }
  }

  /**
   * Vérifier si le mutex est verrouillé
   */
  isLocked(): boolean {
    return this.locked;
  }

  /**
   * Obtenir le nombre de tâches en attente
   */
  getWaitingCount(): number {
    return this.waitingQueue.length;
  }
}

/**
 * Gestionnaire de mutex par wallet
 */
export class WalletMutexManager {
  private mutexes = new Map<string, Mutex>();

  /**
   * Obtenir ou créer un mutex pour un wallet
   */
  getMutex(walletAddress: string): Mutex {
    if (!this.mutexes.has(walletAddress)) {
      this.mutexes.set(walletAddress, new Mutex());
    }
    return this.mutexes.get(walletAddress)!;
  }

  /**
   * Exécuter une fonction de manière exclusive pour un wallet spécifique
   */
  async runExclusive<T>(
    walletAddress: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const mutex = this.getMutex(walletAddress);
    return mutex.runExclusive(fn);
  }

  /**
   * Obtenir les statistiques des mutex
   */
  getStats(): { totalMutexes: number; lockedMutexes: number; waitingTasks: number } {
    let lockedMutexes = 0;
    let waitingTasks = 0;

    for (const mutex of this.mutexes.values()) {
      if (mutex.isLocked()) {
        lockedMutexes++;
      }
      waitingTasks += mutex.getWaitingCount();
    }

    return {
      totalMutexes: this.mutexes.size,
      lockedMutexes,
      waitingTasks,
    };
  }

  /**
   * Nettoyer les mutex inutilisés (optionnel)
   */
  cleanup(): void {
    // Pour l'instant, on garde tous les mutex
    // On pourrait implémenter une logique de nettoyage basée sur l'âge
    logger.debug({
      totalMutexes: this.mutexes.size,
      message: 'Mutex manager cleanup'
    });
  }
}

// Instance globale du gestionnaire de mutex
export const walletMutexManager = new WalletMutexManager();
