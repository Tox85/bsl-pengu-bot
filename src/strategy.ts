import { BybitClient } from './bybitClient.js';
import { WalletHub } from './walletHub.js';
import { BridgeService } from './bridgeService.js';
import { SwapService } from './swapService.js';
import { LPManager } from './lpManager.js';
import { FeeManager } from './feeManager.js';
import { ensureWalletState } from './walletStore.js';
import { env, STRATEGY_CONSTANTS, TOKENS } from './config.js';
import type { LiquidityPosition, StrategyReport } from './types.js';
import { toWei, weiFromGwei, scaleByPercent, now } from './utils.js';
import { logger } from './logger.js';

export class StrategyRunner {
  private readonly walletState = ensureWalletState();
  private readonly bybit = new BybitClient();
  private readonly walletHub = new WalletHub(this.walletState);
  private readonly strategyWallet = this.walletState.satellites[0];
  private readonly bridge = new BridgeService(this.strategyWallet.privateKey);
  private readonly swap = new SwapService(this.strategyWallet.privateKey);
  private readonly lpManager = new LPManager(this.strategyWallet.privateKey);
  private readonly feeManager = new FeeManager(this.swap);
  private position: LiquidityPosition | null = null;

  async getStrategyBalances() {
    return this.swap.getTokenBalances();
  }

  async executeCycle(): Promise<StrategyReport> {
    const withdrawAmountWei = toWei(env.HUB_WITHDRAW_AMOUNT);
    const gasPrice = weiFromGwei(env.GAS_PRICE_GWEI);

    if (this.bybit.isConfigured()) {
      await this.bybit.withdrawEthToHub(withdrawAmountWei, this.walletState.hub.address);
    } else if (env.BASE_FUNDING_PRIVATE_KEY) {
      await this.walletHub.fundHubFromExternal(env.BASE_FUNDING_PRIVATE_KEY, withdrawAmountWei, gasPrice);
    } else {
      logger.warn('No Bybit credentials or base funding key provided; skipping external funding');
    }

    const hubBalance = await this.walletHub.getHubBalance();
    const plan = this.walletHub.createDistributionPlan(hubBalance);
    await this.walletHub.executeDistribution(plan, gasPrice);

    let bridgeExecuted = false;
    const strategyAllocation = plan[0]?.amountWei ?? 0n;
    if (strategyAllocation > 0n) {
      const quote = await this.bridge.fetchQuote(strategyAllocation);
      const result = await this.bridge.executeBridge(quote);
      bridgeExecuted = result.success;
    }

    const balancesBeforeSwap = await this.swap.getTokenBalances();
    let swapExecuted = false;
    if (balancesBeforeSwap.ethWei > 0n) {
      const halfEth = balancesBeforeSwap.ethWei / 2n;
      if (halfEth > 0n) {
        await this.swap.ensureWethBalance(halfEth, balancesBeforeSwap.nativeEthWei);
        const quote = await this.swap.fetchQuote(TOKENS.eth.address, TOKENS.pengu.address, halfEth);
        const swapResult = await this.swap.executeSwap(quote);
        swapExecuted = swapResult.success;
      }
    }

    let balances = await this.swap.getTokenBalances();
    const gasReserve = gasPrice * 400000n;
    const availableNativeForWrap = balances.nativeEthWei > gasReserve ? balances.nativeEthWei - gasReserve : 0n;
    const desiredWeth = scaleByPercent(
      balances.wethWei + availableNativeForWrap,
      STRATEGY_CONSTANTS.liquidityUtilizationPercent,
    );
    const wrapNeeded = desiredWeth > balances.wethWei ? desiredWeth - balances.wethWei : 0n;
    const wrapAmount = wrapNeeded > availableNativeForWrap ? availableNativeForWrap : wrapNeeded;
    if (wrapAmount > 0n) {
      await this.swap.wrapNative(wrapAmount);
      balances = await this.swap.getTokenBalances();
    }

    let availableWeth = balances.wethWei;
    let availablePengu = balances.penguWei;

    let feesCollected: StrategyReport['feesCollected'] = null;
    let rebalance: StrategyReport['rebalance'] = { executed: false, reason: null };

    if (!this.position) {
      const instruction = {
        targetEthWei: scaleByPercent(availableWeth, STRATEGY_CONSTANTS.liquidityUtilizationPercent),
        targetPenguWei: scaleByPercent(availablePengu, STRATEGY_CONSTANTS.liquidityUtilizationPercent),
      };
      if (instruction.targetEthWei > 0n && instruction.targetPenguWei > 0n) {
        this.position = await this.lpManager.createPosition(instruction, gasPrice);
      }
    } else {
      const snapshot = await this.lpManager.estimatePosition(this.position);
      const evaluation = this.lpManager.evaluateRebalance(
        this.position,
        snapshot,
        gasPrice * 500000n,
      );
      if (evaluation.shouldRebalance) {
        const harvest = await this.lpManager.collectFees(this.position, gasPrice);
        feesCollected = harvest;
        availableWeth += harvest.totalEth;
        availablePengu += harvest.totalPengu;
        const recycled = await this.feeManager.recycleFees(harvest.fees);
        availableWeth += recycled.ethWei;
        availablePengu += recycled.penguWei;

        const instruction = {
          targetEthWei: scaleByPercent(availableWeth, STRATEGY_CONSTANTS.liquidityUtilizationPercent),
          targetPenguWei: scaleByPercent(availablePengu, STRATEGY_CONSTANTS.liquidityUtilizationPercent),
        };
        if (instruction.targetEthWei > 0n && instruction.targetPenguWei > 0n) {
          this.position = await this.lpManager.createPosition(instruction, gasPrice);
        } else {
          this.position = null;
        }
        rebalance = { executed: true, reason: evaluation.reason };
      } else {
        this.position.lastPriceScaled = snapshot.priceScaled;
      }
    }

    const activePosition: LiquidityPosition =
      this.position ??
      ({
        lpTokenAmount: 0n,
        depositedEth: 0n,
        depositedPengu: 0n,
        lastPriceScaled: 0n,
        lastHarvestTimestamp: now(),
        lastCollectedFeesEth: 0n,
        lastCollectedFeesPengu: 0n,
      } satisfies LiquidityPosition);

    return {
      timestamp: Date.now(),
      bridgeExecuted,
      swapExecuted,
      lpPosition: activePosition,
      feesCollected,
      rebalance,
    } satisfies StrategyReport;
  }
}
