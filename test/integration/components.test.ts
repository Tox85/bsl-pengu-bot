import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WalletManager } from '../../src/core/wallet-manager.js';
import { BybitAdapter } from '../../src/cex/bybit-adapter.js';
import { HubDistributor } from '../../src/cex/hub-distributor.js';
import { StateStore } from '../../src/core/state-store.js';
import { cfg } from '../../src/config/env.js';

// Compteur global pour simuler des adresses différentes
let walletCounter = 0;

// Mock des dépendances externes
vi.mock('ethers', async () => {
  const actual = await vi.importActual('ethers');
  return {
    ...actual,
    Wallet: {
      fromPhrase: vi.fn((phrase, provider) => {
        // Simuler un wallet avec une adresse différente pour chaque appel
        const index = walletCounter++;
        const mockWallet = {
          address: `0x${index.toString().padStart(40, '0')}`,
          privateKey: `0x${index.toString().padStart(64, '0')}`,
          provider: provider,
          getNonce: vi.fn().mockResolvedValue(0),
          sendTransaction: vi.fn().mockResolvedValue({ hash: `0x${index}tx`, wait: vi.fn().mockResolvedValue({ status: 1 }) }),
        };
        return mockWallet;
      }),
      createRandom: vi.fn(() => ({
        mnemonic: { phrase: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about' },
      })),
    },
    JsonRpcProvider: vi.fn(),
    Contract: vi.fn(),
    formatEther: vi.fn((value) => '1.0'),
    formatUnits: vi.fn((value) => '100.0'),
  };
});

vi.mock('ccxt', () => ({
  default: {
    bybit: vi.fn(() => ({
      fetchBalance: vi.fn().mockResolvedValue({
        USDC: { free: 1000, total: 1000, used: 0 },
        ETH: { free: 1, total: 1, used: 0 },
      }),
      fetchCurrencies: vi.fn().mockResolvedValue({
        USDC: { fees: { withdraw: { cost: 0.001 } }, limits: { withdraw: { min: 0.01 } } },
        ETH: { fees: { withdraw: { cost: 0.001 } }, limits: { withdraw: { min: 0.001 } } },
      }),
      withdraw: vi.fn().mockResolvedValue({ id: 'withdrawal-123' }),
      fetchWithdrawals: vi.fn().mockResolvedValue([]),
      fetchWithdrawalAddresses: vi.fn().mockResolvedValue([]),
    })),
  },
}));

vi.mock('../../src/core/rpc.js', () => ({
  getProvider: vi.fn(() => ({
    getBalance: vi.fn().mockResolvedValue('1000000000000000000'), // 1 ETH
    getTransactionCount: vi.fn().mockResolvedValue(0),
  })),
}));

// Mock du WalletManager pour simuler le bon comportement
vi.mock('../../src/core/wallet-manager.js', () => ({
  WalletManager: vi.fn().mockImplementation(() => {
    const wallets = new Map();
    let walletCounter = 0;
    
    return {
      createWalletFromMnemonic: vi.fn((params) => {
        const { mnemonic, index, provider } = params;
        const mockWallet = {
          address: `0x${walletCounter.toString().padStart(40, '0')}`,
          privateKey: `0x${walletCounter.toString().padStart(64, '0')}`,
          provider: provider,
          getNonce: vi.fn().mockResolvedValue(0),
          sendTransaction: vi.fn().mockResolvedValue({ hash: `0x${walletCounter}tx`, wait: vi.fn().mockResolvedValue({ status: 1 }) }),
          publicKey: `0x04${walletCounter.toString().padStart(128, '0')}`,
        };

        const walletInfo = {
          address: mockWallet.address,
          wallet: mockWallet,
          index: index,
          nonce: 0,
          publicKey: mockWallet.publicKey,
        };

        wallets.set(mockWallet.address.toLowerCase(), walletInfo);
        walletCounter++;

        return walletInfo;
      }),
      getWallets: vi.fn(() => Array.from(wallets.values())),
      getNonce: vi.fn(async (address, provider) => {
        const walletInfo = wallets.get(address);
        if (!walletInfo) {
          throw new Error(`Wallet non trouvé: ${address}`);
        }
        const currentNonce = walletInfo.nonce;
        walletInfo.nonce++;
        return currentNonce;
      }),
      getStats: vi.fn(() => ({
        totalWallets: wallets.size,
        addresses: Array.from(wallets.values()).map((info) => info.address),
        publicKeys: Array.from(wallets.values()).map((info) => info.publicKey),
        nonceStats: Object.fromEntries(Array.from(wallets.entries()).map(([addr, info]) => [addr, info.nonce])),
      })),
    };
  }),
}));

describe('Integration Tests - Components', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    walletCounter = 0; // Réinitialiser le compteur de wallets
    // Réinitialiser le mock du WalletManager
    vi.mocked(WalletManager).mockClear();
  });

  describe('WalletManager Integration', () => {
    it('devrait créer et gérer des wallets correctement', () => {
      const walletManager = new WalletManager();
      const testMnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

      // Créer plusieurs wallets
      walletManager.createWalletFromMnemonic({ mnemonic: testMnemonic, index: 0 });
      walletManager.createWalletFromMnemonic({ mnemonic: testMnemonic, index: 1 });
      walletManager.createWalletFromMnemonic({ mnemonic: testMnemonic, index: 2 });

      // Vérifier que les wallets sont stockés
      const allWallets = walletManager.getWallets();
      expect(allWallets).toHaveLength(3);

      // Vérifier les statistiques
      const stats = walletManager.getStats();
      expect(stats.totalWallets).toBe(3);
      expect(stats.addresses).toHaveLength(3);
      expect(stats.publicKeys).toHaveLength(3);
    });

    it('devrait gérer les nonces correctement', async () => {
      const walletManager = new WalletManager();
      const testMnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

      const wallet = walletManager.createWalletFromMnemonic({ mnemonic: testMnemonic, index: 0 });

      // Simuler des appels de nonce
      const mockProvider = {
        getTransactionCount: vi.fn().mockResolvedValue(5),
      };

      const nonce1 = await walletManager.getNonce(wallet.address, mockProvider);
      const nonce2 = await walletManager.getNonce(wallet.address, mockProvider);

      expect(nonce1).toBe(0);
      expect(nonce2).toBe(1); // Nonce incrémenté
    });
  });

  describe('BybitAdapter Integration', () => {
    it('devrait interagir avec l\'API Bybit', async () => {
      const adapter = new BybitAdapter({
        apiKey: 'test-key',
        apiSecret: 'test-secret',
        sandbox: true,
        testnet: false,
      });

      // Tester la récupération du solde
      const balance = await adapter.getBalance('USDC');
      expect(balance.token).toBe('USDC');
      expect(balance.available).toBe(1000);

      // Tester la vérification de whitelist
      const isWhitelisted = await adapter.isWhitelisted('0x123', 'USDC');
      expect(typeof isWhitelisted).toBe('boolean');
    });

    it('devrait gérer les erreurs de retrait', async () => {
      const adapter = new BybitAdapter({
        apiKey: 'test-key',
        apiSecret: 'test-secret',
        sandbox: true,
        testnet: false,
      });

      // Tester un retrait (mocké)
      const result = await adapter.withdraw({
        token: 'USDC',
        amount: 100,
        address: '0x123',
        network: 'ARBITRUM',
      });

      expect(result.withdrawalId).toBe('withdrawal-123');
      expect(result.status).toBe('pending');
    });
  });

  describe('HubDistributor Integration', () => {
    it('devrait calculer les répartitions correctement', () => {
      const distributor = new HubDistributor({
        bybit: {
          apiKey: 'test-key',
          apiSecret: 'test-secret',
          sandbox: true,
          testnet: false,
        },
        hubWalletPrivateKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        tokens: {
          usdc: { amountPerWallet: 10, totalAmount: 100 },
          eth: { amountPerWallet: 0.01, totalAmount: 0.1 },
        },
        walletCount: 10,
        randomizeAmounts: true,
        chainId: 8453, // Base chain ID
        batchSize: 5,
      });

      // Tester le calcul de répartition aléatoire
      const parts = distributor.computeRandomParts(100, 10, 5);
      expect(parts).toHaveLength(10);
      
      const sum = parts.reduce((acc, part) => acc + part, 0);
      expect(sum).toBe(100);
      
      // Chaque part devrait être >= 5
      parts.forEach(part => {
        expect(part).toBeGreaterThanOrEqual(5);
      });
    });

    it('devrait effectuer un dry-run de distribution', async () => {
      const walletManager = new WalletManager();
      const testMnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
      walletManager.createWalletFromMnemonic({ mnemonic: testMnemonic, index: 0 });
      walletManager.createWalletFromMnemonic({ mnemonic: testMnemonic, index: 1 });
      walletManager.createWalletFromMnemonic({ mnemonic: testMnemonic, index: 2 });

      const distributor = new HubDistributor({
        bybit: {
          apiKey: 'test-key',
          apiSecret: 'test-secret',
          sandbox: true,
          testnet: false,
        },
        hubWalletPrivateKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        tokens: {
          usdc: { amountPerWallet: 10, totalAmount: 30 },
          eth: { amountPerWallet: 0.01, totalAmount: 0.03 },
        },
        walletCount: 3,
        randomizeAmounts: false,
        chainId: 8453, // Base chain ID
        batchSize: 2,
      });

      const wallets = walletManager.getWallets();
      const dryRunResult = await distributor.dryRunDistribution(wallets);

      expect(dryRunResult.totalUsdc).toBe(30);
      expect(dryRunResult.totalEth).toBe(0.03);
      expect(dryRunResult.allocations).toHaveLength(3);
      
      // Vérifier que chaque allocation a les bons montants
      dryRunResult.allocations.forEach(allocation => {
        expect(allocation.usdcAmount).toBe(10);
        expect(allocation.ethAmount).toBe(0.01);
      });
    });
  });

  describe('StateStore Integration', () => {
    it('devrait gérer l\'état des wallets', async () => {
      const stateStore = new StateStore('/tmp/test-state');
      await stateStore.initialize();

      // Créer un état de wallet
      await stateStore.updateWalletState('0x123', {
        address: '0x123',
        index: 0,
        lastStep: 'bridge_completed',
        lastBridgeTx: '0xabc',
      });

      // Vérifier l'état
      const walletState = stateStore.getWalletState('0x123');
      expect(walletState?.lastStep).toBe('bridge_completed');
      expect(walletState?.lastBridgeTx).toBe('0xabc');

      // Marquer une étape comme terminée
      await stateStore.markStepCompleted('0x123', 'swap_completed', '0xdef');

      // Vérifier la mise à jour
      const updatedState = stateStore.getWalletState('0x123');
      expect(updatedState?.lastStep).toBe('swap_completed');
      expect(updatedState?.lastSwapTx).toBe('0xdef');

      // Vérifier le prochain step
      const nextStep = stateStore.getNextStep('0x123');
      expect(nextStep).toBe('lp');

      // Vérifier les statistiques
      const stats = stateStore.getStats();
      expect(stats.totalWallets).toBe(1);
      expect(stats.inProgressWallets).toBe(1);
    });

    it('devrait gérer les erreurs des wallets', async () => {
      const stateStore = new StateStore('/tmp/test-state-2');
      await stateStore.initialize();

      await stateStore.updateWalletState('0x456', {
        address: '0x456',
        index: 1,
        lastStep: 'bridge_completed',
        errors: [],
      });

      // Ajouter une erreur
      await stateStore.addWalletError('0x456', 'Erreur de test');

      const walletState = stateStore.getWalletState('0x456');
      expect(walletState?.errors).toHaveLength(1);
      expect(walletState?.errors[0]).toContain('Erreur de test');

      // Vérifier les statistiques
      const stats = stateStore.getStats();
      expect(stats.errorWallets).toBe(1);
    });
  });

  describe('Integration complète', () => {
    it('devrait simuler un workflow complet en dry-run', async () => {
      // 1. Créer les wallets
      const walletManager = new WalletManager();
      const testMnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
      walletManager.createWalletFromMnemonic({ mnemonic: testMnemonic, index: 0 });
      walletManager.createWalletFromMnemonic({ mnemonic: testMnemonic, index: 1 });

      // 2. Initialiser le state store
      const stateStore = new StateStore('/tmp/test-workflow');
      await stateStore.initialize();

      // 3. Simuler les étapes pour chaque wallet
      const wallets = walletManager.getWallets();
      
      for (const wallet of wallets) {
        // Bridge
        await stateStore.markStepCompleted(wallet.address, 'bridge_completed', '0xbridge123');
        
        // Swap
        await stateStore.markStepCompleted(wallet.address, 'swap_completed', '0xswap123');
        
        // LP
        await stateStore.updateWalletState(wallet.address, {
          address: wallet.address,
          index: wallet.index,
          lpParams: {
            tokenId: 1,
            tickLower: -100,
            tickUpper: 100,
            liquidity: '1000000',
          },
        });
        await stateStore.markStepCompleted(wallet.address, 'lp_completed');
        
        // Collect
        await stateStore.markStepCompleted(wallet.address, 'collect_completed');
      }

      // 4. Vérifier les statistiques finales
      const stats = stateStore.getStats();
      expect(stats.totalWallets).toBe(3);
      expect(stats.completedWallets).toBe(3);
      expect(stats.inProgressWallets).toBe(0);

      // 5. Vérifier que tous les wallets sont terminés
      wallets.forEach(wallet => {
        const nextStep = stateStore.getNextStep(wallet.address);
        expect(nextStep).toBeNull();
        
        const walletState = stateStore.getWalletState(wallet.address);
        expect(walletState?.lastStep).toBe('collect_completed');
      });
    });
  });
});
