import {
  Contract,
  JsonRpcProvider,
  Wallet,
  getAddress,
  type ContractTransactionReceipt,
  type Log,
  type LogDescription,
} from 'ethers';
import { FEES, NETWORKS, TOKENS, env } from './config.js';
import type { FeeSnapshot, LiquidityPosition, PositionInstruction, RebalanceReason } from './types.js';
import { deriveRangeFromPrice, differencePercent, now } from './utils.js';
import { logger } from './logger.js';

const POSITION_MANAGER_ABI = [
  'function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)',
  'function mint((address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline)) returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
  'function increaseLiquidity((uint256 tokenId,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,uint256 deadline)) returns (uint128 liquidity, uint256 amount0, uint256 amount1)',
  'function decreaseLiquidity((uint256 tokenId,uint128 liquidity,uint256 amount0Min,uint256 amount1Min,uint256 deadline)) returns (uint256 amount0, uint256 amount1)',
  'function collect((uint256 tokenId,address recipient,uint128 amount0Max,uint128 amount1Max)) returns (uint256 amount0, uint256 amount1)',
  'function burn(uint256 tokenId)'
];

const POOL_ABI = [
  'function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16 observationIndex,uint16 observationCardinality,uint16 observationCardinalityNext,uint8 feeProtocol,bool unlocked)',
  'function liquidity() view returns (uint128)',
  'function tickSpacing() view returns (int24)',
];

const ERC20_ABI = [
  'function approve(address spender, uint256 value) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)'
];

const MAX_UINT128 = (1n << 128n) - 1n;
const MAX_UINT256 = (1n << 256n) - 1n;

export class LPManager {
  private readonly provider: JsonRpcProvider;
  private readonly signer: Wallet;
  private readonly pool: Contract;
  private readonly manager: Contract;
  private currentPosition: LiquidityPosition | null = null;

  private parseReceipt(receipt: ContractTransactionReceipt, eventNames: string[]): LogDescription | null {
    for (const log of receipt.logs as Log[]) {
      try {
        const parsedLog = this.manager.interface.parseLog(log) as LogDescription;
        if (eventNames.includes(parsedLog.name)) {
          return parsedLog;
        }
      } catch {
        continue;
      }
    }
    return null;
  }

  private valueToBigInt(value: unknown): bigint {
    if (typeof value === 'bigint') return value;
    if (typeof value === 'number') return BigInt(Math.floor(value));
    if (typeof value === 'string') return BigInt(value);
    if (value && typeof value === 'object' && 'toString' in value) {
      return BigInt((value as { toString(): string }).toString());
    }
    return 0n;
  }

  constructor(privateKey: string) {
    this.provider = new JsonRpcProvider(NETWORKS.abstract.rpcUrl, NETWORKS.abstract.chainId);
    this.signer = new Wallet(privateKey, this.provider);
    this.pool = new Contract(env.TARGET_POOL_ADDRESS, POOL_ABI, this.signer);
    this.manager = new Contract(env.POSITION_MANAGER_ADDRESS, POSITION_MANAGER_ABI, this.signer);
  }

  async syncPosition(tokenId?: bigint): Promise<LiquidityPosition | null> {
    const activeTokenId = tokenId ?? this.currentPosition?.tokenId;
    if (!activeTokenId) return null;
    const position = await this.manager.positions(activeTokenId);
    const state: LiquidityPosition = {
      tokenId: BigInt(activeTokenId),
      lowerTick: Number(position.tickLower),
      upperTick: Number(position.tickUpper),
      liquidity: BigInt(position.liquidity),
      depositedEth: BigInt(position.tokensOwed0 ?? 0),
      depositedPengu: BigInt(position.tokensOwed1 ?? 0),
      lastRebalancePrice: 0n,
      lastCollectedFeesEth: 0n,
      lastCollectedFeesPengu: 0n,
    };
    this.currentPosition = state;
    return state;
  }

  async ensureApprovals() {
    const tokens = [TOKENS.eth.address, TOKENS.pengu.address];
    for (const token of tokens) {
      const contract = new Contract(token, ERC20_ABI, this.signer);
      const allowance: bigint = (await contract.allowance(this.signer.address, env.POSITION_MANAGER_ADDRESS)).toBigInt();
      if (allowance < MAX_UINT128) {
        const tx = await contract.approve(env.POSITION_MANAGER_ADDRESS, MAX_UINT256);
        await tx.wait();
        logger.info({ token, txHash: tx.hash }, 'Approved position manager');
      }
    }
  }

  async getCurrentPrice(): Promise<{ price: number; tickSpacing: number; tick: number }> {
    const slot0 = await this.pool.slot0();
    const sqrtPriceX96 = Number(slot0[0]);
    const tick: number = Number(slot0[1]);
    const tickSpacing: number = Number(await this.pool.tickSpacing());
    const price = (sqrtPriceX96 / 2 ** 96) ** 2;
    return { price, tickSpacing, tick };
  }

  async createPosition(instruction: PositionInstruction, gasPriceWei: bigint): Promise<LiquidityPosition> {
    await this.ensureApprovals();
    const { price, tickSpacing } = await this.getCurrentPrice();
    const { lowerTick, upperTick } = deriveRangeFromPrice(price, instruction.rangePercent, tickSpacing);

    const deadline = now() + 600;
    const [token0, token1] = [TOKENS.eth.address, TOKENS.pengu.address].sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1));
    const amount0Desired = token0 === TOKENS.eth.address ? instruction.targetEthWei : instruction.targetPenguWei;
    const amount1Desired = token0 === TOKENS.eth.address ? instruction.targetPenguWei : instruction.targetEthWei;

    const tx = await this.manager.mint({
      token0: getAddress(token0),
      token1: getAddress(token1),
      fee: env.FEE_TIER_BPS,
      tickLower: lowerTick,
      tickUpper: upperTick,
      amount0Desired,
      amount1Desired,
      amount0Min: instruction.targetEthWei - instruction.targetEthWei / 10n,
      amount1Min: instruction.targetPenguWei - instruction.targetPenguWei / 10n,
      recipient: this.signer.address,
      deadline,
    }, { gasPrice: gasPriceWei });

    const receipt = await tx.wait();
    const event = this.parseReceipt(receipt, ['IncreaseLiquidity', 'Mint']);

    const tokenId: bigint = this.valueToBigInt(event?.args?.tokenId ?? 0n);

    const position: LiquidityPosition = {
      tokenId,
      lowerTick,
      upperTick,
      liquidity: this.valueToBigInt(event?.args?.liquidity ?? 0n),
      depositedEth: instruction.targetEthWei,
      depositedPengu: instruction.targetPenguWei,
      lastRebalancePrice: BigInt(Math.round(price * 1e6)),
      lastCollectedFeesEth: 0n,
      lastCollectedFeesPengu: 0n,
    };

    this.currentPosition = position;
    logger.info({ tokenId: position.tokenId?.toString() }, 'LP position created');
    return position;
  }

  async collectFees(position: LiquidityPosition, gasPriceWei: bigint): Promise<FeeSnapshot> {
    if (!position.tokenId) throw new Error('Position has no tokenId');
    const tx = await this.manager.collect({
      tokenId: position.tokenId,
      recipient: this.signer.address,
      amount0Max: MAX_UINT128,
      amount1Max: MAX_UINT128,
    }, { gasPrice: gasPriceWei });
    const receipt = await tx.wait();
    const event = this.parseReceipt(receipt, ['Collect']);

    const amount0 = this.valueToBigInt(event?.args?.amount0 ?? 0n);
    const amount1 = this.valueToBigInt(event?.args?.amount1 ?? 0n);
    const fees: FeeSnapshot = {
      accruedEth: amount0,
      accruedPengu: amount1,
      estimatedGasCostWei: gasPriceWei * 400000n,
    };
    if (this.currentPosition) {
      this.currentPosition.lastCollectedFeesEth += amount0;
      this.currentPosition.lastCollectedFeesPengu += amount1;
    }
    logger.info({ fees }, 'Fees collected');
    return fees;
  }

  async closePosition(position: LiquidityPosition, gasPriceWei: bigint): Promise<void> {
    if (!position.tokenId) return;
    await this.manager.decreaseLiquidity({
      tokenId: position.tokenId,
      liquidity: position.liquidity,
      amount0Min: 0,
      amount1Min: 0,
      deadline: now() + 600,
    }, { gasPrice: gasPriceWei });
    await this.collectFees(position, gasPriceWei);
    await this.manager.burn(position.tokenId, { gasPrice: gasPriceWei });
    logger.info({ tokenId: position.tokenId.toString() }, 'Position closed');
    this.currentPosition = null;
  }

  evaluateRebalance(
    position: LiquidityPosition,
    currentTick: number,
    currentPriceScaled: bigint,
    fees: FeeSnapshot,
    gasCostWei: bigint,
  ): { shouldRebalance: boolean; reason: RebalanceReason | null } {
    const priceChange = differencePercent(currentPriceScaled, position.lastRebalancePrice);
    const priceOutOfRange = currentTick <= position.lowerTick || currentTick >= position.upperTick;
    const feesWorth = fees.accruedEth + fees.accruedPengu > gasCostWei * BigInt(FEES.rebalanceGasMultiplier);

    if (priceOutOfRange) return { shouldRebalance: true, reason: 'PRICE_OUT_OF_RANGE' };
    if (feesWorth) return { shouldRebalance: true, reason: 'FEES_HIGH' };
    if (priceChange > FEES.priceThresholdPercent) return { shouldRebalance: true, reason: 'SIGNIFICANT_MOVE' };
    return { shouldRebalance: false, reason: null };
  }
}
