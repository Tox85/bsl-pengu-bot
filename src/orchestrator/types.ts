// Types pour l'état de l'orchestrateur
export interface OrchestratorState {
  wallet: string;
  currentStep: OrchestratorStep;
  bridgeResult?: BridgeResult;
  swapResult?: SwapResult;
  positionResult?: PositionResult;
  collectResult?: PositionResult;
  tokenTopUp?: {
    enabled: boolean;
    token: string;
    requested: string;
    bridged: string;
    fromChainId: number;
    toChainId: number;
    txHash?: string;
    routeId?: string;
    completed: boolean;
  };
  createdAt: number;
  updatedAt: number;
}

// Types pour les étapes de l'orchestrateur
export enum OrchestratorStep {
  IDLE = 'idle',
  BRIDGE_PENDING = 'bridge_pending',
  BRIDGE_DONE = 'bridge_done',
  SWAP_PENDING = 'swap_pending',
  SWAP_DONE = 'swap_done',
  LP_PENDING = 'lp_pending',
  LP_DONE = 'lp_done',
  COLLECT_PENDING = 'collect_pending',
  COLLECT_DONE = 'collect_done',
  // Étapes pour le mode direct
  DIRECT_LP_PENDING = 'direct_lp_pending',
  DIRECT_LP_DONE = 'direct_lp_done',
  DIRECT_COLLECT_PENDING = 'direct_collect_pending',
  DIRECT_COLLECT_DONE = 'direct_collect_done',
  ERROR = 'error',
}

// Types pour les paramètres de l'orchestrateur
export interface OrchestratorParams {
  privateKey: string;
  bridgeAmount: string;
  bridgeToken: 'ETH' | 'USDC';
  swapAmount: string;
  swapPair: 'PENGU/ETH' | 'PENGU/USDC';
  lpRangePercent: number;
  collectAfterMinutes: number;
  dryRun?: boolean;
  // Options de gas
  autoGasTopUp?: boolean;
  minNativeOnDest?: string;
  gasTopUpTarget?: string;
  // Options de swap
  swapEngine?: 'v3' | 'lifi' | 'auto';
  // Overrides d'adresses
  routerOverride?: string;
  npmOverride?: string;
  factoryOverride?: string;
  // Options d'auto token top-up
  autoTokenTopUp?: boolean;
  tokenTopUpSafetyBps?: number;
  tokenTopUpMin?: string;
  tokenTopUpSourceChainId?: number;
  tokenTopUpMaxWaitSec?: number;
}

// Types pour les paramètres du mode direct
export interface OrchestratorDirectParams {
  privateKey: string;
  pair: 'PENGU/ETH' | 'PENGU/USDC';
  amount0: string;
  amount1: string;
  rangePercent: number;
  collectAfterMinutes: number;
  dryRun?: boolean;
  // Options de gas
  autoGasTopUp?: boolean;
  minNativeOnDest?: string;
  gasTopUpTarget?: string;
  // Options de pool
  fee?: number;
}

// Types pour les résultats de l'orchestrateur
export interface OrchestratorResult {
  success: boolean;
  state: OrchestratorState;
  error?: string;
  metrics?: OrchestratorMetrics;
}

// Types pour les métriques de l'orchestrateur
export interface OrchestratorMetrics {
  totalFeesCollected: {
    token0: string;
    amount0: bigint;
    token1: string;
    amount1: bigint;
  };
  totalGasUsed: bigint;
  totalDuration: number;
  pnl: {
    token0: bigint;
    token1: bigint;
  };
}

// Types pour les résultats de bridge
export interface BridgeResult {
  routeId: string;
  txHash: string;
  fromAmount: string;
  toAmount: string;
  status: string;
  success: boolean;
  gasUsed?: string;
  error?: string;
}

// Types pour les résultats de swap
export interface SwapResult {
  poolAddress: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  txHash: string;
  success: boolean;
  gasUsed?: string;
  error?: string;
}

// Types pour les résultats de position
export interface PositionResult {
  tokenId: bigint;
  token0: string;
  token1: string;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  amount0: bigint;
  amount1: bigint;
  txHash: string;
  success: boolean;
  gasUsed?: string;
  error?: string;
}
