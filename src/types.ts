import type { AddressLike } from 'ethers';

export type WalletRecord = {
  label: string;
  address: string;
  privateKey: string;
};

export type DistributionPlan = {
  recipient: WalletRecord;
  amountWei: bigint;
};

export type BridgeQuote = {
  fromChainId: number;
  toChainId: number;
  fromToken: string;
  toToken: string;
  amountWei: bigint;
  minAmountOutWei: bigint;
  routeId: string;
  txData: string;
  txTarget: AddressLike;
  gasEstimate: bigint;
};

export type SwapQuote = {
  tokenIn: string;
  tokenOut: string;
  amountInWei: bigint;
  minAmountOutWei: bigint;
  calldata: string;
  target: AddressLike;
  valueWei: bigint;
};

export type LiquidityPosition = {
  lpTokenAmount: bigint;
  depositedEth: bigint;
  depositedPengu: bigint;
  lastPriceScaled: bigint;
  lastHarvestTimestamp: number;
  lastCollectedFeesEth: bigint;
  lastCollectedFeesPengu: bigint;
};

export type FeeSnapshot = {
  accruedEth: bigint;
  accruedPengu: bigint;
  estimatedGasCostWei: bigint;
};

export type HarvestResult = {
  totalEth: bigint;
  totalPengu: bigint;
  fees: FeeSnapshot;
};

export type PriceSample = {
  timestamp: number;
  ethPriceUsd: number;
  penguPriceUsd: number;
};

export type RebalanceReason = 'PRICE_DRIFT' | 'FEES_HIGH' | 'SIGNIFICANT_MOVE' | 'MANUAL';

export type StrategyReport = {
  timestamp: number;
  bridgeExecuted: boolean;
  swapExecuted: boolean;
  lpPosition: LiquidityPosition;
  feesCollected: HarvestResult | null;
  rebalance: {
    executed: boolean;
    reason: RebalanceReason | null;
  };
};

export type BalanceBreakdown = {
  ethWei: bigint;
  penguWei: bigint;
  nativeEthWei: bigint;
  wethWei: bigint;
};

export type ExecutionResult<T> = {
  success: boolean;
  txHash?: string;
  data?: T;
  error?: Error;
};

export type PositionInstruction = {
  targetEthWei: bigint;
  targetPenguWei: bigint;
};

export type GasConfig = {
  gasPriceWei: bigint;
};

export interface HubWalletState {
  hub: WalletRecord;
  satellites: WalletRecord[];
}
