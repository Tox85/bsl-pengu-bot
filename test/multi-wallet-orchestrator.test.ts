import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MultiWalletOrchestrator } from '../src/orchestrator/multi-wallet-orchestrator.js';
import { WalletManager, type WalletInfo } from '../src/core/wallet-manager.js';
import { HubDistributor } from '../src/cex/hub-distributor.js';
import { OrchestratorService } from '../src/orchestrator/run.js';

// Mock des dépendances
vi.mock('../src/core/wallet-manager.js', () => ({
  WalletManager: vi.fn(),
}));

vi.mock('../src/cex/hub-distributor.js', () => ({
  HubDistributor: vi.fn(),
}));

vi.mock('../src/orchestrator/run.js', () => ({
  OrchestratorService: vi.fn(),
}));

describe('MultiWalletOrchestrator', () => {
  let multiWalletOrchestrator: MultiWalletOrchestrator;
  let mockWalletManager: any;
  let mockHubDistributor: any;
  let mockOrchestratorService: any;

  const config = {
    distributionConfig: {
      bybit: {
        apiKey: 'test-api-key',
        apiSecret: 'test-api-secret',
        sandbox: false,
        testnet: false,
      },
      hubWalletPrivateKey: '0xHubPrivateKey1234567890abcdef1234567890abcdef',
      tokens: {
        usdc: {
          amountPerWallet: 10.0,
          totalAmount: 1000.0,
        },
        eth: {
          amountPerWallet: 0.005,
          totalAmount: 0.5,
        },
      },
      walletCount: 100,
      randomizeAmounts: true,
      minAmountVariation: 0.1,
      chainId: 2741,
      batchSize: 10,
    },
    walletCount: 100,
    mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    sequential: true,
    maxConcurrentWallets: 5,
    defiParams: {
      bridgeAmount: '1',
      bridgeToken: 'USDC' as const,
      swapAmount: '5',
      swapPair: 'PENGU/USDC' as const,
      lpRangePercent: 5,
      collectAfterMinutes: 10,
      dryRun: true,
      autoGasTopUp: false,
      minNativeOnDest: '0.001',
      gasTopUpTarget: '0.01',
      routerOverride: undefined,
      npmOverride: undefined,
      factoryOverride: undefined,
      autoTokenTopUp: false,
      tokenTopUpSafetyBps: 100,
      tokenTopUpMin: '1',
      tokenTopUpSourceChainId: 8453,
      tokenTopUpMaxWaitSec: 300,
    },
  };

  beforeEach(() => {
    // Mock du WalletManager
    mockWalletManager = {
      createMultipleWallets: vi.fn(),
      getWallets: vi.fn(),
      getStats: vi.fn(),
    };

    // Mock du HubDistributor
    mockHubDistributor = {
      executeFullDistribution: vi.fn(),
      checkHubBalances: vi.fn(),
    };

    // Mock du OrchestratorService
    mockOrchestratorService = {
      run: vi.fn(),
    };

    // Mock des constructeurs
    vi.mocked(WalletManager).mockImplementation(() => mockWalletManager);
    vi.mocked(HubDistributor).mockImplementation(() => mockHubDistributor);
    vi.mocked(OrchestratorService).mockImplementation(() => mockOrchestratorService);

    multiWalletOrchestrator = new MultiWalletOrchestrator(config);
    vi.clearAllMocks();
  });

  describe('execute', () => {
    it('devrait exécuter l\'orchestration complète avec succès', async () => {
      const mockWallets: WalletInfo[] = [
        {
          address: '0x742d35Cc6634C0532925a3b8D1B2b3b4C5D6E7F8',
          wallet: {} as any,
          index: 0,
          nonce: 0,
        },
        {
          address: '0x842d35Cc6634C0532925a3b8D1B2b3b4C5D6E7F9',
          wallet: {} as any,
          index: 1,
          nonce: 0,
        },
      ];

      mockWalletManager.createMultipleWallets.mockResolvedValue(mockWallets);
      mockHubDistributor.executeFullDistribution.mockResolvedValue({
        success: true,
        totalDistributed: 100,
        distributionResults: [],
      });
      mockOrchestratorService.run.mockResolvedValue({
        success: true,
        finalState: {
          step: 'collect_done',
          bridgeResult: { txHash: '0x123' },
          swapResult: { txHash: '0x456' },
          lpResult: { tokenId: 1 },
          collectResult: { feesCollected: 10 },
        },
      });

      const result = await multiWalletOrchestrator.execute();

      expect(result.success).toBe(true);
      expect(mockWalletManager.createMultipleWallets).toHaveBeenCalled();
      expect(mockHubDistributor.executeFullDistribution).toHaveBeenCalled();
      expect(mockOrchestratorService.run).toHaveBeenCalledTimes(2);
    });

    it('devrait gérer les erreurs lors de la création des wallets', async () => {
      mockWalletManager.createMultipleWallets.mockRejectedValue(new Error('Erreur de création'));

      const result = await multiWalletOrchestrator.execute();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Erreur de création');
    });

    it('devrait gérer les erreurs lors de la distribution', async () => {
      const mockWallets: WalletInfo[] = [
        {
          address: '0x742d35Cc6634C0532925a3b8D1B2b3b4C5D6E7F8',
          wallet: {} as any,
          index: 0,
          nonce: 0,
        },
      ];

      mockWalletManager.createMultipleWallets.mockResolvedValue(mockWallets);
      mockHubDistributor.executeFullDistribution.mockRejectedValue(new Error('Erreur de distribution'));

      const result = await multiWalletOrchestrator.execute();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Erreur de distribution');
    });
  });

  describe('executeSequential', () => {
    it('devrait exécuter les wallets séquentiellement', async () => {
      const mockWallets: WalletInfo[] = [
        {
          address: '0x742d35Cc6634C0532925a3b8D1B2b3b4C5D6E7F8',
          wallet: {} as any,
          index: 0,
          nonce: 0,
        },
        {
          address: '0x842d35Cc6634C0532925a3b8D1B2b3b4C5D6E7F9',
          wallet: {} as any,
          index: 1,
          nonce: 0,
        },
      ];

      mockOrchestratorService.run.mockResolvedValue({
        success: true,
        finalState: {
          step: 'collect_done',
          bridgeResult: { txHash: '0x123' },
          swapResult: { txHash: '0x456' },
          lpResult: { tokenId: 1 },
          collectResult: { feesCollected: 10 },
        },
      });

      const result = await multiWalletOrchestrator.executeSequential(mockWallets);

      expect(result.success).toBe(true);
      expect(mockOrchestratorService.run).toHaveBeenCalledTimes(2);
    });
  });

  describe('executeParallel', () => {
    it('devrait exécuter les wallets en parallèle par batches', async () => {
      const mockWallets: WalletInfo[] = [
        {
          address: '0x742d35Cc6634C0532925a3b8D1B2b3b4C5D6E7F8',
          wallet: {} as any,
          index: 0,
          nonce: 0,
        },
        {
          address: '0x842d35Cc6634C0532925a3b8D1B2b3b4C5D6E7F9',
          wallet: {} as any,
          index: 1,
          nonce: 0,
        },
      ];

      mockOrchestratorService.run.mockResolvedValue({
        success: true,
        finalState: {
          step: 'collect_done',
          bridgeResult: { txHash: '0x123' },
          swapResult: { txHash: '0x456' },
          lpResult: { tokenId: 1 },
          collectResult: { feesCollected: 10 },
        },
      });

      const result = await multiWalletOrchestrator.executeParallel(mockWallets, 2);

      expect(result.success).toBe(true);
      expect(mockOrchestratorService.run).toHaveBeenCalledTimes(2);
    });
  });

  describe('executeWalletDefiSequence', () => {
    it('devrait exécuter la séquence DeFi pour un wallet', async () => {
      const mockWallet: WalletInfo = {
        address: '0x742d35Cc6634C0532925a3b8D1B2b3b4C5D6E7F8',
        wallet: {} as any,
        index: 0,
        nonce: 0,
      };

      mockOrchestratorService.run.mockResolvedValue({
        success: true,
        finalState: {
          step: 'collect_done',
          bridgeResult: { txHash: '0x123' },
          swapResult: { txHash: '0x456' },
          lpResult: { tokenId: 1 },
          collectResult: { feesCollected: 10 },
        },
      });

      const result = await multiWalletOrchestrator.executeWalletDefiSequence(mockWallet, 0);

      expect(result.success).toBe(true);
      expect(mockOrchestratorService.run).toHaveBeenCalledWith({
        privateKey: mockWallet.wallet.privateKey,
        ...config.defiParams,
      });
    });
  });

  describe('getWalletStats', () => {
    it('devrait retourner les statistiques des wallets', () => {
      const mockStats = {
        totalWallets: 2,
        walletAddresses: ['0x742d35Cc6634C0532925a3b8D1B2b3b4C5D6E7F8', '0x842d35Cc6634C0532925a3b8D1B2b3b4C5D6E7F9'],
        nonceStats: { '0x742d35Cc6634C0532925a3b8D1B2b3b4C5D6E7F8': 0, '0x842d35Cc6634C0532925a3b8D1B2b3b4C5D6E7F9': 0 },
      };

      mockWalletManager.getStats.mockReturnValue(mockStats);

      const result = multiWalletOrchestrator.getWalletStats();

      expect(result).toEqual(mockStats);
      expect(mockWalletManager.getStats).toHaveBeenCalled();
    });
  });
});
