import { describe, it, expect, vi, beforeEach } from 'vitest';
import { swapService } from '../src/dex/index.js';
import { CONSTANTS } from '../src/config/env.js';

// Mock ethers
vi.mock('ethers', () => ({
  ethers: {
    JsonRpcProvider: vi.fn(),
    Wallet: vi.fn(() => ({
      getAddress: vi.fn(() => Promise.resolve('0x1234567890123456789012345678901234567890')),
      sendTransaction: vi.fn(() => Promise.resolve({ hash: '0xtx123', wait: vi.fn(() => Promise.resolve({ hash: '0xtx123' })) })),
    })),
    Contract: vi.fn(() => ({
      quoteExactInputSingle: vi.fn(() => Promise.resolve(['1000000000000000000', '0', 0, '100000'])),
      exactInputSingle: vi.fn(() => Promise.resolve({ hash: '0xtx123', wait: vi.fn(() => Promise.resolve({ hash: '0xtx123' })) })),
      allowance: vi.fn(() => Promise.resolve('0')),
      approve: vi.fn(() => Promise.resolve({ hash: '0xtx123', wait: vi.fn(() => Promise.resolve({ hash: '0xtx123' })) })),
    })),
  },
}));

// Mock du service de découverte de pools
vi.mock('../src/dex/pools.js', () => ({
  poolDiscoveryService: {
    discoverBestPool: vi.fn(() => Promise.resolve({
      address: '0xpool123',
      token0: CONSTANTS.NATIVE_ADDRESS,
      token1: CONSTANTS.TOKENS.PENGU,
      fee: 3000,
      tickSpacing: 60,
      liquidity: '1000000000000000000',
      sqrtPriceX96: '0',
      tick: 0,
    })),
  },
}));

describe('Swap Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getQuote', () => {
    it('devrait obtenir un quote valide', async () => {
      const params = {
        tokenIn: CONSTANTS.NATIVE_ADDRESS,
        tokenOut: CONSTANTS.TOKENS.PENGU,
        amountIn: BigInt('1000000000000000000'), // 1 ETH
      };

      const quote = await swapService.getQuote(params);

      expect(quote).toBeDefined();
      expect(quote.amountOut).toBe(BigInt('1000000000000000000'));
      expect(quote.pool).toBeDefined();
      expect(quote.pool.address).toBe('0xpool123');
      expect(quote.pool.fee).toBe(3000);
    });

    it('devrait échouer si aucun pool n\'est trouvé', async () => {
      // Mock pour retourner null (aucun pool)
      const { poolDiscoveryService } = await import('../src/dex/pools.js');
      (poolDiscoveryService.discoverBestPool as any).mockResolvedValue(null);

      const params = {
        tokenIn: CONSTANTS.NATIVE_ADDRESS,
        tokenOut: CONSTANTS.TOKENS.PENGU,
        amountIn: BigInt('1000000000000000000'),
      };

      await expect(swapService.getQuote(params)).rejects.toThrow('Aucun pool trouvé pour cette paire de tokens');
    });
  });

  describe('executeSwap', () => {
    it('devrait exécuter un swap en mode DRY_RUN', async () => {
      const params = {
        tokenIn: CONSTANTS.NATIVE_ADDRESS,
        tokenOut: CONSTANTS.TOKENS.PENGU,
        amountIn: BigInt('1000000000000000000'),
        slippageBps: 80,
        recipient: '0x1234567890123456789012345678901234567890',
      };

      const result = await swapService.executeSwap(params, '0xprivatekey', { dryRun: true });

      expect(result.success).toBe(true);
      expect(result.txHash).toBeUndefined();
      expect(result.pool).toBeDefined();
      expect(result.amountOut).toBe(BigInt('1000000000000000000'));
    });

    it('devrait échouer si le price impact est trop élevé', async () => {
      // Mock pour retourner un price impact élevé
      const mockQuoter = {
        quoteExactInputSingle: vi.fn(() => Promise.resolve(['500000000000000000', '0', 0, '100000'])), // 0.5 ETH au lieu de 1 ETH
      };

      const { ethers } = await import('ethers');
      (ethers.Contract as any).mockImplementation((address, abi, provider) => {
        if (address === CONSTANTS.UNIV3.QUOTER_V2) {
          return mockQuoter;
        }
        return {
          allowance: vi.fn(() => Promise.resolve('0')),
          approve: vi.fn(() => Promise.resolve({ hash: '0xtx123', wait: vi.fn(() => Promise.resolve({ hash: '0xtx123' })) })),
        };
      });

      const params = {
        tokenIn: CONSTANTS.NATIVE_ADDRESS,
        tokenOut: CONSTANTS.TOKENS.PENGU,
        amountIn: BigInt('1000000000000000000'),
        slippageBps: 80,
        recipient: '0x1234567890123456789012345678901234567890',
      };

      const result = await swapService.executeSwap(params, '0xprivatekey', { dryRun: false });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Price impact trop élevé');
    });
  });
});
