// Types pour les positions LP
export interface PositionInfo {
  tokenId: bigint;
  token0: string;
  token1: string;
  fee: number;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  feeGrowthInside0LastX128: bigint;
  feeGrowthInside1LastX128: bigint;
  tokensOwed0: bigint;
  tokensOwed1: bigint;
}

// Types pour les paramètres de création de position
export interface CreatePositionParams {
  token0: string;
  token1: string;
  fee: number;
  tickLower: number;
  tickUpper: number;
  amount0Desired: bigint;
  amount1Desired: bigint;
  amount0Min: bigint;
  amount1Min: bigint;
  recipient: string;
  deadline: number;
}

// Types pour les paramètres d'augmentation de liquidité
export interface IncreaseLiquidityParams {
  tokenId: bigint;
  amount0Desired: bigint;
  amount1Desired: bigint;
  amount0Min: bigint;
  amount1Min: bigint;
  deadline: number;
}

// Types pour les paramètres de diminution de liquidité
export interface DecreaseLiquidityParams {
  tokenId: bigint;
  liquidity: bigint;
  amount0Min: bigint;
  amount1Min: bigint;
  deadline: number;
}

// Types pour les paramètres de collecte de frais
export interface CollectFeesParams {
  tokenId: bigint;
  recipient: string;
  amount0Max: bigint;
  amount1Max: bigint;
}

// Types pour les résultats de position
export interface PositionResult {
  tokenId?: bigint;
  liquidity?: bigint;
  amount0?: bigint;
  amount1?: bigint;
  txHash?: string;
  success: boolean;
  error?: string;
}

// Types pour les paramètres de calcul de range
export interface RangeParams {
  currentTick: number;
  tickSpacing: number;
  rangePercent: number;
}

// Types pour les paramètres de calcul de montants
export interface AmountParams {
  sqrtPriceX96: bigint;
  tickLower: number;
  tickUpper: number;
  amount0Desired: bigint;
  amount1Desired: bigint;
}

// Types pour les résultats de calcul
export interface CalculationResult {
  tickLower: number;
  tickUpper: number;
  amount0: bigint;
  amount1: bigint;
  liquidity: bigint;
}
