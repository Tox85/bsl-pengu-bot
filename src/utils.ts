import { parseUnits, formatUnits } from 'ethers';

export const now = () => Math.floor(Date.now() / 1000);

export const toWei = (amount: number, decimals = 18): bigint => {
  return parseUnits(amount.toFixed(decimals), decimals);
};

export const fromWei = (amount: bigint, decimals = 18): number => {
  return Number(formatUnits(amount, decimals));
};

export const applySlippageBps = (amountWei: bigint, bps: number): bigint => {
  return (amountWei * BigInt(10000 - bps)) / 10000n;
};

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
  return BigInt(Math.round(gwei * 1e9));
};

export const scaleByPercent = (value: bigint, fraction: number): bigint => {
  if (fraction <= 0) return 0n;
  const scaled = Math.round(fraction * 10000);
  return (value * BigInt(scaled)) / 10000n;
};
