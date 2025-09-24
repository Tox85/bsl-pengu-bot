import { parseUnits, formatUnits } from 'ethers';

export const now = () => Math.floor(Date.now() / 1000);

export const toWei = (amount: number, decimals = 18): bigint => {
  return parseUnits(amount.toFixed(decimals), decimals);
};

export const fromWei = (amount: bigint, decimals = 18): number => {
  return Number(formatUnits(amount, decimals));
};

export const percentToBps = (percent: number): number => Math.round(percent * 100);

export const applySlippageBps = (amountWei: bigint, bps: number): bigint => {
  return (amountWei * BigInt(10000 - bps)) / 10000n;
};

export const priceToTick = (price: number): number => {
  const log = Math.log(price) / Math.log(1.0001);
  return Math.floor(log);
};

export const tickToPrice = (tick: number): number => {
  return Math.pow(1.0001, tick);
};

export const clampTickToSpacing = (tick: number, spacing: number): number => {
  return Math.round(tick / spacing) * spacing;
};

export const deriveRangeFromPrice = (
  midPrice: number,
  rangePercent: number,
  tickSpacing: number,
): { lowerTick: number; upperTick: number } => {
  const lowerPrice = midPrice * (1 - rangePercent / 100);
  const upperPrice = midPrice * (1 + rangePercent / 100);

  const lowerTick = clampTickToSpacing(priceToTick(lowerPrice), tickSpacing);
  const upperTick = clampTickToSpacing(priceToTick(upperPrice), tickSpacing);

  if (lowerTick === upperTick) {
    return {
      lowerTick: lowerTick - tickSpacing,
      upperTick: upperTick + tickSpacing,
    };
  }

  return { lowerTick, upperTick };
};

export const basisPointsFromPercent = (percent: number) => Math.floor(percent * 100);

export const calculateAllocation = (total: bigint, percent: number): bigint => {
  return (total * BigInt(Math.round(percent * 100))) / 10000n;
};

export const bigIntAbs = (value: bigint): bigint => (value >= 0n ? value : -value);

export const differencePercent = (a: bigint, b: bigint): number => {
  if (b === 0n) return 100;
  const diff = bigIntAbs(a - b);
  return Number((diff * 10000n) / b) / 100;
};

export const weiFromGwei = (gwei: number): bigint => {
  return BigInt(Math.round(gwei * 1e9)) * 1_000_000_000n;
};
