import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

loadEnv();

const envSchema = z.object({
  BYBIT_API_KEY: z.string().min(1, 'Missing Bybit API key'),
  BYBIT_API_SECRET: z.string().min(1, 'Missing Bybit API secret'),
  HUB_WITHDRAW_AMOUNT: z.coerce.number().positive(),
  HUB_WALLET_PASSWORD: z.string().min(12, 'Password must be at least 12 chars'),
  HUB_WALLET_STORE: z.string().default('./data/wallets.enc'),
  RPC_BASE: z.string().url(),
  RPC_ABSTRACT: z.string().url(),
  BRIDGE_SLIPPAGE_BPS: z.coerce.number().min(10).max(500),
  SWAP_SLIPPAGE_BPS: z.coerce.number().min(10).max(1000),
  TARGET_POOL_ADDRESS: z.string().startsWith('0x'),
  POSITION_MANAGER_ADDRESS: z.string().startsWith('0x'),
  FEE_TIER_BPS: z.coerce.number().positive(),
  RANGE_WIDTH_PERCENT: z.coerce.number().min(1).max(25),
  REBALANCE_PRICE_THRESHOLD_PERCENT: z.coerce.number().min(5).max(50),
  FEE_GAS_MULTIPLE_TRIGGER: z.coerce.number().min(1).max(10),
  PENGU_TOKEN_ADDRESS: z.string().startsWith('0x'),
  WRAPPED_ETH_ADDRESS: z.string().startsWith('0x'),
  CHAIN_ID_BASE: z.coerce.number(),
  CHAIN_ID_ABSTRACT: z.coerce.number(),
  GAS_PRICE_GWEI: z.coerce.number().positive().default(0.1),
});

export type Env = z.infer<typeof envSchema>;

export const env: Env = envSchema.parse(process.env);

export const STRATEGY_CONSTANTS = {
  walletCount: 100,
  hubIndex: 0,
  penguAllocation: 0.5,
  ethAllocation: 0.5,
  feeReinvestPercent: 0.5,
  penguToEthSafetySwapPercent: 0.3,
};

export const NETWORKS = {
  base: {
    chainId: env.CHAIN_ID_BASE,
    rpcUrl: env.RPC_BASE,
  },
  abstract: {
    chainId: env.CHAIN_ID_ABSTRACT,
    rpcUrl: env.RPC_ABSTRACT,
  },
};

export const TOKENS = {
  eth: {
    symbol: 'ETH',
    address: env.WRAPPED_ETH_ADDRESS,
    decimals: 18,
  },
  pengu: {
    symbol: 'PENGU',
    address: env.PENGU_TOKEN_ADDRESS,
    decimals: 18,
  },
};

export const FEES = {
  rebalanceGasMultiplier: env.FEE_GAS_MULTIPLE_TRIGGER,
  rangeWidthPercent: env.RANGE_WIDTH_PERCENT,
  priceThresholdPercent: env.REBALANCE_PRICE_THRESHOLD_PERCENT,
};

export const PATHS = {
  walletStore: env.HUB_WALLET_STORE,
};
