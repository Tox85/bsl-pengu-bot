import { ethers } from 'ethers';

// Constantes mathématiques pour Uniswap v3
export const Q96 = 2n ** 96n;
export const Q128 = 2n ** 128n;

// Fonction utilitaire pour calculer sqrtPriceX96 à partir du prix
export const priceToSqrtPriceX96 = (price: number): bigint => {
  const sqrtPrice = Math.sqrt(price);
  return BigInt(Math.floor(sqrtPrice * Number(Q96)));
};

// Fonction utilitaire pour calculer le prix à partir de sqrtPriceX96
export const sqrtPriceX96ToPrice = (sqrtPriceX96: bigint): number => {
  const sqrtPrice = Number(sqrtPriceX96) / Number(Q96);
  return sqrtPrice * sqrtPrice;
};

// Fonction utilitaire pour calculer les ticks à partir du prix
export const priceToTick = (price: number): number => {
  return Math.floor(Math.log(price) / Math.log(1.0001));
};

// Fonction utilitaire pour calculer le prix à partir du tick
export const tickToPrice = (tick: number): number => {
  return Math.pow(1.0001, tick);
};

// Fonction utilitaire pour calculer le range de ticks
export const calculateTickRange = (
  currentTick: number,
  tickSpacing: number,
  rangePercent: number
): { tickLower: number; tickUpper: number } => {
  const tickRange = Math.floor((rangePercent / 100) * currentTick);
  const tickLower = Math.floor((currentTick - tickRange) / tickSpacing) * tickSpacing;
  const tickUpper = Math.ceil((currentTick + tickRange) / tickSpacing) * tickSpacing;
  
  return { tickLower, tickUpper };
};

// Fonction utilitaire pour calculer le slippage en BPS
export const calculateSlippage = (amountOut: bigint, slippageBps: number): bigint => {
  const slippageMultiplier = BigInt(10000 - slippageBps);
  return (amountOut * slippageMultiplier) / 10000n;
};

// Fonction utilitaire pour calculer le montant minimum avec slippage
export const calculateMinAmountOut = (
  amountOut: bigint,
  slippageBps: number
): bigint => {
  return calculateSlippage(amountOut, slippageBps);
};

// Fonction utilitaire pour calculer le montant maximum avec slippage
export const calculateMaxAmountIn = (
  amountIn: bigint,
  slippageBps: number
): bigint => {
  const slippageMultiplier = BigInt(10000 + slippageBps);
  return (amountIn * slippageMultiplier) / 10000n;
};

// Fonction utilitaire pour formater les montants avec decimals
export const formatAmount = (amount: bigint, decimals: number): string => {
  return ethers.formatUnits(amount, decimals);
};

// Fonction utilitaire pour parser les montants avec decimals
export const parseAmount = (amount: string, decimals: number): bigint => {
  return ethers.parseUnits(amount, decimals);
};

// Fonction utilitaire pour calculer le price impact
export const calculatePriceImpact = (
  amountIn: bigint,
  amountOut: bigint,
  expectedAmountOut: bigint
): number => {
  if (expectedAmountOut === 0n) return 0;
  
  const priceImpact = Number(expectedAmountOut - amountOut) / Number(expectedAmountOut);
  return Math.abs(priceImpact) * 100; // En pourcentage
};

// Fonction utilitaire pour vérifier si le price impact est acceptable
export const isPriceImpactAcceptable = (
  priceImpact: number,
  maxPriceImpact: number = 3
): boolean => {
  return priceImpact <= maxPriceImpact;
};

// Fonction utilitaire pour calculer les frais de position
export const calculatePositionFees = (
  liquidity: bigint,
  tickLower: number,
  tickUpper: number,
  feeGrowthInside0LastX128: bigint,
  feeGrowthInside1LastX128: bigint,
  feeGrowthGlobal0X128: bigint,
  feeGrowthGlobal1X128: bigint
): { fees0: bigint; fees1: bigint } => {
  // Calcul simplifié des frais de position
  // En réalité, il faudrait implémenter la logique complète de Uniswap v3
  const fees0 = (liquidity * (feeGrowthGlobal0X128 - feeGrowthInside0LastX128)) / Q128;
  const fees1 = (liquidity * (feeGrowthGlobal1X128 - feeGrowthInside1LastX128)) / Q128;
  
  return { fees0, fees1 };
};
