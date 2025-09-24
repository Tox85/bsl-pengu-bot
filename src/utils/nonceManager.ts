import { Mutex } from './mutex.js';
import { BotError } from '../errors/BotError.js';

/**
 * Nonce manager for individual wallets
 */
export class NonceManager {
  private currentNonce: number;
  private mutex = new Mutex();
  private pendingNonces = new Set<number>();

  constructor(initialNonce: number = 0) {
    this.currentNonce = initialNonce;
  }

  /**
   * Get the next nonce atomically
   */
  async getNextNonce(): Promise<number> {
    return this.mutex.runExclusive(async () => {
      const nonce = this.currentNonce;
      this.pendingNonces.add(nonce);
      this.currentNonce++;
      return nonce;
    });
  }

  /**
   * Mark a nonce as used (transaction confirmed)
   */
  async markNonceUsed(nonce: number): Promise<void> {
    return this.mutex.runExclusive(async () => {
      this.pendingNonces.delete(nonce);
    });
  }

  /**
   * Mark a nonce as failed (transaction failed)
   */
  async markNonceFailed(nonce: number): Promise<void> {
    return this.mutex.runExclusive(async () => {
      this.pendingNonces.delete(nonce);
      // Reset current nonce to the failed nonce for retry
      this.currentNonce = Math.min(this.currentNonce, nonce);
    });
  }

  /**
   * Get current nonce without incrementing
   */
  getCurrentNonce(): number {
    return this.currentNonce;
  }

  /**
   * Get pending nonces
   */
  getPendingNonces(): number[] {
    return Array.from(this.pendingNonces);
  }

  /**
   * Reset nonce manager (for testing or error recovery)
   */
  async reset(newNonce: number): Promise<void> {
    return this.mutex.runExclusive(async () => {
      this.currentNonce = newNonce;
      this.pendingNonces.clear();
    });
  }
}

