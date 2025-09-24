import {
  Contract,
  JsonRpcProvider,
  Wallet,
} from 'ethers';
import { DEX, FEES, NETWORKS, TOKENS } from './config.js';
import type {
  FeeSnapshot,
  HarvestResult,
  LiquidityPosition,
  PositionInstruction,
  RebalanceReason,
} from './types.js';
import { differencePercent, now, fromWei } from './utils.js';
import { logger } from './logger.js';

const ROUTER_ABI = [
  'function addLiquidity(address tokenA,address tokenB,uint amountADesired,uint amountBDesired,uint amountAMin,uint amountBMin,address to,uint deadline) returns (uint amountA,uint amountB,uint liquidity)',
  'function removeLiquidity(address tokenA,address tokenB,uint liquidity,uint amountAMin,uint amountBMin,address to,uint deadline) returns (uint amountA,uint amountB)',
];

const PAIR_ABI = [
  'function getReserves() view returns (uint112 reserve0,uint112 reserve1,uint32 blockTimestampLast)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
];

const ERC20_ABI = [
  'function approve(address spender, uint256 value) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
];

const WETH_ABI = [
  ...ERC20_ABI,
  'function deposit() payable',
  'function withdraw(uint256 amount)',
];

const MAX_ALLOWANCE = (1n << 256n) - 1n;

type PositionSnapshot = {
  currentEth: bigint;
  currentPengu: bigint;
  feesEth: bigint;
  feesPengu: bigint;
  priceScaled: bigint;
};

const scaleDown = (value: bigint, divisor: bigint) => (divisor === 0n ? 0n : value / divisor);

export class LPManager {
  private readonly provider: JsonRpcProvider;
  private readonly signer: Wallet;
  private readonly router: Contract;
  private readonly pair: Contract;
  private readonly weth: Contract;
  private readonly pengu: Contract;
  private tokenOrder: { token0: string; token1: string } | null = null;

  constructor(privateKey: string) {
    this.provider = new JsonRpcProvider(NETWORKS.abstract.rpcUrl, NETWORKS.abstract.chainId);
    this.signer = new Wallet(privateKey, this.provider);
    this.router = new Contract(DEX.router, ROUTER_ABI, this.signer);
    this.pair = new Contract(DEX.pair, PAIR_ABI, this.signer);
    this.weth = new Contract(TOKENS.eth.address, WETH_ABI, this.signer);
    this.pengu = new Contract(TOKENS.pengu.address, ERC20_ABI, this.signer);
  }

  private async ensureTokenOrder() {
    if (!this.tokenOrder) {
      const [token0, token1] = await Promise.all([this.pair.token0(), this.pair.token1()]);
      this.tokenOrder = { token0: token0.toLowerCase(), token1: token1.toLowerCase() };
    }
    return this.tokenOrder;
  }

  private async getReserves() {
    const reserves = await this.pair.getReserves();
    const { token0 } = await this.ensureTokenOrder();
    const reserve0 = BigInt(reserves[0]);
    const reserve1 = BigInt(reserves[1]);
    const reserveEth = token0 === TOKENS.eth.address.toLowerCase() ? reserve0 : reserve1;
    const reservePengu = token0 === TOKENS.eth.address.toLowerCase() ? reserve1 : reserve0;
    const price = reserveEth === 0n ? 0 : Number(reservePengu) / Number(reserveEth);
    const priceScaled = BigInt(Math.round(price * 1e6));
    return { reserveEth, reservePengu, priceScaled };
  }

  private async getTotalSupply(): Promise<bigint> {
    return (await this.pair.totalSupply()).toBigInt();
  }

  private async ensureApprovals() {
    const approvals: Array<{ token: Contract; name: string }> = [
      { token: this.weth, name: 'WETH' },
      { token: this.pengu, name: 'PENGU' },
    ];
    for (const { token, name } of approvals) {
      const allowance = (await token.allowance(this.signer.address, DEX.router)).toBigInt();
      if (allowance < MAX_ALLOWANCE / 2n) {
        const tx = await token.approve(DEX.router, MAX_ALLOWANCE);
        await tx.wait();
        logger.info({ token: name, txHash: tx.hash }, 'Approved router for LP operations');
      }
    }
  }

  private async ensureWrappedEth(targetWei: bigint) {
    const current = (await this.weth.balanceOf(this.signer.address)).toBigInt();
    if (current >= targetWei) return;
    const shortfall = targetWei - current;
    if (shortfall === 0n) return;
    const tx = await this.weth.deposit({ value: shortfall });
    await tx.wait();
    logger.info({ amountEth: fromWei(shortfall) }, 'Wrapped native ETH into WETH for LP');
  }

  private async shareForLpTokens(lpTokens: bigint) {
    if (lpTokens === 0n) {
      return { ethShare: 0n, penguShare: 0n, priceScaled: 0n };
    }
    const { reserveEth, reservePengu, priceScaled } = await this.getReserves();
    const totalSupply = await this.getTotalSupply();
    if (totalSupply === 0n) {
      return { ethShare: 0n, penguShare: 0n, priceScaled };
    }
    const ethShare = (reserveEth * lpTokens) / totalSupply;
    const penguShare = (reservePengu * lpTokens) / totalSupply;
    return { ethShare, penguShare, priceScaled };
  }

  async getCurrentPrice(): Promise<{ price: number; priceScaled: bigint }> {
    const { reserveEth, reservePengu, priceScaled } = await this.getReserves();
    const price = reserveEth === 0n ? 0 : Number(reservePengu) / Number(reserveEth);
    return { price, priceScaled };
  }

  async createPosition(instruction: PositionInstruction, gasPriceWei: bigint): Promise<LiquidityPosition> {
    if (instruction.targetEthWei === 0n || instruction.targetPenguWei === 0n) {
      throw new Error('Cannot create LP position with zero amounts');
    }

    await this.ensureApprovals();
    await this.ensureWrappedEth(instruction.targetEthWei);

    const { token0 } = await this.ensureTokenOrder();
    const ethIsToken0 = token0 === TOKENS.eth.address.toLowerCase();
    const amount0 = ethIsToken0 ? instruction.targetEthWei : instruction.targetPenguWei;
    const amount1 = ethIsToken0 ? instruction.targetPenguWei : instruction.targetEthWei;

    const balanceBefore: bigint = (await this.pair.balanceOf(this.signer.address)).toBigInt();
    const min0 = amount0 - scaleDown(amount0, 20n);
    const min1 = amount1 - scaleDown(amount1, 20n);

    const tx = await this.router.addLiquidity(
      TOKENS.eth.address,
      TOKENS.pengu.address,
      amount0,
      amount1,
      min0 < 0n ? 0n : min0,
      min1 < 0n ? 0n : min1,
      this.signer.address,
      BigInt(now() + 600),
      { gasPrice: gasPriceWei },
    );
    await tx.wait();

    const balanceAfter: bigint = (await this.pair.balanceOf(this.signer.address)).toBigInt();
    const minted: bigint = balanceAfter - balanceBefore;

    const { ethShare, penguShare, priceScaled } = await this.shareForLpTokens(minted);

    const position: LiquidityPosition = {
      lpTokenAmount: minted,
      depositedEth: ethShare,
      depositedPengu: penguShare,
      lastPriceScaled: priceScaled,
      lastHarvestTimestamp: now(),
      lastCollectedFeesEth: 0n,
      lastCollectedFeesPengu: 0n,
    };

    logger.info(
      {
        minted: minted.toString(),
        depositedEth: fromWei(ethShare),
        depositedPengu: fromWei(penguShare),
      },
      'LP position created on Uniswap v2 pair',
    );
    return position;
  }

  async estimatePosition(position: LiquidityPosition): Promise<PositionSnapshot> {
    if (position.lpTokenAmount === 0n) {
      return {
        currentEth: 0n,
        currentPengu: 0n,
        feesEth: 0n,
        feesPengu: 0n,
        priceScaled: position.lastPriceScaled,
      };
    }
    const { ethShare, penguShare, priceScaled } = await this.shareForLpTokens(position.lpTokenAmount);
    const feesEth = ethShare > position.depositedEth ? ethShare - position.depositedEth : 0n;
    const feesPengu = penguShare > position.depositedPengu ? penguShare - position.depositedPengu : 0n;
    return { currentEth: ethShare, currentPengu: penguShare, feesEth, feesPengu, priceScaled };
  }

  evaluateRebalance(
    position: LiquidityPosition,
    snapshot: PositionSnapshot,
    gasCostWei: bigint,
  ): { shouldRebalance: boolean; reason: RebalanceReason | null } {
    const priceChange = differencePercent(snapshot.priceScaled, position.lastPriceScaled);
    const feesValue = snapshot.feesEth + snapshot.feesPengu;
    const feesWorth = feesValue > gasCostWei * BigInt(FEES.rebalanceGasMultiplier);

    if (priceChange > FEES.priceThresholdPercent) return { shouldRebalance: true, reason: 'PRICE_DRIFT' };
    if (feesWorth) return { shouldRebalance: true, reason: 'FEES_HIGH' };
    return { shouldRebalance: false, reason: null };
  }

  async collectFees(position: LiquidityPosition, gasPriceWei: bigint): Promise<HarvestResult> {
    if (position.lpTokenAmount === 0n) {
      return { totalEth: 0n, totalPengu: 0n, fees: { accruedEth: 0n, accruedPengu: 0n, estimatedGasCostWei: 0n } };
    }

    const snapshot = await this.estimatePosition(position);
    const balanceEthBefore: bigint = (await this.weth.balanceOf(this.signer.address)).toBigInt();
    const balancePenguBefore: bigint = (await this.pengu.balanceOf(this.signer.address)).toBigInt();

    const tx = await this.router.removeLiquidity(
      TOKENS.eth.address,
      TOKENS.pengu.address,
      position.lpTokenAmount,
      0,
      0,
      this.signer.address,
      BigInt(now() + 600),
      { gasPrice: gasPriceWei },
    );
    await tx.wait();

    const balanceEthAfter: bigint = (await this.weth.balanceOf(this.signer.address)).toBigInt();
    const balancePenguAfter: bigint = (await this.pengu.balanceOf(this.signer.address)).toBigInt();

    const totalEth: bigint = balanceEthAfter - balanceEthBefore;
    const totalPengu: bigint = balancePenguAfter - balancePenguBefore;
    const feesEth: bigint = totalEth > position.depositedEth ? totalEth - position.depositedEth : 0n;
    const feesPengu: bigint = totalPengu > position.depositedPengu ? totalPengu - position.depositedPengu : 0n;

    const fees: FeeSnapshot = {
      accruedEth: feesEth,
      accruedPengu: feesPengu,
      estimatedGasCostWei: gasPriceWei * 300000n,
    };

    position.lastCollectedFeesEth += feesEth;
    position.lastCollectedFeesPengu += feesPengu;
    position.lpTokenAmount = 0n;
    position.depositedEth = 0n;
    position.depositedPengu = 0n;
    position.lastPriceScaled = snapshot.priceScaled;
    position.lastHarvestTimestamp = now();

    logger.info(
      { totalEth: fromWei(totalEth), totalPengu: fromWei(totalPengu) },
      'LP liquidity withdrawn',
    );
    return { totalEth, totalPengu, fees };
  }

  async closePosition(position: LiquidityPosition, gasPriceWei: bigint): Promise<void> {
    await this.collectFees(position, gasPriceWei);
    logger.info('Closed LP position');
  }
}

