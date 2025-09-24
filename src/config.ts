import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

loadEnv();

const envSchema = z.object({
  BYBIT_API_KEY: z.string().optional(),
  BYBIT_API_SECRET: z.string().optional(),
  HUB_WITHDRAW_AMOUNT: z.coerce.number().positive(),
  HUB_WALLET_PASSWORD: z.string().min(12, 'Password must be at least 12 chars'),
  HUB_WALLET_STORE: z.string().default('./data/wallets.enc'),
  HUB_WALLET_INDEX: z.coerce.number().int().min(0).max(99).default(0),
  STRATEGY_MNEMONIC: z.string().min(12, 'Missing mnemonic for deterministic wallets'),
  BASE_FUNDING_PRIVATE_KEY: z.string().startsWith('0x').optional(),
  RPC_BASE: z.string().url(),
  RPC_ABSTRACT: z.string().url(),
  BRIDGE_SLIPPAGE_BPS: z.coerce.number().min(10).max(500),
  SWAP_SLIPPAGE_BPS: z.coerce.number().min(10).max(1000),
  PENGU_TOKEN_ADDRESS: z.string().startsWith('0x'),
  WRAPPED_ETH_ADDRESS: z.string().startsWith('0x'),
  UNISWAP_ROUTER_ADDRESS: z.string().startsWith('0x'),
  UNISWAP_PAIR_ADDRESS: z.string().startsWith('0x'),
  REBALANCE_PRICE_THRESHOLD_PERCENT: z.coerce.number().min(5).max(50),
  FEE_GAS_MULTIPLE_TRIGGER: z.coerce.number().min(1).max(10),
  PENGU_TO_ETH_FEE_SWAP_PERCENT: z.coerce.number().min(0).max(100).default(30),
  FEE_REINVEST_PERCENT: z.coerce.number().min(0).max(100).default(60),
  LIQUIDITY_UTILIZATION_PERCENT: z.coerce.number().min(10).max(100).default(80),
  SATELLITE_VARIANCE_MIN: z.coerce.number().min(0.1).max(5).default(0.85),
  SATELLITE_VARIANCE_MAX: z.coerce.number().min(0.1).max(5).default(1.15),
  CHAIN_ID_BASE: z.coerce.number(),
  CHAIN_ID_ABSTRACT: z.coerce.number(),
  GAS_PRICE_GWEI: z.coerce.number().positive().default(0.1),
});

export type Env = z.infer<typeof envSchema> & {
  BYBIT_API_KEY?: string;
  BYBIT_API_SECRET?: string;
  BASE_FUNDING_PRIVATE_KEY?: string;
};

const parsedEnv = envSchema.parse(process.env);

export const env: Env = {
  ...parsedEnv,
  BYBIT_API_KEY: parsedEnv.BYBIT_API_KEY?.trim() ? parsedEnv.BYBIT_API_KEY.trim() : undefined,
  BYBIT_API_SECRET: parsedEnv.BYBIT_API_SECRET?.trim() ? parsedEnv.BYBIT_API_SECRET.trim() : undefined,
  BASE_FUNDING_PRIVATE_KEY: parsedEnv.BASE_FUNDING_PRIVATE_KEY?.trim()
    ? parsedEnv.BASE_FUNDING_PRIVATE_KEY.trim()
    : undefined,
};

if (env.SATELLITE_VARIANCE_MIN >= env.SATELLITE_VARIANCE_MAX) {
  throw new Error('SATELLITE_VARIANCE_MIN must be lower than SATELLITE_VARIANCE_MAX');
}

export const STRATEGY_CONSTANTS = {
  walletCount: 100,
  hubIndex: env.HUB_WALLET_INDEX,
  penguAllocation: 0.5,
  ethAllocation: 0.5,
  feeReinvestPercent: env.FEE_REINVEST_PERCENT / 100,
  penguToEthSafetySwapPercent: env.PENGU_TO_ETH_FEE_SWAP_PERCENT / 100,
  liquidityUtilizationPercent: env.LIQUIDITY_UTILIZATION_PERCENT / 100,
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
  priceThresholdPercent: env.REBALANCE_PRICE_THRESHOLD_PERCENT,
};

export const PATHS = {
  walletStore: env.HUB_WALLET_STORE,
};

export const DEX = {
  router: env.UNISWAP_ROUTER_ADDRESS,
  pair: env.UNISWAP_PAIR_ADDRESS,
};

export const DISTRIBUTION_VARIANCE = {
  minFactor: env.SATELLITE_VARIANCE_MIN,
  maxFactor: env.SATELLITE_VARIANCE_MAX,
};
