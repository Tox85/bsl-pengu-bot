import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupBybitSuccess, setupBybitRateLimit, setupBridgeSuccess, setupHubSuccess, fixtures } from '../fixtures/index.js';
import { runFlowForWallets } from '../../src/cli-runner.js';
import { WalletManager } from '../../src/core/wallet-manager.js';
import { StateManager } from '../../src/orchestrator/state.js';

describe('Stress Test - 100 Wallets', () => {
  let walletManager: WalletManager;
  let stateManager: StateManager;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    
    // Setup fixtures with some rate limiting
    setupBybitSuccess();
    setupBybitRateLimit(); // 20% of requests will hit rate limit
    setupBridgeSuccess();
    setupHubSuccess();
    
    walletManager = new WalletManager();
    stateManager = new StateManager();
  });

  afterEach(() => {
    fixtures.cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('should handle 100 wallets with controlled concurrency', async () => {
    const startTime = Date.now();
    
    const results = await runFlowForWallets({ 
      simulateStubs: true, 
      mnemonicCount: 100, 
      concurrency: 5 
    });

    const duration = Date.now() - startTime;

    // Basic assertions
    expect(results).toHaveLength(100);
    expect(duration).toBeLessThan(30000); // Should complete within 30 seconds with fake timers

    // Analyze results
    const successCount = results.filter(r => r.status === 'success').length;
    const partialCount = results.filter(r => r.status === 'partial').length;
    const failedCount = results.filter(r => r.status === 'failed').length;

    expect(successCount + partialCount + failedCount).toBe(100);

    // At least 80% should succeed (allowing for some rate limit failures)
    expect(successCount).toBeGreaterThanOrEqual(80);

    // Verify nonce management
    const wallets = walletManager.getWallets();
    expect(wallets).toHaveLength(100);

    // Check that nonces are monotonic per wallet
    for (const wallet of wallets) {
      const nonces = wallet.nonceManager.getPendingNonces();
      const sortedNonces = [...nonces].sort((a, b) => a - b);
      
      for (let i = 0; i < sortedNonces.length - 1; i++) {
        expect(sortedNonces[i + 1] - sortedNonces[i]).toBe(1);
      }
    }

    // Verify state consistency
    const stats = stateManager.getStats();
    expect(stats.totalWallets).toBe(100);
    expect(stats.completedWallets + stats.failedWallets).toBe(100);
  });

  it('should handle rate limiting gracefully', async () => {
    // Setup more aggressive rate limiting
    fixtures.getBybit().mockWithdrawRateLimitThenSuccess();
    
    const results = await runFlowForWallets({ 
      simulateStubs: true, 
      mnemonicCount: 20, 
      concurrency: 3 
    });

    expect(results).toHaveLength(20);

    // All wallets should eventually succeed despite rate limiting
    const successCount = results.filter(r => r.status === 'success').length;
    expect(successCount).toBeGreaterThanOrEqual(15); // Allow some failures due to rate limiting

    // Check that retries were used
    const walletsWithRetries = results.filter(r => r.retries > 0);
    expect(walletsWithRetries.length).toBeGreaterThan(0);
  });

  it('should maintain isolation between wallets under stress', async () => {
    const results = await runFlowForWallets({ 
      simulateStubs: true, 
      mnemonicCount: 50, 
      concurrency: 10 
    });

    expect(results).toHaveLength(50);

    // Verify each wallet has unique address
    const addresses = results.map(r => r.wallet);
    const uniqueAddresses = new Set(addresses);
    expect(uniqueAddresses.size).toBe(50);

    // Verify each wallet has its own state
    for (const result of results) {
      const state = stateManager.loadState(result.wallet);
      expect(state).toBeDefined();
      expect(state?.wallet).toBe(result.wallet);
    }

    // Verify nonce isolation
    const wallets = walletManager.getWallets();
    const allNonces = wallets.flatMap(w => w.nonceManager.getPendingNonces());
    const uniqueNonces = new Set(allNonces);
    expect(uniqueNonces.size).toBe(allNonces.length);
  });

  it('should handle memory efficiently with large number of wallets', async () => {
    const initialMemory = process.memoryUsage();
    
    const results = await runFlowForWallets({ 
      simulateStubs: true, 
      mnemonicCount: 100, 
      concurrency: 5 
    });

    const finalMemory = process.memoryUsage();
    const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;

    expect(results).toHaveLength(100);
    
    // Memory increase should be reasonable (less than 100MB)
    expect(memoryIncrease).toBeLessThan(100 * 1024 * 1024);

    // Verify cleanup
    const wallets = walletManager.getWallets();
    expect(wallets).toHaveLength(100);
    
    // Each wallet should have minimal memory footprint
    for (const wallet of wallets) {
      expect(wallet.nonceManager.getPendingNonces().length).toBeLessThan(10);
    }
  });

  it('should handle concurrent state updates correctly', async () => {
    const results = await runFlowForWallets({ 
      simulateStubs: true, 
      mnemonicCount: 30, 
      concurrency: 5 
    });

    expect(results).toHaveLength(30);

    // Verify all states are consistent
    const states = results.map(r => stateManager.loadState(r.wallet)).filter(Boolean);
    expect(states).toHaveLength(30);

    // Verify no state corruption
    for (const state of states) {
      expect(state?.wallet).toBeDefined();
      expect(state?.currentStep).toBeDefined();
      expect(state?.createdAt).toBeDefined();
      expect(state?.updatedAt).toBeDefined();
    }

    // Verify operation IDs are unique
    const allOperationIds = states.flatMap(s => s.executedOperations || []);
    const uniqueOperationIds = new Set(allOperationIds);
    expect(uniqueOperationIds.size).toBe(allOperationIds.length);
  });

  it('should complete within acceptable time limits', async () => {
    const startTime = Date.now();
    
    const results = await runFlowForWallets({ 
      simulateStubs: true, 
      mnemonicCount: 100, 
      concurrency: 5 
    });

    const duration = Date.now() - startTime;

    expect(results).toHaveLength(100);
    expect(duration).toBeLessThan(10000); // Should complete within 10 seconds with stubs

    // Verify performance metrics
    const avgDurationPerWallet = results.reduce((sum, r) => sum + r.durationMs, 0) / results.length;
    expect(avgDurationPerWallet).toBeLessThan(1000); // Average less than 1 second per wallet

    // Verify concurrency was effective
    const maxConcurrentTime = Math.max(...results.map(r => r.durationMs));
    const totalSequentialTime = results.reduce((sum, r) => sum + r.durationMs, 0);
    const concurrencyRatio = totalSequentialTime / (maxConcurrentTime * results.length);
    expect(concurrencyRatio).toBeLessThan(0.5); // Should be significantly faster than sequential
  });

  it('should handle mixed success/failure scenarios', async () => {
    // Setup mixed scenarios
    setupBybitSuccess();
    setupBybitRateLimit();
    setupBridgeSuccess();
    setupHubSuccess();
    
    const results = await runFlowForWallets({ 
      simulateStubs: true, 
      mnemonicCount: 50, 
      concurrency: 5 
    });

    expect(results).toHaveLength(50);

    // Should have mix of results
    const successCount = results.filter(r => r.status === 'success').length;
    const partialCount = results.filter(r => r.status === 'partial').length;
    const failedCount = results.filter(r => r.status === 'failed').length;

    expect(successCount + partialCount + failedCount).toBe(50);
    
    // Most should succeed
    expect(successCount).toBeGreaterThanOrEqual(40);
    
    // Some might be partial due to rate limiting
    expect(partialCount + failedCount).toBeLessThanOrEqual(10);

    // Verify error handling
    const errorResults = results.filter(r => r.errorCode);
    for (const result of errorResults) {
      expect(result.errorCode).toMatch(/^(RATE_LIMIT|INSUFFICIENT_FUNDS|TIMEOUT|NETWORK)$/);
    }
  });
});

