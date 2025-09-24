import { BybitClient } from './bybitClient.js';
import { WalletHub } from './walletHub.js';
import { BridgeService } from './bridgeService.js';
import { SwapService } from './swapService.js';
import { LPManager } from './lpManager.js';
import { FeeManager } from './feeManager.js';
import { ensureWalletState } from './walletStore.js';
import { env } from './config.js';
import type { LiquidityPosition, StrategyReport } from './types.js';
import { TOKENS } from './config.js';
import { toWei, weiFromGwei } from './utils.js';

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
    await this.bybit.withdrawEthToHub(withdrawAmountWei, this.walletState.hub.address);

    const gasPrice = weiFromGwei(env.GAS_PRICE_GWEI);
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
        const quote = await this.swap.fetchQuote(TOKENS.eth.address, TOKENS.pengu.address, halfEth);
        const swapResult = await this.swap.executeSwap(quote);
        swapExecuted = swapResult.success;
      }
    }

    const balances = await this.swap.getTokenBalances();
    const gasReserve = gasPrice * 400000n;
    const usableEth = balances.ethWei > gasReserve ? balances.ethWei - gasReserve : 0n;
    const usablePengu = balances.penguWei;

    if (!this.position) {
      const instruction = {
        targetEthWei: usableEth,
        targetPenguWei: usablePengu,
        rangePercent: env.RANGE_WIDTH_PERCENT,
      };
      this.position = await this.lpManager.createPosition(instruction, gasPrice);
    }

    const { price, tick } = await this.lpManager.getCurrentPrice();
    const priceScaled = BigInt(Math.round(price * 1e6));
    let feesCollected = null;
    let rebalance = { executed: false, reason: null } as StrategyReport['rebalance'];

    if (this.position?.tokenId) {
      const fees = await this.lpManager.collectFees(this.position, gasPrice);
      feesCollected = fees;
      const evaluation = this.lpManager.evaluateRebalance(
        this.position,
        tick,
        priceScaled,
        fees,
        gasPrice * 500000n,
      );
      if (evaluation.shouldRebalance && this.position) {
        await this.lpManager.closePosition(this.position, gasPrice);
        const recycled = await this.feeManager.recycleFees(fees);
        const instruction = {
          targetEthWei: usableEth + recycled.ethWei,
          targetPenguWei: usablePengu + recycled.penguWei,
          rangePercent: env.RANGE_WIDTH_PERCENT,
        };
        this.position = await this.lpManager.createPosition(instruction, gasPrice);
        this.position.lastRebalancePrice = priceScaled;
        rebalance = { executed: true, reason: evaluation.reason };
      }
    }

    return {
      timestamp: Date.now(),
      bridgeExecuted,
      swapExecuted,
      lpPosition: this.position!,
      feesCollected,
      rebalance,
    } satisfies StrategyReport;
  }
}
