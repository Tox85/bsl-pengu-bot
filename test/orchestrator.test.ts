import { describe, it, expect, vi, beforeEach } from 'vitest';
import { orchestratorService } from '../src/orchestrator/index.js';
import { CONSTANTS } from '../src/config/env.js';

// Mock des services
vi.mock('../src/bridge/index.js', () => ({
  bridgeService: {
    getBridgeRoute: vi.fn(),
    executeRoute: vi.fn(),
  },
}));

vi.mock('../src/dex/index.js', () => ({
  swapService: {
    getQuote: vi.fn(),
    executeSwap: vi.fn(),
  },
}));

vi.mock('../src/lp/index.js', () => ({
  liquidityPositionService: {
    createPosition: vi.fn(),
    collectFees: vi.fn(),
    calculateTickRange: vi.fn(),
  },
}));

vi.mock('../src/core/rpc.js', () => ({
  createSigner: vi.fn(() => ({
    getAddress: vi.fn(() => Promise.resolve('0x1234567890123456789012345678901234567890')),
  })),
  getProvider: vi.fn(() => ({
    getBlockNumber: vi.fn(() => Promise.resolve(12345)),
  })),
}));

describe('Orchestrator Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('run', () => {
    it('devrait exécuter le flow complet en mode DRY_RUN', async () => {
      // Mock des services
      const { bridgeService } = await import('../src/bridge/index.js');
      const { swapService } = await import('../src/dex/index.js');
      const { liquidityPositionService } = await import('../src/lp/index.js');

      (bridgeService.getBridgeRoute as any).mockResolvedValue({
        id: 'route-123',
        fromAmount: '1000000000000000000',
        toAmount: '1000000000000000000',
      });

      (bridgeService.executeRoute as any).mockResolvedValue({
        success: true,
        txHash: '0xtx123',
        status: { status: 'DONE' },
      });

      (swapService.getQuote as any).mockResolvedValue({
        amountOut: BigInt('1000000000000000000'),
        pool: {
          address: '0xpool123',
          fee: 3000,
          tick: 0,
          tickSpacing: 60,
        },
      });

      (swapService.executeSwap as any).mockResolvedValue({
        success: true,
        amountOut: BigInt('1000000000000000000'),
        txHash: '0xtx123',
        pool: {
          address: '0xpool123',
          fee: 3000,
          tick: 0,
          tickSpacing: 60,
        },
      });

      (liquidityPositionService.calculateTickRange as any).mockReturnValue({
        tickLower: -100,
        tickUpper: 100,
      });

      (liquidityPositionService.createPosition as any).mockResolvedValue({
        success: true,
        tokenId: BigInt('123'),
        liquidity: BigInt('1000000000000000000'),
        txHash: '0xtx123',
      });

      (liquidityPositionService.collectFees as any).mockResolvedValue({
        success: true,
        amount0: BigInt('1000000000000000000'),
        amount1: BigInt('1000000000000000000'),
        txHash: '0xtx123',
      });

      const params = {
        privateKey: '0xprivatekey',
        bridgeAmount: '0.01',
        bridgeToken: 'ETH' as const,
        swapAmount: '0.001',
        swapPair: 'PENGU/ETH' as const,
        lpRangePercent: 5,
        collectAfterMinutes: 1,
        dryRun: true,
      };

      const result = await orchestratorService.run(params);

      expect(result.success).toBe(true);
      expect(result.state.currentStep).toBe('collect_done');
      expect(result.state.bridgeResult).toBeDefined();
      expect(result.state.swapResult).toBeDefined();
      expect(result.state.positionResult).toBeDefined();
      expect(result.state.collectResult).toBeDefined();
    });

    it('devrait échouer si le bridge échoue', async () => {
      const { bridgeService } = await import('../src/bridge/index.js');

      (bridgeService.getBridgeRoute as any).mockResolvedValue({
        id: 'route-123',
        fromAmount: '1000000000000000000',
        toAmount: '1000000000000000000',
      });

      (bridgeService.executeRoute as any).mockResolvedValue({
        success: false,
        error: 'Bridge failed',
      });

      const params = {
        privateKey: '0xprivatekey',
        bridgeAmount: '0.01',
        bridgeToken: 'ETH' as const,
        swapAmount: '0.001',
        swapPair: 'PENGU/ETH' as const,
        lpRangePercent: 5,
        collectAfterMinutes: 1,
        dryRun: false,
      };

      const result = await orchestratorService.run(params);

      expect(result.success).toBe(false);
      expect(result.state.currentStep).toBe('error');
      expect(result.state.bridgeResult?.success).toBe(false);
      expect(result.state.bridgeResult?.error).toBe('Bridge failed');
    });

    it('devrait échouer si le swap échoue', async () => {
      const { bridgeService } = await import('../src/bridge/index.js');
      const { swapService } = await import('../src/dex/index.js');

      (bridgeService.getBridgeRoute as any).mockResolvedValue({
        id: 'route-123',
        fromAmount: '1000000000000000000',
        toAmount: '1000000000000000000',
      });

      (bridgeService.executeRoute as any).mockResolvedValue({
        success: true,
        txHash: '0xtx123',
        status: { status: 'DONE' },
      });

      (swapService.getQuote as any).mockResolvedValue({
        amountOut: BigInt('1000000000000000000'),
        pool: {
          address: '0xpool123',
          fee: 3000,
          tick: 0,
          tickSpacing: 60,
        },
      });

      (swapService.executeSwap as any).mockResolvedValue({
        success: false,
        error: 'Swap failed',
      });

      const params = {
        privateKey: '0xprivatekey',
        bridgeAmount: '0.01',
        bridgeToken: 'ETH' as const,
        swapAmount: '0.001',
        swapPair: 'PENGU/ETH' as const,
        lpRangePercent: 5,
        collectAfterMinutes: 1,
        dryRun: false,
      };

      const result = await orchestratorService.run(params);

      expect(result.success).toBe(false);
      expect(result.state.currentStep).toBe('error');
      expect(result.state.swapResult?.success).toBe(false);
      expect(result.state.swapResult?.error).toBe('Swap failed');
    });
  });
});
