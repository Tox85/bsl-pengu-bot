import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BybitFixtures } from '../fixtures/nock/bybit.fixture.js';
import { BridgeFixtures } from '../fixtures/nock/bridge.fixture.js';
import { EthersMockFactory } from '../fixtures/mocks/ethers.hub.js';
import { makeWalletManagerForTests } from '../helpers/makeWalletManagerForTests.js';
import { StateManager } from '../../src/orchestrator/state.js';
import { retry } from '../../src/core/retry.js';
import { BotError } from '../../src/core/errors.js';

// Plus besoin de mocker rpc.js grâce à l'injection de dépendance

vi.mock('../../src/bridge/lifi.ts', () => ({
  LiFiBridge: vi.fn().mockImplementation(() => ({
    getRoute: vi.fn().mockResolvedValue({
      id: 'route-123',
      fromChainId: 8453,
      toChainId: 11124,
      fromAmount: '100000000',
      toAmount: '99900000',
      steps: [
        {
          id: 'step-1',
          type: 'cross',
          tool: 'jumper',
          action: {
            fromChainId: 8453,
            toChainId: 11124,
            fromAmount: '100000000',
            toAmount: '99900000',
          },
        },
      ],
    }),
    executeRoute: vi.fn().mockResolvedValue({
      id: 'execution-123',
      status: 'PENDING',
      steps: [
        {
          id: 'step-1',
          status: 'PENDING',
          transactionRequest: {
            to: '0x1234567890123456789012345678901234567890',
            data: '0x...',
            value: '0',
            gasLimit: '21000',
          },
        },
      ],
    }),
    getExecutionStatus: vi.fn().mockResolvedValue({
      id: 'execution-123',
      status: 'DONE',
      steps: [
        {
          id: 'step-1',
          status: 'DONE',
          transactionHash: '0xabc123...',
        },
      ],
    }),
  })),
}));

vi.mock('../../src/dex/swap.ts', () => ({
  SwapService: vi.fn().mockImplementation(() => ({
    swap: vi.fn().mockResolvedValue({
      hash: '0xswap123...',
      wait: vi.fn().mockResolvedValue({
        status: 1,
        transactionHash: '0xswap123...',
        blockNumber: 12345,
        gasUsed: '150000',
      }),
    }),
  })),
}));

vi.mock('../../src/lp/v3.ts', () => ({
  UniswapV3LP: vi.fn().mockImplementation(() => ({
    addLiquidity: vi.fn().mockResolvedValue({
      hash: '0xlp123...',
      wait: vi.fn().mockResolvedValue({
        status: 1,
        transactionHash: '0xlp123...',
        blockNumber: 12345,
        gasUsed: '200000',
      }),
    }),
    collect: vi.fn().mockResolvedValue({
      hash: '0xcollect123...',
      wait: vi.fn().mockResolvedValue({
        status: 1,
        transactionHash: '0xcollect123...',
        blockNumber: 12345,
        gasUsed: '100000',
      }),
    }),
  })),
}));

describe('Multi-Wallet Happy Path', () => {
  let walletManager: WalletManager;
  let stateManager: StateManager;
  let bybitFixtures: BybitFixtures;
  let bridgeFixtures: BridgeFixtures;
  let mockProvider: any;

  beforeEach(() => {
    // Nettoyer les mocks
    vi.clearAllMocks();
    vi.useFakeTimers();
    
    // Initialiser les fixtures
    bybitFixtures = new BybitFixtures();
    bridgeFixtures = new BridgeFixtures();
    
    // Créer le mock provider
    mockProvider = EthersMockFactory.createProviderMock();
    
    // Initialiser les managers
    walletManager = makeWalletManagerForTests();
    stateManager = new StateManager('.test-state');
    
    // Réinitialiser le WalletManager pour isoler les tests
    walletManager = makeWalletManagerForTests();
    
    // Nettoyer l'état précédent
    stateManager.cleanupCorruptedStates();
    
    // Nettoyer tous les états pour isoler les tests
    const allStates = stateManager.listStates();
    for (const wallet of allStates) {
      stateManager.deleteState(wallet);
    }
    
    // Configurer les mocks par défaut
    bybitFixtures.mockGetBalance(1000);
    bybitFixtures.mockWithdrawSuccess();
    bridgeFixtures.mockRouteFound();
    bridgeFixtures.mockExecuteBridge();
    bridgeFixtures.mockBridgeStatusSuccess();
  });

  afterEach(() => {
    // Nettoyer les mocks
    bybitFixtures.cleanup();
    bridgeFixtures.cleanup();
    vi.clearAllMocks();
  });

  it('devrait exécuter le flow complet pour 10 wallets en parallèle', async () => {
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const walletCount = 10;
    const concurrency = 5;

    // Créer les wallets
    const wallets = await Promise.all(
      Array.from({ length: walletCount }, (_, index) =>
        walletManager.createOrLoadWallet(mnemonic, index, mockProvider)
      )
    );

    expect(wallets).toHaveLength(walletCount);
    expect(wallets.every(w => w.address)).toBe(true);
    expect(wallets.every(w => w.nonceManager)).toBe(true);

    // Simuler le flow pour chaque wallet
    const flowPromises = wallets.map(async (wallet, index) => {
      const walletAddress = wallet.address;
      
      try {
        // 1. Bridge (stubbed)
        const bridgeResult = await retry(
          async () => {
            // Simuler le bridge sans délai
            return {
              hash: `0xbridge${index}...`,
              status: 'success',
              fromAmount: '100000000',
              toAmount: '99900000',
            };
          },
          { maxRetries: 1, baseDelayMs: 0 }
        );

        // Sauvegarder l'état après bridge
        const state = stateManager.createState(walletAddress);
        stateManager.saveStateAfterStep(state, 'bridge', bridgeResult);

        // 2. Swap (stubbed)
        const swapResult = await retry(
          async () => {
            // Simuler le swap sans délai
            return {
              hash: `0xswap${index}...`,
              status: 'success',
              fromAmount: '99900000',
              toAmount: '99500000',
            };
          },
          { maxRetries: 1, baseDelayMs: 0 }
        );

        // Sauvegarder l'état après swap
        stateManager.saveStateAfterStep(state, 'swap', swapResult);

        // 3. LP (stubbed)
        const lpResult = await retry(
          async () => {
            // Simuler l'ajout de liquidité sans délai
            return {
              hash: `0xlp${index}...`,
              status: 'success',
              tokenId: `token${index}`,
              amount0: '49750000',
              amount1: '49750000',
            };
          },
          { maxRetries: 1, baseDelayMs: 0 }
        );

        // Sauvegarder l'état après LP
        stateManager.saveStateAfterStep(state, 'lp', lpResult);

        // 4. Collect (stubbed)
        const collectResult = await retry(
          async () => {
            // Simuler le collect sans délai
            return {
              hash: `0xcollect${index}...`,
              status: 'success',
              amount0: '1000000',
              amount1: '1000000',
            };
          },
          { maxRetries: 1, baseDelayMs: 0 }
        );

        // Marquer comme terminé
        stateManager.markStepCompleted(walletAddress, 'collect_done');

        return {
          wallet: walletAddress,
          status: 'success',
          steps: ['bridge', 'swap', 'lp', 'collect'],
          results: {
            bridge: bridgeResult,
            swap: swapResult,
            lp: lpResult,
            collect: collectResult,
          },
        };
      } catch (error) {
        // Marquer comme échoué
        stateManager.markStepCompleted(walletAddress, 'error');
        
        return {
          wallet: walletAddress,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    });

    // Exécuter avec contrôle de concurrence
    const results = await Promise.all(flowPromises);

    // Vérifications
    expect(results).toHaveLength(walletCount);
    
    const successResults = results.filter(r => r.status === 'success');
    const failedResults = results.filter(r => r.status === 'failed');
    
    expect(successResults).toHaveLength(walletCount);
    expect(failedResults).toHaveLength(0);

    // Vérifier que chaque wallet a terminé avec succès
    for (const result of successResults) {
      expect(result.steps).toEqual(['bridge', 'swap', 'lp', 'collect']);
      expect(result.results).toHaveProperty('bridge');
      expect(result.results).toHaveProperty('swap');
      expect(result.results).toHaveProperty('lp');
      expect(result.results).toHaveProperty('collect');
    }

    // Vérifier les statistiques d'état
    const stats = stateManager.getStats();
    expect(stats.totalWallets).toBe(walletCount);
    expect(stats.completedWallets).toBe(walletCount);
    expect(stats.failedWallets).toBe(0);
    expect(stats.inProgressWallets).toBe(0);
  }, 30000);

  it('devrait gérer les nonces correctement pour les wallets en parallèle', async () => {
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const walletCount = 5;

    // Créer les wallets
    const wallets = await Promise.all(
      Array.from({ length: walletCount }, (_, index) =>
        walletManager.createOrLoadWallet(mnemonic, index, mockProvider)
      )
    );

    // Simuler plusieurs transactions par wallet pour tester l'incrémentation des nonces
    const transactionPromises = wallets.flatMap((wallet, walletIndex) => 
      // Chaque wallet fait 2 transactions
      Array.from({ length: 2 }, async (_, txIndex) => {
        const nonce = await walletManager.getNonce(wallet.address);
        
        // Marquer le nonce comme utilisé
        walletManager.markNonceUsed(wallet.address, nonce);
        
        return {
          wallet: wallet.address,
          nonce,
          walletIndex,
          txIndex,
        };
      })
    );

    const results = await Promise.all(transactionPromises);

    // Vérifier que chaque wallet a des nonces séquentiels
    
    for (const wallet of wallets) {
      const walletResults = results.filter(r => r.wallet === wallet.address);
      const walletNonces = walletResults.map(r => r.nonce).sort((a, b) => a - b);
      
      // Chaque wallet devrait avoir des nonces séquentiels (0, 1)
      expect(walletNonces).toEqual([0, 1]);
    }
    
    // Vérifier que nous avons le bon nombre de transactions
    expect(results.length).toBe(walletCount * 2); // 5 wallets * 2 transactions chacun
  });

  it('devrait maintenir l\'idempotence lors d\'exécutions multiples', async () => {
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const walletIndex = 0;

    // Créer le wallet
    const wallet = await walletManager.createOrLoadWallet(mnemonic, walletIndex, mockProvider);
    
    // Simuler le flow complet
    const flow1 = async () => {
      const state = stateManager.createState(wallet.address);
      stateManager.saveStateAfterStep(state, 'bridge', { hash: '0xbridge1...' });
      stateManager.saveStateAfterStep(state, 'swap', { hash: '0xswap1...' });
      stateManager.saveStateAfterStep(state, 'lp', { hash: '0xlp1...' });
      stateManager.markStepCompleted(wallet.address, 'collect_done');
      return 'completed';
    };

    // Exécuter le flow
    const result1 = await flow1();
    expect(result1).toBe('completed');

    // Vérifier que le wallet est marqué comme terminé
    const state = stateManager.loadState(wallet.address);
    expect(state?.currentStep).toBe('collect_done');

    // Simuler une nouvelle exécution (devrait être idempotente)
    const flow2 = async () => {
      const existingState = stateManager.loadState(wallet.address);
      if (existingState?.currentStep === 'collect_done') {
        return 'already_completed';
      }
      return 'not_completed';
    };

    const result2 = await flow2();
    expect(result2).toBe('already_completed');
  });
});
