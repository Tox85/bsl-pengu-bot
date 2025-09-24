import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BybitFixtures } from '../fixtures/nock/bybit.fixture.js';
import { BridgeFixtures } from '../fixtures/nock/bridge.fixture.js';
import { EthersMockFactory } from '../fixtures/mocks/ethers.hub.js';
import { WalletManager } from '../../src/core/wallet-manager.js';
import { StateManager } from '../../src/orchestrator/state.js';
import { retry } from '../../src/core/retry.js';
import { BotError, ERROR_CODES } from '../../src/core/errors.js';

// Mock des modules externes
vi.mock('../../src/core/rpc.js', () => ({
  getProvider: vi.fn().mockReturnValue(EthersMockFactory.createProviderMock()),
}));

vi.mock('../../src/bridge/lifi.ts', () => ({
  LiFiBridge: vi.fn().mockImplementation(() => ({
    getRoute: vi.fn(),
    executeRoute: vi.fn(),
    getExecutionStatus: vi.fn(),
  })),
}));

vi.mock('../../src/dex/swap.ts', () => ({
  SwapService: vi.fn().mockImplementation(() => ({
    swap: vi.fn(),
  })),
}));

vi.mock('../../src/lp/v3.ts', () => ({
  UniswapV3LP: vi.fn().mockImplementation(() => ({
    addLiquidity: vi.fn(),
    collect: vi.fn(),
  })),
}));

describe('Multi-Wallet Failure Cases', () => {
  let walletManager: WalletManager;
  let stateManager: StateManager;
  let bybitFixtures: BybitFixtures;
  let bridgeFixtures: BridgeFixtures;
  let mockProvider: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    bybitFixtures = new BybitFixtures();
    bridgeFixtures = new BridgeFixtures();
    
    mockProvider = EthersMockFactory.createProviderMock();
    
    walletManager = new WalletManager(mockProvider);
    stateManager = new StateManager('.test-state');
  });

  afterEach(() => {
    bybitFixtures.cleanup();
    bridgeFixtures.cleanup();
    vi.clearAllMocks();
  });

  it('devrait gérer INSUFFICIENT_FUNDS lors du retrait Bybit', async () => {
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const walletCount = 3;

    // Configurer le mock pour échec de solde insuffisant
    bybitFixtures.mockGetBalance(50); // Solde insuffisant
    bybitFixtures.mockWithdrawInsufficientBalance();

    // Créer les wallets
    const wallets = await Promise.all(
      Array.from({ length: walletCount }, (_, index) =>
        walletManager.createOrLoadWallet(mnemonic, index, mockProvider)
      )
    );

    // Simuler le flow avec gestion d'erreur
    const flowPromises = wallets.map(async (wallet, index) => {
      const walletAddress = wallet.address;
      
      try {
        // 1. Bridge (stubbed)
        const bridgeResult = await retry(
          async () => {
            await new Promise(resolve => setTimeout(resolve, 100));
            return { hash: `0xbridge${index}...`, status: 'success' };
          },
          { maxRetries: 3, baseDelayMs: 1000 }
        );

        const state = stateManager.createState(walletAddress);
        stateManager.saveStateAfterStep(state, 'bridge', bridgeResult);

        // 2. Swap (stubbed)
        const swapResult = await retry(
          async () => {
            await new Promise(resolve => setTimeout(resolve, 150));
            return { hash: `0xswap${index}...`, status: 'success' };
          },
          { maxRetries: 3, baseDelayMs: 1000 }
        );

        stateManager.saveStateAfterStep(state, 'swap', swapResult);

        // 3. LP (stubbed)
        const lpResult = await retry(
          async () => {
            await new Promise(resolve => setTimeout(resolve, 200));
            return { hash: `0xlp${index}...`, status: 'success' };
          },
          { maxRetries: 3, baseDelayMs: 1000 }
        );

        stateManager.saveStateAfterStep(state, 'lp', lpResult);

        // 4. Collect (simuler échec de retrait)
        try {
          const collectResult = await retry(
            async () => {
              // Simuler l'échec de retrait
              throw BotError.insufficientFunds('Solde insuffisant pour le retrait', { 
                required: 100, 
                available: 50 
              });
            },
            { maxRetries: 3, baseDelayMs: 1000 }
          );

          stateManager.markStepCompleted(walletAddress, 'collect_done');
          return { wallet: walletAddress, status: 'success', steps: ['bridge', 'swap', 'lp', 'collect'] };
        } catch (error) {
          if (BotError.isBotError(error) && error.code === ERROR_CODES.INSUFFICIENT_FUNDS) {
            stateManager.markStepCompleted(walletAddress, 'collect_failed');
            return { 
              wallet: walletAddress, 
              status: 'partial', 
              steps: ['bridge', 'swap', 'lp'], 
              error: error.message 
            };
          }
          throw error;
        }
      } catch (error) {
        stateManager.markStepCompleted(walletAddress, 'error');
        return {
          wallet: walletAddress,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    });

    const results = await Promise.all(flowPromises);

    // Vérifications
    expect(results).toHaveLength(walletCount);
    
    const successResults = results.filter(r => r.status === 'success');
    const partialResults = results.filter(r => r.status === 'partial');
    const failedResults = results.filter(r => r.status === 'failed');
    
    expect(successResults).toHaveLength(0);
    expect(partialResults).toHaveLength(walletCount);
    expect(failedResults).toHaveLength(0);

    // Vérifier que tous les wallets ont échoué au collect
    for (const result of partialResults) {
      expect(result.steps).toEqual(['bridge', 'swap', 'lp']);
      expect(result.error).toContain('Solde insuffisant');
    }
  });

  it('devrait gérer BRIDGE_TIMEOUT avec retry puis abandon', async () => {
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const walletCount = 3;

    // Configurer le mock pour timeout de bridge
    bridgeFixtures.mockRouteFound();
    bridgeFixtures.mockExecuteBridge();
    bridgeFixtures.mockBridgeTimeout(); // Timeout après 30s

    const wallets = await Promise.all(
      Array.from({ length: walletCount }, (_, index) =>
        walletManager.createOrLoadWallet(mnemonic, index, mockProvider)
      )
    );

    const flowPromises = wallets.map(async (wallet, index) => {
      const walletAddress = wallet.address;
      
      try {
        // 1. Bridge avec timeout
        const bridgeResult = await retry(
          async () => {
            // Simuler le timeout
            await new Promise(resolve => setTimeout(resolve, 5000));
            throw BotError.bridgeTimeout('Bridge timeout après 30 secondes', { 
              executionId: 'execution-123' 
            });
          },
          { maxRetries: 2, baseDelayMs: 1000, maxDelayMs: 5000 }
        );

        const state = stateManager.createState(walletAddress);
        stateManager.saveStateAfterStep(state, 'bridge', bridgeResult);

        // Si on arrive ici, le bridge a réussi
        return { wallet: walletAddress, status: 'success', steps: ['bridge'] };
      } catch (error) {
        if (BotError.isBotError(error) && error.code === ERROR_CODES.BRIDGE_TIMEOUT) {
          stateManager.markStepCompleted(walletAddress, 'bridge_timeout');
          return { 
            wallet: walletAddress, 
            status: 'failed', 
            steps: [], 
            error: error.message 
          };
        }
        throw error;
      }
    });

    const results = await Promise.all(flowPromises);

    // Vérifications
    expect(results).toHaveLength(walletCount);
    
    const successResults = results.filter(r => r.status === 'success');
    const failedResults = results.filter(r => r.status === 'failed');
    
    expect(successResults).toHaveLength(0);
    expect(failedResults).toHaveLength(walletCount);

    // Vérifier que tous les wallets ont échoué au bridge
    for (const result of failedResults) {
      expect(result.steps).toEqual([]);
      expect(result.error).toContain('Bridge timeout');
    }
  });

  it('devrait gérer SWAP_NO_POOL et continuer pour les autres wallets', async () => {
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const walletCount = 5;

    // Configurer le mock pour route non trouvée
    bridgeFixtures.mockRouteNotFound();

    const wallets = await Promise.all(
      Array.from({ length: walletCount }, (_, index) =>
        walletManager.createOrLoadWallet(mnemonic, index, mockProvider)
      )
    );

    const flowPromises = wallets.map(async (wallet, index) => {
      const walletAddress = wallet.address;
      
      try {
        // 1. Bridge (stubbed)
        const bridgeResult = await retry(
          async () => {
            await new Promise(resolve => setTimeout(resolve, 100));
            return { hash: `0xbridge${index}...`, status: 'success' };
          },
          { maxRetries: 3, baseDelayMs: 1000 }
        );

        const state = stateManager.createState(walletAddress);
        stateManager.saveStateAfterStep(state, 'bridge', bridgeResult);

        // 2. Swap (simuler échec de pool)
        try {
          const swapResult = await retry(
            async () => {
              if (index === 2) { // Simuler l'échec pour le wallet 2
                throw BotError.swapNoPool('Aucun pool de swap disponible', { 
                  fromToken: 'USDC', 
                  toToken: 'WETH' 
                });
              }
              await new Promise(resolve => setTimeout(resolve, 150));
              return { hash: `0xswap${index}...`, status: 'success' };
            },
            { maxRetries: 3, baseDelayMs: 1000 }
          );

          stateManager.saveStateAfterStep(state, 'swap', swapResult);

          // 3. LP (stubbed)
          const lpResult = await retry(
            async () => {
              await new Promise(resolve => setTimeout(resolve, 200));
              return { hash: `0xlp${index}...`, status: 'success' };
            },
            { maxRetries: 3, baseDelayMs: 1000 }
          );

          stateManager.saveStateAfterStep(state, 'lp', lpResult);

          // 4. Collect (stubbed)
          const collectResult = await retry(
            async () => {
              await new Promise(resolve => setTimeout(resolve, 100));
              return { hash: `0xcollect${index}...`, status: 'success' };
            },
            { maxRetries: 3, baseDelayMs: 1000 }
          );

          stateManager.markStepCompleted(walletAddress, 'collect_done');
          return { wallet: walletAddress, status: 'success', steps: ['bridge', 'swap', 'lp', 'collect'] };
        } catch (error) {
          if (BotError.isBotError(error) && error.code === ERROR_CODES.SWAP_NO_POOL) {
            stateManager.markStepCompleted(walletAddress, 'swap_failed');
            return { 
              wallet: walletAddress, 
              status: 'partial', 
              steps: ['bridge'], 
              error: error.message 
            };
          }
          throw error;
        }
      } catch (error) {
        stateManager.markStepCompleted(walletAddress, 'error');
        return {
          wallet: walletAddress,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    });

    const results = await Promise.all(flowPromises);

    // Vérifications
    expect(results).toHaveLength(walletCount);
    
    const successResults = results.filter(r => r.status === 'success');
    const partialResults = results.filter(r => r.status === 'partial');
    const failedResults = results.filter(r => r.status === 'failed');
    
    expect(successResults).toHaveLength(walletCount - 1); // Tous sauf le wallet 2
    expect(partialResults).toHaveLength(1); // Seulement le wallet 2
    expect(failedResults).toHaveLength(0);

    // Vérifier que le wallet 2 a échoué au swap
    const wallet2Result = results.find(r => r.wallet === wallets[2].address);
    expect(wallet2Result?.status).toBe('partial');
    expect(wallet2Result?.steps).toEqual(['bridge']);
    expect(wallet2Result?.error).toContain('Aucun pool de swap disponible');
  });

  it('devrait gérer COLLECT_REVERT avec retry puis marquer comme échoué', async () => {
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const walletCount = 3;

    const wallets = await Promise.all(
      Array.from({ length: walletCount }, (_, index) =>
        walletManager.createOrLoadWallet(mnemonic, index, mockProvider)
      )
    );

    const flowPromises = wallets.map(async (wallet, index) => {
      const walletAddress = wallet.address;
      
      try {
        // 1. Bridge (stubbed)
        const bridgeResult = await retry(
          async () => {
            await new Promise(resolve => setTimeout(resolve, 100));
            return { hash: `0xbridge${index}...`, status: 'success' };
          },
          { maxRetries: 3, baseDelayMs: 1000 }
        );

        const state = stateManager.createState(walletAddress);
        stateManager.saveStateAfterStep(state, 'bridge', bridgeResult);

        // 2. Swap (stubbed)
        const swapResult = await retry(
          async () => {
            await new Promise(resolve => setTimeout(resolve, 150));
            return { hash: `0xswap${index}...`, status: 'success' };
          },
          { maxRetries: 3, baseDelayMs: 1000 }
        );

        stateManager.saveStateAfterStep(state, 'swap', swapResult);

        // 3. LP (stubbed)
        const lpResult = await retry(
          async () => {
            await new Promise(resolve => setTimeout(resolve, 200));
            return { hash: `0xlp${index}...`, status: 'success' };
          },
          { maxRetries: 3, baseDelayMs: 1000 }
        );

        stateManager.saveStateAfterStep(state, 'lp', lpResult);

        // 4. Collect (simuler revert)
        try {
          const collectResult = await retry(
            async () => {
              if (index === 1) { // Simuler le revert pour le wallet 1
                throw BotError.collectRevert('Transaction reverted: collect failed', { 
                  positionId: `position${index}` 
                });
              }
              await new Promise(resolve => setTimeout(resolve, 100));
              return { hash: `0xcollect${index}...`, status: 'success' };
            },
            { maxRetries: 2, baseDelayMs: 1000 }
          );

          stateManager.markStepCompleted(walletAddress, 'collect_done');
          return { wallet: walletAddress, status: 'success', steps: ['bridge', 'swap', 'lp', 'collect'] };
        } catch (error) {
          if (BotError.isBotError(error) && error.code === ERROR_CODES.LP_COLLECT_FAILED) {
            stateManager.markStepCompleted(walletAddress, 'collect_failed');
            return { 
              wallet: walletAddress, 
              status: 'partial', 
              steps: ['bridge', 'swap', 'lp'], 
              error: error.message 
            };
          }
          throw error;
        }
      } catch (error) {
        stateManager.markStepCompleted(walletAddress, 'error');
        return {
          wallet: walletAddress,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    });

    const results = await Promise.all(flowPromises);

    // Vérifications
    expect(results).toHaveLength(walletCount);
    
    const successResults = results.filter(r => r.status === 'success');
    const partialResults = results.filter(r => r.status === 'partial');
    const failedResults = results.filter(r => r.status === 'failed');
    
    expect(successResults).toHaveLength(walletCount - 1); // Tous sauf le wallet 1
    expect(partialResults).toHaveLength(1); // Seulement le wallet 1
    expect(failedResults).toHaveLength(0);

    // Vérifier que le wallet 1 a échoué au collect
    const wallet1Result = results.find(r => r.wallet === wallets[1].address);
    expect(wallet1Result?.status).toBe('partial');
    expect(wallet1Result?.steps).toEqual(['bridge', 'swap', 'lp']);
    expect(wallet1Result?.error).toContain('Transaction reverted: collect failed');
  });
});
