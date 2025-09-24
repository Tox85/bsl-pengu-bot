import { vi, afterEach } from 'vitest';

// Simple deterministic address from index (not crypto-accurate, ok for tests)
function addrFromIndex(i: number) {
  return `0x${i.toString(16).padStart(40, '0')}`;
}

// Minimal provider mock
export const makeProviderMock = (overrides = {}) => {
  return {
    getTransactionCount: vi.fn().mockImplementation(async (address: string) => {
      // Return 0 for all addresses to start with clean nonce
      return 0;
    }),
    getFeeData: vi.fn().mockResolvedValue({ maxFeePerGas: 100n, maxPriorityFeePerGas: 1n }),
    sendTransaction: vi.fn().mockResolvedValue({ wait: async () => ({ status: 1, transactionHash: '0xdead' }) }),
    getNetwork: vi.fn().mockResolvedValue({ chainId: 42161 }),
    getBlockNumber: vi.fn().mockResolvedValue(12345),
    ...overrides,
  };
};

// Minimal HDNode mock factory
export const makeHDNodeMock = (mnemonic: string) => {
  return {
    mnemonic,
    deriveChild: vi.fn().mockImplementation((index: number) => {
      const addr = addrFromIndex(index + 4); // offset so index 0 != 0
      return {
        index,
        address: addr,
        getAddress: () => addr,
        connect: vi.fn().mockReturnThis(),
      };
    }),
  };
};

// Mock ethers HDNodeWallet and Wallet if used by code
vi.mock('ethers', async () => {
  const actual = await vi.importActual<any>('ethers').catch(() => ({}));
  return {
    ...(actual || {}),
    HDNodeWallet: {
      fromPhrase: vi.fn().mockImplementation((mnemonic: string) => {
        console.log('Mock HDNodeWallet.fromPhrase called with:', mnemonic);
        const mock = makeHDNodeMock(mnemonic);
        console.log('Returning mock:', mock);
        return mock;
      }),
    },
    Wallet: {
      fromMnemonic: vi.fn().mockImplementation((mnemonic: string, index: number) => {
        const hd = makeHDNodeMock(mnemonic).deriveChild(index);
        return { 
          address: hd.address, 
          getAddress: () => hd.address, 
          signTransaction: vi.fn().mockResolvedValue('0xsigned...'),
          signMessage: vi.fn().mockResolvedValue('0xsigned...'),
          connect: vi.fn().mockReturnThis(),
        };
      }),
    },
    ethers: {
      ...(actual?.ethers || {}),
      Wallet: vi.fn().mockImplementation((privateKey: string, provider?: any) => ({
        address: addrFromIndex(parseInt(privateKey.slice(-1), 16) || 1),
        privateKey,
        provider,
        signTransaction: vi.fn().mockResolvedValue('0xsigned...'),
        signMessage: vi.fn().mockResolvedValue('0xsigned...'),
        connect: vi.fn().mockReturnThis(),
      })),
      HDNodeWallet: {
        fromPhrase: vi.fn().mockImplementation((mnemonic: string) => {
          console.log('Mock ethers.HDNodeWallet.fromPhrase called with:', mnemonic);
          const mock = makeHDNodeMock(mnemonic);
          console.log('Returning mock:', mock);
          return mock;
        }),
      },
      Contract: vi.fn().mockImplementation(() => ({
        connect: vi.fn().mockReturnThis(),
        transfer: vi.fn().mockResolvedValue({
          hash: '0xabc123...',
          wait: vi.fn().mockResolvedValue({
            status: 1,
            transactionHash: '0xabc123...',
            blockNumber: 12345,
            gasUsed: '21000',
          }),
        }),
      })),
      parseEther: vi.fn().mockImplementation((value: string) => BigInt(actual?.ethers?.parseEther?.(value) || value)),
      parseUnits: vi.fn().mockImplementation((value: string, unit: string) => BigInt(actual?.ethers?.parseUnits?.(value, unit) || value)),
      formatEther: vi.fn().mockImplementation((value: bigint) => actual?.ethers?.formatEther?.(value) || value.toString()),
      formatUnits: vi.fn().mockImplementation((value: bigint, unit: string) => actual?.ethers?.formatUnits?.(value, unit) || value.toString()),
    },
  };
});

// Mock des modules internes
vi.mock('../../src/utils/mutex.js', () => ({
  walletMutexManager: {
    runExclusive: vi.fn().mockImplementation(async (key: string, fn: () => Promise<any>) => {
      return await fn();
    }),
  },
}));

vi.mock('../../src/errors/BotError.js', () => ({
  BotError: class BotError extends Error {
    code: string;
    meta?: any;
    constructor(code: string, message?: string, meta?: any) {
      super(message ?? code);
      this.name = 'BotError';
      this.code = code;
      this.meta = meta;
    }
    static isBotError(error: any): error is BotError { return error instanceof BotError; }
    static network = vi.fn((msg, meta) => new BotError('NETWORK', msg, meta));
    static rateLimit = vi.fn((msg, meta) => new BotError('RATE_LIMIT', msg, meta));
    static timeout = vi.fn((msg, meta) => new BotError('TIMEOUT', msg, meta));
    static insufficientFunds = vi.fn((msg, meta) => new BotError('INSUFFICIENT_FUNDS', msg, meta));
    static bridgeTimeout = vi.fn((msg, meta) => new BotError('BRIDGE_TIMEOUT', msg, meta));
    static swapNoPool = vi.fn((msg, meta) => new BotError('SWAP_NO_POOL', msg, meta));
    static walletNotFound = vi.fn((msg, meta) => new BotError('WALLET_NOT_FOUND', msg, meta));
    static configMissing = vi.fn((msg, meta) => new BotError('CONFIG_MISSING', msg, meta));
    static cexAddressNotWhitelisted = vi.fn((msg, meta) => new BotError('CEX_ADDRESS_NOT_WHITELISTED', msg, meta));
    static lpCollectFailed = vi.fn((msg, meta) => new BotError('LP_COLLECT_FAILED', msg, meta));
    static unknown = vi.fn((msg, meta) => new BotError('UNKNOWN', msg, meta));
    isRetryable = vi.fn(() => ['NETWORK', 'RATE_LIMIT', 'TIMEOUT', 'BRIDGE_TIMEOUT'].includes(this.code));
    isFatal = vi.fn(() => ['INSUFFICIENT_FUNDS', 'SWAP_NO_POOL', 'WALLET_NOT_FOUND', 'CONFIG_MISSING', 'CEX_ADDRESS_NOT_WHITELISTED', 'LP_COLLECT_FAILED'].includes(this.code));
  },
}));

vi.mock('../../src/bridge/lifi.ts', () => ({
  LiFiBridge: vi.fn().mockImplementation(() => ({
    getRoute: vi.fn().mockResolvedValue({
      id: 'route-123',
      fromChainId: 8453,
      toChainId: 11124,
      fromAmount: '100000000',
      toAmount: '99900000',
      steps: [{ id: 'step-1', type: 'cross', tool: 'jumper' }],
    }),
    executeRoute: vi.fn().mockResolvedValue({
      id: 'execution-123',
      status: 'PENDING',
      steps: [{ id: 'step-1', status: 'PENDING' }],
    }),
    getExecutionStatus: vi.fn().mockResolvedValue({
      id: 'execution-123',
      status: 'DONE',
      steps: [{ id: 'step-1', status: 'DONE', transactionHash: '0xabc123...' }],
    }),
  })),
}));

vi.mock('../../src/utils/retry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/retry.js')>();
  return {
    ...actual,
    retry: vi.fn(async (fn, options) => {
      if (options?.onRetry) {
        // Simulate retries for onRetry callback
        for (let i = 1; i <= (options.maxRetries || 0); i++) {
          try {
            await fn();
            return { result: await fn(), attempts: i };
          } catch (error: any) {
            options.onRetry(error, i, options.baseDelayMs || 100);
          }
        }
      }
      return actual.retry(fn, { ...options, maxRetries: 0 }); // Execute immediately without actual retries
    }),
  };
});

// Global handler to avoid noisy unhandled rejection logs in tests
process.on('unhandledRejection', (err) => {
  // Allow vitest to surface rejections via expect(...).rejects; but avoid console spam
  // Optionally: capture to a global array for test assertions
});

// Use fake timers
vi.useFakeTimers();

// Cleanup after each test
afterEach(() => {
  vi.clearAllMocks();
  if (vi.isFakeTimers()) {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  }
});

// Expose helpers to tests
globalThis.__TEST_HELPERS__ = { makeProviderMock, makeHDNodeMock };