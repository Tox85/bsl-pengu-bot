import { z } from 'zod';

// Charger les variables d'environnement
import dotenv from 'dotenv';
dotenv.config();

// Vérifier que les variables sont chargées
if (!process.env.UNIV3_FACTORY) {
  console.error('ERREUR: UNIV3_FACTORY non chargé depuis .env');
  process.exit(1);
}

// Schéma de validation pour les adresses Ethereum
const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Adresse Ethereum invalide');

// Schéma de validation pour les URLs
const urlSchema = z.string().url('URL invalide');

// Schéma de validation pour les chain IDs
const chainIdSchema = z.number().int().positive('Chain ID doit être un entier positif');

// Schéma de validation pour les BPS (basis points)
const bpsSchema = z.number().int().min(0).max(10000, 'BPS doit être entre 0 et 10000');

// Schéma de validation pour les pourcentages
const percentageSchema = z.number().min(0).max(100, 'Pourcentage doit être entre 0 et 100');

// Schéma de validation pour les tokens supportés
const supportedTokenSchema = z.enum(['ETH', 'USDC'], {
  errorMap: () => ({ message: 'Token supporté: ETH ou USDC' })
});

// Schéma de validation pour les niveaux de log
const logLevelSchema = z.enum(['debug', 'info', 'warn', 'error'], {
  errorMap: () => ({ message: 'Niveau de log invalide' })
});

// Schéma principal de configuration
const configSchema = z.object({
  // Wallets / RPC (mode single-wallet)
  PRIVATE_KEY: z.string().min(1, 'Clé privée requise'),
  BASE_RPC_URL: urlSchema,
  ABSTRACT_RPC_URL: urlSchema,
  
  // Multi-wallet configuration (optionnel)
  MNEMONIC: z.string().optional(),
  WALLET_COUNT: z.number().int().min(1).max(1000).optional().default(100),
  HUB_WALLET_PRIVATE_KEY: z.string().optional(),
  
  // Bybit configuration (optionnel)
  BYBIT_API_KEY: z.string().optional(),
  BYBIT_API_SECRET: z.string().optional(),
  BYBIT_SANDBOX: z.union([z.boolean(), z.string().transform(val => val === 'true')]).default(false),
  BYBIT_TESTNET: z.union([z.boolean(), z.string().transform(val => val === 'true')]).default(false),
  
  // Distribution configuration
  DISTRIBUTION_USDC_PER_WALLET: z.number().positive().optional().default(10.0),
  DISTRIBUTION_ETH_PER_WALLET: z.number().positive().optional().default(0.005),
  DISTRIBUTION_RANDOMIZE_AMOUNTS: z.union([z.boolean(), z.string().transform(val => val === 'true')]).default(true),
  DISTRIBUTION_VARIATION_PERCENT: z.number().min(0).max(100).default(10),
  
  // Nouvelles configurations
  NETWORK_WITHDRAW: z.string().default('ARBITRUM'),
  WITHDRAW_ENABLED: z.union([z.boolean(), z.string().transform(val => val === 'true')]).default(true),
  WITHDRAW_ASSET_USDC: z.union([z.boolean(), z.string().transform(val => val === 'true')]).default(true),
  WITHDRAW_ASSET_ETH: z.union([z.boolean(), z.string().transform(val => val === 'true')]).default(false),
  WITHDRAW_USDC_MIN: z.number().positive().default(10),
  WITHDRAW_USDC_MAX: z.number().positive().default(100),
  WITHDRAW_ETH_MIN: z.number().positive().default(0.01),
  WITHDRAW_ETH_MAX: z.number().positive().default(0.1),
  DISTRIB_TOPUP_ETH: z.number().positive().default(0.0001),
  BYPASS_POLLING: z.union([z.boolean(), z.string().transform(val => val === 'true')]).default(false),
  POLLING_TIMEOUT_MS: z.number().int().positive().default(300000),
  POLLING_INTERVAL_MS: z.number().int().positive().default(10000),
  
  // Flow policy
  DRY_RUN: z.union([z.boolean(), z.string().transform(val => val === 'true')]).default(true),
  BRIDGE_TO_TOKEN: supportedTokenSchema.default('ETH'),
  SWAP_SLIPPAGE_BPS: bpsSchema.default(80),
  LP_RANGE_PCT: percentageSchema.default(5),
  LP_MINUTES_BEFORE_COLLECT: z.number().int().positive().default(10),
      MIN_BRIDGE_USD: z.string().transform(val => parseFloat(val)).pipe(z.number().positive()).default("1"),
      MIN_SWAP_USD: z.string().transform(val => parseFloat(val)).pipe(z.number().positive()).default("5"),
      MIN_ABS_GAS_BUFFER_ETH: z.string().transform(val => parseFloat(val)).pipe(z.number().positive()).default("0.002"),
      
      // Auto gas top-up sur Abstract
      MIN_NATIVE_DEST_WEI_FOR_APPROVE: z.string().transform(val => BigInt(val)).default("15000000000000"),
      MIN_NATIVE_DEST_WEI_FOR_SWAP: z.string().transform(val => BigInt(val)).default("120000000000000"),
      AUTO_GAS_TOPUP: z.union([z.boolean(), z.string().transform(val => val === 'true')]).default(true),
      GAS_TOPUP_TARGET_WEI: z.string().transform(val => BigInt(val)).default("100000000000000"),
  
  // Tokens (Abstract)
  PENGU_ADDRESS_ABS: addressSchema,
  WETH_ADDRESS_ABS: addressSchema,
  USDC_ADDRESS_ABS: addressSchema,
  
  // Core Uniswap v3 (Abstract mainnet)
  UNIV3_FACTORY: addressSchema,
  QUOTER_V2: addressSchema,
  SWAP_ROUTER_02: addressSchema,
  NF_POSITION_MANAGER: addressSchema,
  
  // Li.Fi
  LIFI_BASE_URL: urlSchema.default('https://li.quest/v1'),
  LIFI_API_KEY: z.string().optional(),
  
  // Logging
  LOG_LEVEL: logLevelSchema.default('info'),
  
  // Chain IDs constants
  FROM_CHAIN_ID: chainIdSchema.default(8453),
  TO_CHAIN_ID: chainIdSchema.default(2741),
  BASE_CHAIN_ID: chainIdSchema.default(8453),
  ABSTRACT_CHAIN_ID: chainIdSchema.default(2741),
  
  // Fee tiers Uniswap v3
  FEE_TIERS: z.array(z.number()).default([500, 3000, 10000]),
  
  // Gas settings
  GAS_LIMIT_MULTIPLIER: z.number().min(1).max(2).default(1.2),
  MAX_GAS_PRICE_GWEI: z.number().positive().default(50),
  
  // Retry settings
  MAX_RETRIES: z.number().int().min(0).max(10).default(3),
  RETRY_DELAY_MS: z.number().int().positive().default(1000),
});

// Transformer les valeurs string en types appropriés
const transformConfig = (raw: Record<string, string | undefined>) => {
  return {
    ...raw,
    DRY_RUN: raw.DRY_RUN === 'true',
    SWAP_SLIPPAGE_BPS: parseInt(raw.SWAP_SLIPPAGE_BPS || '80'),
    LP_RANGE_PCT: parseFloat(raw.LP_RANGE_PCT || '5'),
    LP_MINUTES_BEFORE_COLLECT: parseInt(raw.LP_MINUTES_BEFORE_COLLECT || '10'),
    FROM_CHAIN_ID: parseInt(raw.FROM_CHAIN_ID || '8453'),
    TO_CHAIN_ID: parseInt(raw.TO_CHAIN_ID || '2741'),
    BASE_CHAIN_ID: parseInt(raw.BASE_CHAIN_ID || '8453'),
    ABSTRACT_CHAIN_ID: parseInt(raw.ABSTRACT_CHAIN_ID || '2741'),
    FEE_TIERS: JSON.parse(raw.FEE_TIERS || '[500, 3000, 10000]'),
    GAS_LIMIT_MULTIPLIER: parseFloat(raw.GAS_LIMIT_MULTIPLIER || '1.2'),
    MAX_GAS_PRICE_GWEI: parseFloat(raw.MAX_GAS_PRICE_GWEI || '50'),
    MAX_RETRIES: parseInt(raw.MAX_RETRIES || '3'),
    RETRY_DELAY_MS: parseInt(raw.RETRY_DELAY_MS || '1000'),
    
    // Multi-wallet configuration
    WALLET_COUNT: parseInt(raw.WALLET_COUNT || '100'),
    BYBIT_SANDBOX: raw.BYBIT_SANDBOX === 'true',
    BYBIT_TESTNET: raw.BYBIT_TESTNET === 'true',
    DISTRIBUTION_USDC_PER_WALLET: parseFloat(raw.DISTRIBUTION_USDC_PER_WALLET || '10.0'),
    DISTRIBUTION_ETH_PER_WALLET: parseFloat(raw.DISTRIBUTION_ETH_PER_WALLET || '0.005'),
    DISTRIBUTION_RANDOMIZE_AMOUNTS: raw.DISTRIBUTION_RANDOMIZE_AMOUNTS === 'true',
    DISTRIBUTION_VARIATION_PERCENT: parseFloat(raw.DISTRIBUTION_VARIATION_PERCENT || '10'),
    
    // Nouvelles configurations
    WITHDRAW_ENABLED: raw.WITHDRAW_ENABLED === 'true',
    WITHDRAW_ASSET_USDC: raw.WITHDRAW_ASSET_USDC === 'true',
    WITHDRAW_ASSET_ETH: raw.WITHDRAW_ASSET_ETH === 'true',
    WITHDRAW_USDC_MIN: parseFloat(raw.WITHDRAW_USDC_MIN || '10'),
    WITHDRAW_USDC_MAX: parseFloat(raw.WITHDRAW_USDC_MAX || '100'),
    WITHDRAW_ETH_MIN: parseFloat(raw.WITHDRAW_ETH_MIN || '0.01'),
    WITHDRAW_ETH_MAX: parseFloat(raw.WITHDRAW_ETH_MAX || '0.1'),
    DISTRIB_TOPUP_ETH: parseFloat(raw.DISTRIB_TOPUP_ETH || '0.0001'),
    BYPASS_POLLING: raw.BYPASS_POLLING === 'true',
    POLLING_TIMEOUT_MS: parseInt(raw.POLLING_TIMEOUT_MS || '300000'),
    POLLING_INTERVAL_MS: parseInt(raw.POLLING_INTERVAL_MS || '10000'),
  };
};

// Valider et transformer la configuration
const rawConfig = process.env as Record<string, string | undefined>;
const transformedConfig = transformConfig(rawConfig);

const result = configSchema.safeParse(transformedConfig);

if (!result.success) {
  console.error('❌ Erreur de configuration:');
  result.error.errors.forEach((error) => {
    console.error(`  - ${error.path.join('.')}: ${error.message}`);
  });
  process.exit(1);
}

export const cfg = result.data;

// Types exportés pour TypeScript
export type Config = typeof cfg;
export type SupportedToken = z.infer<typeof supportedTokenSchema>;
export type LogLevel = z.infer<typeof logLevelSchema>;

// Constantes dérivées
export const CONSTANTS = {
  // Chain IDs
  CHAIN_IDS: {
    BASE: cfg.BASE_CHAIN_ID,
    ABSTRACT: cfg.ABSTRACT_CHAIN_ID,
    ARBITRUM: 42161, // Arbitrum One
  },
  
  // Adresses natives
  NATIVE_ADDRESS: '0x0000000000000000000000000000000000000000',
  
  // Uniswap v3
  UNIV3: {
    FACTORY: cfg.UNIV3_FACTORY,
    QUOTER_V2: cfg.QUOTER_V2,
    SWAP_ROUTER_02: cfg.SWAP_ROUTER_02,
    NF_POSITION_MANAGER: cfg.NF_POSITION_MANAGER,
    FEE_TIERS: cfg.FEE_TIERS,
  },
  
  // Tokens
  TOKENS: {
    PENGU: cfg.PENGU_ADDRESS_ABS,
    WETH: cfg.WETH_ADDRESS_ABS,
    USDC: cfg.USDC_ADDRESS_ABS,
    // Tokens sur Base
    USDC_BASE: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC sur Base
  },
  
  // Li.Fi
  LIFI: {
    BASE_URL: cfg.LIFI_BASE_URL,
    API_KEY: cfg.LIFI_API_KEY,
  },
  
  // Configuration
  DRY_RUN: cfg.DRY_RUN,
    MIN_BRIDGE_USD: cfg.MIN_BRIDGE_USD,
    MIN_SWAP_USD: cfg.MIN_SWAP_USD,
    MIN_ABS_GAS_BUFFER_ETH: cfg.MIN_ABS_GAS_BUFFER_ETH,
    
    // Auto gas top-up
    MIN_NATIVE_DEST_WEI_FOR_APPROVE: cfg.MIN_NATIVE_DEST_WEI_FOR_APPROVE,
    MIN_NATIVE_DEST_WEI_FOR_SWAP: cfg.MIN_NATIVE_DEST_WEI_FOR_SWAP,
    AUTO_GAS_TOPUP: cfg.AUTO_GAS_TOPUP,
    GAS_TOPUP_TARGET_WEI: cfg.GAS_TOPUP_TARGET_WEI,
} as const;

// Fonction utilitaire pour vérifier si on est en mode DRY_RUN
export const isDryRun = () => cfg.DRY_RUN;

// Fonction utilitaire pour obtenir l'adresse du token de destination
export const getBridgeTokenAddress = (token: SupportedToken): string => {
  switch (token) {
    case 'ETH':
      return CONSTANTS.NATIVE_ADDRESS;
    case 'USDC':
      return CONSTANTS.TOKENS.USDC;
    default:
      throw new Error(`Token non supporté: ${token}`);
  }
};

// Fonction utilitaire pour obtenir l'adresse WETH
export const getWethAddress = (): string => {
  return CONSTANTS.TOKENS.WETH;
};
