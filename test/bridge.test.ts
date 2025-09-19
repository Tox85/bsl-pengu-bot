import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bridgeService } from '../src/bridge/index.js';
import { CONSTANTS } from '../src/config/env.js';

// Mock axios
vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => ({
      get: vi.fn(),
    })),
  },
}));

// Mock ethers
vi.mock('ethers', () => ({
  ethers: {
    JsonRpcProvider: vi.fn(),
    Wallet: vi.fn(() => ({
      getAddress: vi.fn(() => Promise.resolve('0x1234567890123456789012345678901234567890')),
      sendTransaction: vi.fn(() => Promise.resolve({ hash: '0xtx123', wait: vi.fn(() => Promise.resolve({ hash: '0xtx123' })) })),
    })),
    Contract: vi.fn(),
  },
}));

describe('Bridge Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getBridgeRoute', () => {
    it('devrait obtenir une route de bridge valide', async () => {
      // Mock de la réponse Li.Fi
      const mockRoute = {
        id: 'route-123',
        fromChainId: CONSTANTS.CHAIN_IDS.BASE,
        toChainId: CONSTANTS.CHAIN_IDS.ABSTRACT,
        fromToken: {
          address: CONSTANTS.NATIVE_ADDRESS,
          symbol: 'ETH',
          decimals: 18,
          chainId: CONSTANTS.CHAIN_IDS.BASE,
          name: 'Ethereum',
        },
        toToken: {
          address: CONSTANTS.NATIVE_ADDRESS,
          symbol: 'ETH',
          decimals: 18,
          chainId: CONSTANTS.CHAIN_IDS.ABSTRACT,
          name: 'Ethereum',
        },
        fromAmount: '1000000000000000000', // 1 ETH
        toAmount: '1000000000000000000', // 1 ETH
        steps: [],
        tags: [],
        tool: 'jumper',
        bridgeUsed: 'jumper',
        estimate: {
          fromAmount: '1000000000000000000',
          toAmount: '1000000000000000000',
          toAmountMin: '995000000000000000',
          approvalAddress: '0x0000000000000000000000000000000000000000',
          executionDuration: 300,
          feeCosts: [],
          gasCosts: [],
        },
      };

      // Mock de la réponse HTTP
      const mockAxios = await import('axios');
      const mockClient = {
        get: vi.fn().mockResolvedValue({
          data: { routes: [mockRoute] },
        }),
      };
      (mockAxios.default.create as any).mockReturnValue(mockClient);

      const params = {
        fromChainId: CONSTANTS.CHAIN_IDS.BASE,
        toChainId: CONSTANTS.CHAIN_IDS.ABSTRACT,
        fromTokenAddress: CONSTANTS.NATIVE_ADDRESS,
        toTokenAddress: CONSTANTS.NATIVE_ADDRESS,
        amount: '1000000000000000000',
        fromAddress: '0x1234567890123456789012345678901234567890',
        toAddress: '0x1234567890123456789012345678901234567890',
        slippage: 50,
      };

      const route = await bridgeService.getBridgeRoute(params);

      expect(route).toBeDefined();
      expect(route.id).toBe('route-123');
      expect(route.fromChainId).toBe(CONSTANTS.CHAIN_IDS.BASE);
      expect(route.toChainId).toBe(CONSTANTS.CHAIN_IDS.ABSTRACT);
      expect(route.fromAmount).toBe('1000000000000000000');
      expect(route.toAmount).toBe('1000000000000000000');
    });

    it('devrait échouer si aucune route n\'est trouvée', async () => {
      // Mock de la réponse HTTP vide
      const mockAxios = await import('axios');
      const mockClient = {
        get: vi.fn().mockResolvedValue({
          data: { routes: [] },
        }),
      };
      (mockAxios.default.create as any).mockReturnValue(mockClient);

      const params = {
        fromChainId: CONSTANTS.CHAIN_IDS.BASE,
        toChainId: CONSTANTS.CHAIN_IDS.ABSTRACT,
        fromTokenAddress: CONSTANTS.NATIVE_ADDRESS,
        toTokenAddress: CONSTANTS.NATIVE_ADDRESS,
        amount: '1000000000000000000',
        fromAddress: '0x1234567890123456789012345678901234567890',
        toAddress: '0x1234567890123456789012345678901234567890',
        slippage: 50,
      };

      await expect(bridgeService.getBridgeRoute(params)).rejects.toThrow('Aucune route trouvée pour ce bridge');
    });
  });

  describe('executeRoute', () => {
    it('devrait exécuter une route en mode DRY_RUN', async () => {
      const mockRoute = {
        id: 'route-123',
        fromChainId: CONSTANTS.CHAIN_IDS.BASE,
        toChainId: CONSTANTS.CHAIN_IDS.ABSTRACT,
        fromToken: { symbol: 'ETH' },
        toToken: { symbol: 'ETH' },
        fromAmount: '1000000000000000000',
        toAmount: '1000000000000000000',
        steps: [],
        tags: [],
        tool: 'jumper',
        bridgeUsed: 'jumper',
        estimate: {
          fromAmount: '1000000000000000000',
          toAmount: '1000000000000000000',
          toAmountMin: '995000000000000000',
          approvalAddress: '0x0000000000000000000000000000000000000000',
          executionDuration: 300,
          feeCosts: [],
          gasCosts: [],
        },
      };

      const result = await bridgeService.executeRoute(mockRoute, '0xprivatekey', { dryRun: true });

      expect(result.success).toBe(true);
      expect(result.txHash).toBeUndefined();
      expect(result.status).toBeUndefined();
    });
  });
});
