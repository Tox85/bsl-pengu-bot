// Point d'entrée principal de l'application
export * from './config/env.js';
export * from './core/index.js';

// Bridge exports
export { BridgeService } from './bridge/lifi.js';
export type { 
  BridgeParams, 
  BridgeResult, 
  LiFiRoute,
  LiFiToken,
  LiFiStep 
} from './bridge/types.js';

// DEX exports
export { SwapService } from './dex/swap.js';
export { PoolDiscoveryService } from './dex/pools.js';
export type { 
  SwapParams, 
  SwapResult, 
  QuoteParams,
  QuoteResult,
  PoolInfo 
} from './dex/types.js';

// LP exports
export { LiquidityPositionService } from './lp/v3.js';
export type { 
  PositionResult,
  CreatePositionParams,
  IncreaseLiquidityParams,
  DecreaseLiquidityParams,
  CollectFeesParams 
} from './lp/types.js';

// Orchestrator exports
export { OrchestratorService } from './orchestrator/run.js';
export type { 
  OrchestratorParams,
  OrchestratorResult,
  OrchestratorState 
} from './orchestrator/types.js';

// CLI exports
export * from './cli/index.js';
