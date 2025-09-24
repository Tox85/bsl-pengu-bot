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
  tokenId: bigint | null;
  lowerTick: number;
  upperTick: number;
  liquidity: bigint;
  depositedEth: bigint;
  depositedPengu: bigint;
  lastRebalancePrice: bigint;
  lastCollectedFeesEth: bigint;
  lastCollectedFeesPengu: bigint;
};

export type FeeSnapshot = {
  accruedEth: bigint;
  accruedPengu: bigint;
  estimatedGasCostWei: bigint;
};

export type PriceSample = {
  timestamp: number;
  ethPriceUsd: number;
  penguPriceUsd: number;
};

export type RebalanceReason =
  | 'PRICE_OUT_OF_RANGE'
  | 'FEES_HIGH'
  | 'SIGNIFICANT_MOVE'
  | 'MANUAL';

export type StrategyReport = {
  timestamp: number;
  bridgeExecuted: boolean;
  swapExecuted: boolean;
  lpPosition: LiquidityPosition;
  feesCollected: FeeSnapshot | null;
  rebalance: {
    executed: boolean;
    reason: RebalanceReason | null;
  };
};

export type BalanceBreakdown = {
  ethWei: bigint;
  penguWei: bigint;
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
  rangePercent: number;
};

export type GasConfig = {
  gasPriceWei: bigint;
};

export interface HubWalletState {
  hub: WalletRecord;
  satellites: WalletRecord[];
}
