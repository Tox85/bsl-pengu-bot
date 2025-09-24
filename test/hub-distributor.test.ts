import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ethers } from 'ethers';
import { HubDistributor } from '../src/cex/hub-distributor.js';
import { WalletManager, type WalletInfo } from '../src/core/wallet-manager.js';
import { BybitAdapter } from '../src/cex/bybit-adapter.js';

// Mock ethers
vi.mock('ethers', async () => {
  const actual = await vi.importActual('ethers');
  const mockWallet = {
    address: '0x742d35Cc6634C0532925a3b8D1B2b3b4C5D6E7F8',
    privateKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    publicKey: '0x04742d35Cc6634C0532925a3b8D1B2b3b4C5D6E7F8',
  };
  
  return {
    ...actual,
    Wallet: vi.fn().mockImplementation(() => mockWallet),
    Contract: vi.fn(),
  };
});

// Mock du WalletManager
vi.mock('../src/core/wallet-manager.js', () => ({
  WalletManager: vi.fn(),
}));

// Mock du BybitAdapter
vi.mock('../src/cex/bybit-adapter.js', () => ({
  BybitAdapter: vi.fn(),
  createBybitAdapter: vi.fn(),
}));

// Mock du provider
const mockProvider = {
  getBalance: vi.fn(),
  getTransactionCount: vi.fn(),
} as any;

// Mock du wallet Hub
const mockHubWallet = {
  address: '0xHubWallet1234567890abcdef1234567890abcdef',
  privateKey: '0xHubPrivateKey1234567890abcdef1234567890abcdef',
  sendTransaction: vi.fn(),
} as any;

// Mock du contrat ERC20
const mockERC20Contract = {
  balanceOf: vi.fn(),
  decimals: vi.fn(),
  transfer: vi.fn(),
} as any;

describe('HubDistributor', () => {
  let hubDistributor: HubDistributor;
  let mockWalletManager: any;
  let mockBybitAdapter: any;

  const config = {
    bybit: {
      apiKey: 'test-api-key',
      apiSecret: 'test-api-secret',
      sandbox: false,
      testnet: false,
    },
    hubWalletPrivateKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
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
    chainId: 2741, // Abstract
    batchSize: 10,
  };

  beforeEach(() => {
    // Mock du WalletManager
    mockWalletManager = {
      createMultipleWallets: vi.fn(),
      getWallets: vi.fn(),
      getStats: vi.fn(),
    };

    // Mock du BybitAdapter
    mockBybitAdapter = {
      withdraw: vi.fn(),
      waitForWithdrawalCompletion: vi.fn(),
      calculateRandomAmounts: vi.fn(),
      getBalance: vi.fn(),
    };

    // Mock des constructeurs
    vi.mocked(ethers.Wallet).mockReturnValue(mockHubWallet);
    vi.mocked(ethers.Contract).mockReturnValue(mockERC20Contract);
    vi.mocked(WalletManager).mockReturnValue(mockWalletManager);
    vi.mocked(BybitAdapter).mockReturnValue(mockBybitAdapter);

    hubDistributor = new HubDistributor(config);
    vi.clearAllMocks();
  });

  describe('executeFullDistribution', () => {
    it('devrait exécuter la distribution complète avec succès', async () => {
      const mockWallets: WalletInfo[] = [
        {
          address: '0x742d35Cc6634C0532925a3b8D1B2b3b4C5D6E7F8',
          wallet: {} as any,
          index: 0,
          nonce: 0,
          publicKey: '0x04742d35Cc6634C0532925a3b8D1B2b3b4C5D6E7F8',
        },
        {
          address: '0x842d35Cc6634C0532925a3b8D1B2b3b4C5D6E7F9',
          wallet: {} as any,
          index: 1,
          nonce: 0,
          publicKey: '0x04842d35Cc6634C0532925a3b8D1B2b3b4C5D6E7F9',
        },
      ];

      // Mock des retraits Bybit
      mockBybitAdapter.withdraw.mockResolvedValue({
        success: true,
        withdrawalId: 'withdrawal-123',
        txHash: '0xBybitTx123',
      });

      mockBybitAdapter.waitForWithdrawalCompletion.mockResolvedValue({
        withdrawalId: 'withdrawal-123',
        status: 'completed',
        amount: 1000,
        token: 'USDC',
        address: mockHubWallet.address,
      });

      // Mock des balances du Hub
      mockERC20Contract.balanceOf.mockResolvedValue(ethers.parseUnits('1000', 6)); // 1000 USDC
      mockERC20Contract.decimals.mockResolvedValue(6);
      mockProvider.getBalance.mockResolvedValue(ethers.parseEther('0.5')); // 0.5 ETH

      // Mock des transactions de distribution
      const mockTx = { hash: '0xDistributionTx123' };
      mockHubWallet.sendTransaction.mockResolvedValue(mockTx);
      mockERC20Contract.transfer.mockResolvedValue(mockTx);

      const result = await hubDistributor.executeFullDistribution(mockWallets);

      expect(result.success).toBe(true);
      expect(result.totalDistributed.usdc).toBeGreaterThan(0);
      expect(result.totalDistributed.eth).toBeGreaterThan(0);
      expect(result.transactions.usdc.length).toBeGreaterThan(0);
      expect(result.transactions.eth.length).toBeGreaterThan(0);
    });

    it('devrait gérer les erreurs de distribution', async () => {
      const mockWallets: WalletInfo[] = [
        {
          address: '0x742d35Cc6634C0532925a3b8D1B2b3b4C5D6E7F8',
          wallet: {} as any,
          index: 0,
          nonce: 0,
          publicKey: '0x04742d35Cc6634C0532925a3b8D1B2b3b4C5D6E7F8',
        },
      ];

      // Mock d'une erreur de retrait Bybit
      mockBybitAdapter.withdraw.mockRejectedValue(new Error('Bybit withdrawal failed'));

      const result = await hubDistributor.executeFullDistribution(mockWallets);

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('checkHubBalances', () => {
    it('devrait vérifier les balances du Hub', async () => {
      mockERC20Contract.balanceOf.mockResolvedValue(ethers.parseUnits('1000', 6)); // 1000 USDC
      mockERC20Contract.decimals.mockResolvedValue(6);
      mockProvider.getBalance.mockResolvedValue(ethers.parseEther('0.5')); // 0.5 ETH

      const balances = await hubDistributor.checkHubBalances();

      expect(balances.usdc).toBe(1000);
      expect(balances.eth).toBe(0.5);
    });

    it('devrait gérer les erreurs de récupération de balance', async () => {
      mockERC20Contract.balanceOf.mockRejectedValue(new Error('Contract error'));
      mockProvider.getBalance.mockResolvedValue(ethers.parseEther('0.5'));

      const balances = await hubDistributor.checkHubBalances();

      expect(balances.usdc).toBe(0);
      expect(balances.eth).toBe(0.5);
    });
  });

  describe('waitForHubFunding', () => {
    it('devrait attendre que les fonds arrivent sur le Hub', async () => {
      // Mock des balances qui augmentent progressivement
      mockERC20Contract.balanceOf
        .mockResolvedValueOnce(ethers.parseUnits('100', 6)) // Premier check
        .mockResolvedValueOnce(ethers.parseUnits('500', 6)) // Deuxième check
        .mockResolvedValueOnce(ethers.parseUnits('1000', 6)); // Troisième check (suffisant)

      mockERC20Contract.decimals.mockResolvedValue(6);
      mockProvider.getBalance.mockResolvedValue(ethers.parseEther('0.5'));

      await expect(hubDistributor.waitForHubFunding(1000, 0.5, 1000, 100)).resolves.not.toThrow();
    });

    it('devrait gérer le timeout d\'attente', async () => {
      // Mock des balances qui restent insuffisantes
      mockERC20Contract.balanceOf.mockResolvedValue(ethers.parseUnits('100', 6)); // Toujours insuffisant
      mockERC20Contract.decimals.mockResolvedValue(6);
      mockProvider.getBalance.mockResolvedValue(ethers.parseEther('0.1')); // Insuffisant

      await expect(hubDistributor.waitForHubFunding(1000, 0.5, 100, 50)).rejects.toThrow('Timeout d\'attente');
    });
  });

  describe('calculateDistributionAmounts', () => {
    it('devrait calculer les montants de distribution', () => {
      // Mock de la méthode privée via une méthode publique
      const hubDistributor = new HubDistributor(config);
      
      // Créer des wallets de test
      const mockWallets: WalletInfo[] = [
        { address: '0x1', wallet: {} as any, index: 0, nonce: 0, publicKey: '0x041' },
        { address: '0x2', wallet: {} as any, index: 1, nonce: 0, publicKey: '0x042' },
        { address: '0x3', wallet: {} as any, index: 2, nonce: 0, publicKey: '0x043' },
      ];

      // Mock calculateRandomAmounts
      mockBybitAdapter.calculateRandomAmounts.mockReturnValue([10, 10, 10]);

      // Utiliser une méthode publique qui appelle calculateDistributionAmounts
      const result = (hubDistributor as any).calculateDistributionAmounts(3);

      expect(result.usdc).toHaveLength(3);
      expect(result.eth).toHaveLength(3);
    });
  });

  describe('sendTokenToWallet', () => {
    it('devrait envoyer des ETH à un wallet', async () => {
      const mockTx = { hash: '0xEthTx123' };
      mockHubWallet.sendTransaction.mockResolvedValue(mockTx);

      const hubDistributor = new HubDistributor(config);
      const result = await (hubDistributor as any).sendTokenToWallet(
        'ETH',
        '0x0000000000000000000000000000000000000000',
        '0x742d35Cc6634C0532925a3b8D1B2b3b4C5D6E7F8',
        0.1
      );

      expect(result).toBe('0xEthTx123');
      expect(mockHubWallet.sendTransaction).toHaveBeenCalledWith({
        to: '0x742d35Cc6634C0532925a3b8D1B2b3b4C5D6E7F8',
        value: ethers.parseEther('0.1'),
        gasLimit: undefined,
      });
    });

    it('devrait envoyer des tokens ERC20 à un wallet', async () => {
      const mockTx = { hash: '0xERC20Tx123' };
      mockERC20Contract.transfer.mockResolvedValue(mockTx);
      mockERC20Contract.decimals.mockResolvedValue(6);

      const hubDistributor = new HubDistributor(config);
      const result = await (hubDistributor as any).sendTokenToWallet(
        'USDC',
        '0xUSDCContract1234567890abcdef1234567890abcdef',
        '0x742d35Cc6634C0532925a3b8D1B2b3b4C5D6E7F8',
        100
      );

      expect(result).toBe('0xERC20Tx123');
      expect(mockERC20Contract.transfer).toHaveBeenCalledWith(
        '0x742d35Cc6634C0532925a3b8D1B2b3b4C5D6E7F8',
        ethers.parseUnits('100', 6),
        { gasLimit: undefined }
      );
    });
  });

  describe('distributeToken', () => {
    it('devrait distribuer un token vers plusieurs wallets', async () => {
      const mockWallets: WalletInfo[] = [
        { address: '0x1', wallet: {} as any, index: 0, nonce: 0, publicKey: '0x041' },
        { address: '0x2', wallet: {} as any, index: 1, nonce: 0, publicKey: '0x042' },
      ];

      const amounts = [10, 10];
      const mockTx = { hash: '0xDistributionTx123' };
      mockERC20Contract.transfer.mockResolvedValue(mockTx);
      mockERC20Contract.decimals.mockResolvedValue(6);

      const hubDistributor = new HubDistributor(config);
      const result = await (hubDistributor as any).distributeToken(
        'USDC',
        '0xUSDCContract1234567890abcdef1234567890abcdef',
        amounts,
        mockWallets
      );

      expect(result.transactions).toHaveLength(2);
      expect(result.totalDistributed).toBe(20);
      expect(result.errors).toHaveLength(0);
    });

    it('devrait gérer les erreurs de distribution', async () => {
      const mockWallets: WalletInfo[] = [
        { address: '0x1', wallet: {} as any, index: 0, nonce: 0, publicKey: '0x041' },
        { address: '0x2', wallet: {} as any, index: 1, nonce: 0, publicKey: '0x042' },
      ];

      const amounts = [10, 10];
      
      // Mock d'une erreur sur le premier transfert
      mockERC20Contract.transfer
        .mockRejectedValueOnce(new Error('Transfer failed'))
        .mockResolvedValueOnce({ hash: '0xSuccessTx123' });
      mockERC20Contract.decimals.mockResolvedValue(6);

      const hubDistributor = new HubDistributor(config);
      const result = await (hubDistributor as any).distributeToken(
        'USDC',
        '0xUSDCContract1234567890abcdef1234567890abcdef',
        amounts,
        mockWallets
      );

      expect(result.transactions).toHaveLength(1);
      expect(result.totalDistributed).toBe(10);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Transfer failed');
    });
  });
});
