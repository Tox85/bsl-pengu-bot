/**
 * Simple mutex implementation for per-wallet locking
 */
export class Mutex {
  private locked = false;
  private waiting: Array<() => void> = [];

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const execute = async () => {
        this.locked = true;
        try {
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          this.locked = false;
          const next = this.waiting.shift();
          if (next) {
            next();
          }
        }
      };

      if (this.locked) {
        this.waiting.push(execute);
      } else {
        execute();
      }
    });
  }

  isLocked(): boolean {
    return this.locked;
  }
}

/**
 * Manager for multiple mutexes by key
 */
export class WalletMutexManager {
  private mutexes = new Map<string, Mutex>();

  async runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
    let mutex = this.mutexes.get(key);
    if (!mutex) {
      mutex = new Mutex();
      this.mutexes.set(key, mutex);
    }
    return mutex.runExclusive(fn);
  }

  getMutex(key: string): Mutex | undefined {
    return this.mutexes.get(key);
  }

  clear(): void {
    this.mutexes.clear();
  }
}

export const walletMutexManager = new WalletMutexManager();

