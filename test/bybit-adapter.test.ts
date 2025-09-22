import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BybitAdapter } from '../src/cex/bybit-adapter.js';
import { InsufficientBalanceError, AddressNotWhitelistedError, MinimumAmountError } from '../src/cex/types.js';

// Mock ccxt
vi.mock('ccxt', () => {
  const mockClient = {
    fetchBalance: vi.fn(),
    withdraw: vi.fn(),
    fetchWithdrawals: vi.fn(),
    fetchWithdrawalAddresses: vi.fn(),
    fetchCurrencies: vi.fn(),
  };

  return {
    default: {
      bybit: vi.fn(() => mockClient),
    },
  };
});

describe('BybitAdapter', () => {
  let bybitAdapter: BybitAdapter;
  let mockClient: any;

  const config = {
    apiKey: 'test-api-key',
    apiSecret: 'test-api-secret',
    sandbox: false,
    testnet: false,
  };

  beforeEach(async () => {
    const ccxt = await import('ccxt');
    mockClient = new ccxt.default.bybit();
    bybitAdapter = new BybitAdapter(config);
    vi.clearAllMocks();
  });

  describe('getBalance', () => {
    it('devrait récupérer le solde d\'un token', async () => {
      const mockBalance = {
        USDC: {
          free: 1000,
          total: 1000,
          used: 0,
        },
      };

      mockClient.fetchBalance.mockResolvedValue(mockBalance);

      const result = await bybitAdapter.getBalance('USDC');

      expect(mockClient.fetchBalance).toHaveBeenCalled();
      expect(result.token).toBe('USDC');
      expect(result.available).toBe(1000);
      expect(result.total).toBe(1000);
      expect(result.frozen).toBe(0);
    });

    it('devrait retourner 0 pour un token inexistant', async () => {
      mockClient.fetchBalance.mockResolvedValue({});

      const result = await bybitAdapter.getBalance('UNKNOWN');

      expect(result.token).toBe('UNKNOWN');
      expect(result.available).toBe(0);
      expect(result.total).toBe(0);
    });

    it('devrait gérer les erreurs', async () => {
      mockClient.fetchBalance.mockRejectedValue(new Error('API Error'));

      await expect(bybitAdapter.getBalance('USDC')).rejects.toThrow('API Error');
    });
  });

  describe('withdraw', () => {
    it('devrait effectuer un retrait avec succès', async () => {
      const mockBalance = {
        USDC: {
          free: 1000,
          total: 1000,
          used: 0,
        },
      };

      const mockWithdrawal = {
        id: 'withdrawal-123',
        status: 'pending',
        txid: '0x1234567890abcdef',
      };

      mockClient.fetchBalance.mockResolvedValue(mockBalance);
      mockClient.fetchCurrencies.mockResolvedValue({
        USDC: {
          fees: { withdraw: { cost: 0.001 } },
          limits: { withdraw: { min: 0.01 } },
        },
      });
      mockClient.withdraw.mockResolvedValue(mockWithdrawal);

      const result = await bybitAdapter.withdraw({
        token: 'USDC',
        amount: 100,
        address: '0x742d35Cc6634C0532925a3b8D1B2b3b4C5D6E7F8',
      });

      expect(result.success).toBe(true);
      expect(result.withdrawalId).toBe('withdrawal-123');
      expect(result.amount).toBe(100);
      expect(result.txHash).toBe('0x1234567890abcdef');
      expect(mockClient.withdraw).toHaveBeenCalledWith(
        'USDC',
        100,
        '0x742d35Cc6634C0532925a3b8D1B2b3b4C5D6E7F8',
        undefined,
        { network: 'ETH' }
      );
    });

    it('devrait gérer l\'erreur de solde insuffisant', async () => {
      const mockBalance = {
        USDC: {
          free: 50,
          total: 50,
          used: 0,
        },
      };

      mockClient.fetchBalance.mockResolvedValue(mockBalance);
      mockClient.fetchCurrencies.mockResolvedValue({
        USDC: {
          fees: { withdraw: { cost: 0.001 } },
          limits: { withdraw: { min: 0.01 } },
        },
      });

      await expect(bybitAdapter.withdraw({
        token: 'USDC',
        amount: 100,
        address: '0x742d35Cc6634C0532925a3b8D1B2b3b4C5D6E7F8',
      })).rejects.toThrow(InsufficientBalanceError);
    });

    it('devrait gérer l\'erreur de montant minimum', async () => {
      const mockBalance = {
        USDC: {
          free: 1000,
          total: 1000,
          used: 0,
        },
      };

      mockClient.fetchBalance.mockResolvedValue(mockBalance);
      mockClient.fetchCurrencies.mockResolvedValue({
        USDC: {
          fees: { withdraw: { cost: 0.001 } },
          limits: { withdraw: { min: 0.01 } },
        },
      });

      await expect(bybitAdapter.withdraw({
        token: 'USDC',
        amount: 0.001, // Trop petit
        address: '0x742d35Cc6634C0532925a3b8D1B2b3b4C5D6E7F8',
      })).rejects.toThrow(MinimumAmountError);
    });

    it('devrait gérer l\'erreur d\'adresse non whitelistée', async () => {
      const mockBalance = {
        USDC: {
          free: 1000,
          total: 1000,
          used: 0,
        },
      };

      mockClient.fetchBalance.mockResolvedValue(mockBalance);
      mockClient.fetchCurrencies.mockResolvedValue({
        USDC: {
          fees: { withdraw: { cost: 0.001 } },
          limits: { withdraw: { min: 0.01 } },
        },
      });
      mockClient.withdraw.mockRejectedValue(new Error('Address not whitelisted'));

      await expect(bybitAdapter.withdraw({
        token: 'USDC',
        amount: 100,
        address: '0x742d35Cc6634C0532925a3b8D1B2b3b4C5D6E7F8',
      })).rejects.toThrow(AddressNotWhitelistedError);
    });
  });

  describe('getWithdrawalStatus', () => {
    it('devrait récupérer le statut d\'un retrait', async () => {
      const mockWithdrawals = [
        {
          id: 'withdrawal-123',
          status: 'completed',
          amount: 100,
          currency: 'USDC',
          address: '0x742d35Cc6634C0532925a3b8D1B2b3b4C5D6E7F8',
          txid: '0x1234567890abcdef',
        },
      ];

      mockClient.fetchWithdrawals.mockResolvedValue(mockWithdrawals);

      const result = await bybitAdapter.getWithdrawalStatus('withdrawal-123');

      expect(result.withdrawalId).toBe('withdrawal-123');
      expect(result.status).toBe('completed');
      expect(result.amount).toBe(100);
      expect(result.token).toBe('USDC');
      expect(result.address).toBe('0x742d35Cc6634C0532925a3b8D1B2b3b4C5D6E7F8');
      expect(result.txHash).toBe('0x1234567890abcdef');
    });

    it('devrait gérer le cas où le retrait n\'est pas trouvé', async () => {
      mockClient.fetchWithdrawals.mockResolvedValue([]);

      await expect(bybitAdapter.getWithdrawalStatus('nonexistent')).rejects.toThrow('Retrait nonexistent non trouvé');
    });
  });

  describe('isWhitelisted', () => {
    it('devrait vérifier si une adresse est whitelistée', async () => {
      const mockAddresses = [
        {
          address: '0x742d35Cc6634C0532925a3b8D1B2b3b4C5D6E7F8',
          currency: 'USDC',
        },
        {
          address: '0x842d35Cc6634C0532925a3b8D1B2b3b4C5D6E7F9',
          currency: 'USDC',
        },
      ];

      mockClient.fetchWithdrawalAddresses.mockResolvedValue(mockAddresses);

      const result1 = await bybitAdapter.isWhitelisted('0x742d35Cc6634C0532925a3b8D1B2b3b4C5D6E7F8', 'USDC');
      const result2 = await bybitAdapter.isWhitelisted('0x942d35Cc6634C0532925a3b8D1B2b3b4C5D6E7FA', 'USDC');

      expect(result1).toBe(true);
      expect(result2).toBe(false);
    });

    it('devrait gérer les erreurs et retourner false', async () => {
      mockClient.fetchWithdrawalAddresses.mockRejectedValue(new Error('API Error'));

      const result = await bybitAdapter.isWhitelisted('0x742d35Cc6634C0532925a3b8D1B2b3b4C5D6E7F8', 'USDC');

      expect(result).toBe(false);
    });
  });

  describe('getWithdrawalFees', () => {
    it('devrait récupérer les frais de retrait', async () => {
      mockClient.fetchCurrencies.mockResolvedValue({
        USDC: {
          fees: { withdraw: { cost: 0.001 } },
        },
      });

      const result = await bybitAdapter.getWithdrawalFees('USDC');

      expect(result).toBe(0.001);
    });

    it('devrait retourner des frais par défaut en cas d\'erreur', async () => {
      mockClient.fetchCurrencies.mockRejectedValue(new Error('API Error'));

      const result = await bybitAdapter.getWithdrawalFees('USDC');

      expect(result).toBe(0.001); // Frais par défaut
    });
  });

  describe('getWithdrawalMinimum', () => {
    it('devrait récupérer le montant minimum de retrait', async () => {
      mockClient.fetchCurrencies.mockResolvedValue({
        USDC: {
          limits: { withdraw: { min: 0.01 } },
        },
      });

      const result = await bybitAdapter.getWithdrawalMinimum('USDC');

      expect(result).toBe(0.01);
    });

    it('devrait retourner un minimum par défaut en cas d\'erreur', async () => {
      mockClient.fetchCurrencies.mockRejectedValue(new Error('API Error'));

      const result = await bybitAdapter.getWithdrawalMinimum('USDC');

      expect(result).toBe(0.001); // Minimum par défaut
    });
  });

  describe('calculateRandomAmounts', () => {
    it('devrait calculer des montants aléatoires', () => {
      const amounts = bybitAdapter.calculateRandomAmounts(100, 5, 1, 50);

      expect(amounts).toHaveLength(5);
      expect(amounts.reduce((sum, amount) => sum + amount, 0)).toBeCloseTo(100, 2);
      amounts.forEach(amount => {
        expect(amount).toBeGreaterThanOrEqual(1);
        expect(amount).toBeLessThanOrEqual(50);
      });
    });

    it('devrait gérer un seul wallet', () => {
      const amounts = bybitAdapter.calculateRandomAmounts(100, 1, 1);

      expect(amounts).toHaveLength(1);
      expect(amounts[0]).toBe(100);
    });

    it('devrait gérer un montant insuffisant', () => {
      expect(() => {
        bybitAdapter.calculateRandomAmounts(1, 5, 1);
      }).toThrow('Montant total insuffisant');
    });
  });

  describe('waitForWithdrawalCompletion', () => {
    it('devrait attendre la finalisation d\'un retrait', async () => {
      const mockWithdrawals = [
        {
          id: 'withdrawal-123',
          status: 'completed',
          amount: 100,
          currency: 'USDC',
          address: '0x742d35Cc6634C0532925a3b8D1B2b3b4C5D6E7F8',
          txid: '0x1234567890abcdef',
        },
      ];

      mockClient.fetchWithdrawals.mockResolvedValue(mockWithdrawals);

      const result = await bybitAdapter.waitForWithdrawalCompletion('withdrawal-123', 1000, 100);

      expect(result.status).toBe('completed');
    });

    it('devrait gérer le timeout', async () => {
      const mockWithdrawals = [
        {
          id: 'withdrawal-123',
          status: 'pending',
          amount: 100,
          currency: 'USDC',
          address: '0x742d35Cc6634C0532925a3b8D1B2b3b4C5D6E7F8',
        },
      ];

      mockClient.fetchWithdrawals.mockResolvedValue(mockWithdrawals);

      await expect(bybitAdapter.waitForWithdrawalCompletion('withdrawal-123', 100, 50)).rejects.toThrow('Timeout d\'attente');
    });

    it('devrait gérer l\'échec du retrait', async () => {
      const mockWithdrawals = [
        {
          id: 'withdrawal-123',
          status: 'failed',
          amount: 100,
          currency: 'USDC',
          address: '0x742d35Cc6634C0532925a3b8D1B2b3b4C5D6E7F8',
        },
      ];

      mockClient.fetchWithdrawals.mockResolvedValue(mockWithdrawals);

      await expect(bybitAdapter.waitForWithdrawalCompletion('withdrawal-123', 1000, 100)).rejects.toThrow('Retrait withdrawal-123 échoué');
    });
  });
});
