// Types pour les pools Uniswap v3
export interface PoolInfo {
  address: string;
  token0: string;
  token1: string;
  fee: number;
  tickSpacing: number;
  liquidity: bigint;
  sqrtPriceX96: bigint;
  tick: number;
}

// Types pour les paramètres de swap
export interface SwapParams {
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  slippageBps: number;
  recipient: string;
  fee?: number; // Si non fourni, sera détecté automatiquement
}

// Types pour les résultats de swap
export interface SwapResult {
  pool: PoolInfo;
  amountOut: bigint;
  amountOutMin: bigint;
  txHash?: string;
  success: boolean;
  error?: string;
}

// Types pour les paramètres de quote
export interface QuoteParams {
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  fee?: number;
}

// Types pour les résultats de quote
export interface QuoteResult {
  amountOut: bigint;
  sqrtPriceX96After: bigint;
  initializedTicksCrossed: number;
  gasEstimate: bigint;
  pool: PoolInfo;
}

// Types pour la découverte de pools
export interface PoolDiscoveryParams {
  tokenA: string;
  tokenB: string;
  feeTiers: number[];
}

// Types pour les paramètres de transaction
export interface TransactionParams {
  to: string;
  data: string;
  value: bigint;
  gasLimit: bigint;
  gasPrice: bigint;
}
