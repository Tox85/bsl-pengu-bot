import { describe, it, expect, vi, beforeEach } from 'vitest';
import { liquidityPositionService } from '../src/lp/index.js';
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
      mint: vi.fn(() => Promise.resolve({ hash: '0xtx123', wait: vi.fn(() => Promise.resolve({ hash: '0xtx123' })) })),
      increaseLiquidity: vi.fn(() => Promise.resolve({ hash: '0xtx123', wait: vi.fn(() => Promise.resolve({ hash: '0xtx123' })) })),
      decreaseLiquidity: vi.fn(() => Promise.resolve({ hash: '0xtx123', wait: vi.fn(() => Promise.resolve({ hash: '0xtx123' })) })),
      collect: vi.fn(() => Promise.resolve({ hash: '0xtx123', wait: vi.fn(() => Promise.resolve({ hash: '0xtx123' })) })),
      positions: vi.fn(() => Promise.resolve({
        token0: CONSTANTS.NATIVE_ADDRESS,
        token1: CONSTANTS.TOKENS.PENGU,
        fee: 3000,
        tickLower: -100,
        tickUpper: 100,
        liquidity: '1000000000000000000',
        feeGrowthInside0LastX128: '0',
        feeGrowthInside1LastX128: '0',
        tokensOwed0: '0',
        tokensOwed1: '0',
      })),
      allowance: vi.fn(() => Promise.resolve('0')),
      approve: vi.fn(() => Promise.resolve({ hash: '0xtx123', wait: vi.fn(() => Promise.resolve({ hash: '0xtx123' })) })),
    })),
  },
}));

describe('Liquidity Position Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createPosition', () => {
    it('devrait créer une position en mode DRY_RUN', async () => {
      const params = {
        token0: CONSTANTS.NATIVE_ADDRESS,
        token1: CONSTANTS.TOKENS.PENGU,
        fee: 3000,
        tickLower: -100,
        tickUpper: 100,
        amount0Desired: BigInt('1000000000000000000'),
        amount1Desired: BigInt('1000000000000000000'),
        amount0Min: BigInt('0'),
        amount1Min: BigInt('0'),
        recipient: '0x1234567890123456789012345678901234567890',
        deadline: Math.floor(Date.now() / 1000) + 600,
      };

      const result = await liquidityPositionService.createPosition(params, '0xprivatekey', { dryRun: true });

      expect(result.success).toBe(true);
      expect(result.txHash).toBeUndefined();
    });

    it('devrait créer une position en mode LIVE', async () => {
      const params = {
        token0: CONSTANTS.NATIVE_ADDRESS,
        token1: CONSTANTS.TOKENS.PENGU,
        fee: 3000,
        tickLower: -100,
        tickUpper: 100,
        amount0Desired: BigInt('1000000000000000000'),
        amount1Desired: BigInt('1000000000000000000'),
        amount0Min: BigInt('0'),
        amount1Min: BigInt('0'),
        recipient: '0x1234567890123456789012345678901234567890',
        deadline: Math.floor(Date.now() / 1000) + 600,
      };

      const result = await liquidityPositionService.createPosition(params, '0xprivatekey', { dryRun: false });

      expect(result.success).toBe(true);
      expect(result.txHash).toBe('0xtx123');
    });
  });

  describe('getPosition', () => {
    it('devrait obtenir les informations d\'une position', async () => {
      const tokenId = BigInt('123');

      const position = await liquidityPositionService.getPosition(tokenId);

      expect(position).toBeDefined();
      expect(position.tokenId).toBe(tokenId);
      expect(position.token0).toBe(CONSTANTS.NATIVE_ADDRESS);
      expect(position.token1).toBe(CONSTANTS.TOKENS.PENGU);
      expect(position.fee).toBe(3000);
      expect(position.tickLower).toBe(-100);
      expect(position.tickUpper).toBe(100);
      expect(position.liquidity).toBe(BigInt('1000000000000000000'));
    });
  });

  describe('collectFees', () => {
    it('devrait collecter les frais en mode DRY_RUN', async () => {
      const params = {
        tokenId: BigInt('123'),
        recipient: '0x1234567890123456789012345678901234567890',
        amount0Max: BigInt('1000000000000000000'),
        amount1Max: BigInt('1000000000000000000'),
      };

      const result = await liquidityPositionService.collectFees(params, '0xprivatekey', { dryRun: true });

      expect(result.success).toBe(true);
      expect(result.txHash).toBeUndefined();
    });

    it('devrait collecter les frais en mode LIVE', async () => {
      const params = {
        tokenId: BigInt('123'),
        recipient: '0x1234567890123456789012345678901234567890',
        amount0Max: BigInt('1000000000000000000'),
        amount1Max: BigInt('1000000000000000000'),
      };

      const result = await liquidityPositionService.collectFees(params, '0xprivatekey', { dryRun: false });

      expect(result.success).toBe(true);
      expect(result.txHash).toBe('0xtx123');
    });
  });

  describe('calculateTickRange', () => {
    it('devrait calculer le range de ticks correctement', () => {
      const params = {
        currentTick: 0,
        tickSpacing: 60,
        rangePercent: 5,
      };

      const { tickLower, tickUpper } = liquidityPositionService.calculateTickRange(params);

      expect(tickLower).toBeLessThanOrEqual(0);
      expect(tickUpper).toBeGreaterThanOrEqual(0);
      expect(tickLower % params.tickSpacing).toBe(0);
      expect(tickUpper % params.tickSpacing).toBe(0);
    });
  });
});
