import { BybitClient } from './bybitClient.js';
import { WalletHub } from './walletHub.js';
import { BridgeService } from './bridgeService.js';
import { SwapService } from './swapService.js';
import { LPManager } from './lpManager.js';
import { FeeManager } from './feeManager.js';
import { ensureWalletState } from './walletStore.js';
import { env, STRATEGY_CONSTANTS, TOKENS } from './config.js';
import type { LiquidityPosition, StrategyReport, RebalanceReason, BridgeQuote } from './types.js';
import { toWei, weiFromGwei, scaleByPercent, now, fromWei } from './utils.js';
import { logger } from './logger.js';

type CycleLogSummary = {
  funding: {
    source: 'BYBIT' | 'BASE' | 'NONE';
    requestedWei: bigint;
    confirmedWei: bigint;
  };
  distribution: {
    fundedWallets: number;
    totalWei: bigint;
  };
  bridge: {
    executed: boolean;
    amountWei: bigint;
  };
  swap: {
    executed: boolean;
    finalEthWei: bigint;
    finalPenguWei: bigint;
  };
  liquidity: {
    active: boolean;
    depositedEthWei: bigint;
    depositedPenguWei: bigint;
    rebalanceReason: RebalanceReason | null;
    feesEthWei: bigint;
    feesPenguWei: bigint;
  };
};

const BRIDGE_GAS_LIMIT_FALLBACK = 250_000n;

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
  private latestSummary: CycleLogSummary | null = null;

  async getStrategyBalances() {
    return this.swap.getTokenBalances();
  }

  async executeCycle(): Promise<StrategyReport> {
    const withdrawAmountWei = toWei(env.HUB_WITHDRAW_AMOUNT);
    const configuredGasPrice = weiFromGwei(env.GAS_PRICE_GWEI);
    let gasPrice = configuredGasPrice;
    try {
      const networkGasPrice = await this.walletHub.getNetworkGasPrice();
      if (networkGasPrice > gasPrice) {
        gasPrice = networkGasPrice;
      }
    } catch (error) {
      logger.warn({ err: error }, 'Failed to fetch network gas price; falling back to configured value');
    }

    logger.info('Starting strategy cycle');

    const summary: CycleLogSummary = {
      funding: { source: 'NONE', requestedWei: withdrawAmountWei, confirmedWei: 0n },
      distribution: { fundedWallets: 0, totalWei: 0n },
      bridge: { executed: false, amountWei: 0n },
      swap: { executed: false, finalEthWei: 0n, finalPenguWei: 0n },
      liquidity: {
        active: false,
        depositedEthWei: 0n,
        depositedPenguWei: 0n,
        rebalanceReason: null,
        feesEthWei: 0n,
        feesPenguWei: 0n,
      },
    };

    if (this.bybit.isConfigured()) {
      await this.bybit.withdrawEthToHub(withdrawAmountWei, this.walletState.hub.address);
      summary.funding.source = 'BYBIT';
    } else if (env.BASE_FUNDING_PRIVATE_KEY) {
      const result = await this.walletHub.fundHubFromExternal(
        env.BASE_FUNDING_PRIVATE_KEY,
        withdrawAmountWei,
        gasPrice,
      );
      summary.funding.source = 'BASE';
      if (!result.success) {
        logger.warn('Funding hub from base wallet failed; continuing with existing hub balance');
      }
    } else {
      logger.warn('No Bybit credentials or base funding key provided; skipping external funding');
      summary.funding.source = 'NONE';
    }
    const hubBalance = await this.walletHub.getHubBalance();
    const plan = this.walletHub.createDistributionPlan(hubBalance, gasPrice);
    summary.distribution.fundedWallets = plan.filter((item) => item.amountWei > 0n).length;
    summary.distribution.totalWei = plan.reduce((total, item) => total + item.amountWei, 0n);
    const distributionResult = await this.walletHub.executeDistribution(plan, gasPrice);
    summary.funding.confirmedWei = distributionResult.success ? summary.distribution.totalWei : 0n;
    if (!distributionResult.success) {
      summary.distribution.fundedWallets = 0;
      summary.distribution.totalWei = 0n;
    }

    let bridgeExecuted = false;
    let bridgedAmountWei = 0n;
    const strategyEntry = plan.find((item) => item.recipient.address === this.strategyWallet.address);
    const strategyAllocation = distributionResult.success ? strategyEntry?.amountWei ?? 0n : 0n;
    const fallbackBridgeReserve = gasPrice * BRIDGE_GAS_LIMIT_FALLBACK;
    if (strategyAllocation > fallbackBridgeReserve) {
      const desiredBridgeAmount = strategyAllocation - fallbackBridgeReserve;
      if (desiredBridgeAmount > 0n) {
        try {
          let quote: BridgeQuote | null = await this.bridge.fetchQuote(desiredBridgeAmount);
          if (quote) {
            let gasEstimate = quote.gasEstimate > 0n ? quote.gasEstimate : BRIDGE_GAS_LIMIT_FALLBACK;
            let requiredReserve = gasPrice * gasEstimate;
            if (strategyAllocation <= requiredReserve) {
              logger.warn(
                {
                  allocationEth: fromWei(strategyAllocation),
                  requiredGasEth: fromWei(requiredReserve),
                },
                'Strategy allocation insufficient to cover bridge gas requirements',
              );
              quote = null;
            } else {
              const maxSendable = strategyAllocation - requiredReserve;
              if (quote.amountWei > maxSendable) {
                const adjustedAmount = maxSendable;
                if (adjustedAmount <= 0n) {
                  logger.warn(
                    {
                      allocationEth: fromWei(strategyAllocation),
                      requiredGasEth: fromWei(requiredReserve),
                    },
                    'Bridge amount after gas reserve is non-positive; skipping bridge',
                  );
                  quote = null;
                } else if (adjustedAmount !== quote.amountWei) {
                  try {
                    quote = await this.bridge.fetchQuote(adjustedAmount);
                    gasEstimate = quote.gasEstimate > 0n ? quote.gasEstimate : BRIDGE_GAS_LIMIT_FALLBACK;
                    requiredReserve = gasPrice * gasEstimate;
                    if (
                      strategyAllocation <= requiredReserve ||
                      quote.amountWei > strategyAllocation - requiredReserve
                    ) {
                      logger.warn(
                        {
                          allocationEth: fromWei(strategyAllocation),
                          requiredGasEth: fromWei(requiredReserve),
                        },
                        'Adjusted bridge quote still exceeds available balance after gas reserve',
                      );
                      quote = null;
                    }
                  } catch (error) {
                    logger.error({ err: error }, 'Failed to obtain adjusted bridge quote');
                    quote = null;
                  }
                }
              }
            }
          }
          if (quote) {
            const result = await this.bridge.executeBridge(quote);
            bridgeExecuted = result.success;
            if (result.success) {
              bridgedAmountWei = quote.amountWei;
            }
          }
        } catch (error) {
          logger.error({ err: error }, 'Failed to obtain bridge quote');
        }
      }
    } else if (strategyAllocation > 0n) {
      logger.warn(
        {
          allocationEth: fromWei(strategyAllocation),
          requiredGasEth: fromWei(fallbackBridgeReserve),
        },
        'Strategy allocation insufficient to cover bridge amount after reserving gas',
      );
    }
    summary.bridge.executed = bridgeExecuted;
    summary.bridge.amountWei = bridgedAmountWei;
    if (!bridgeExecuted && strategyAllocation === 0n) {
      logger.warn('Strategy wallet received no new funds; proceeding with existing balances');
    }

    const balancesBeforeSwap = await this.swap.getTokenBalances();
    let swapExecuted = false;
    if (balancesBeforeSwap.ethWei > 0n) {
      const halfEth = balancesBeforeSwap.ethWei / 2n;
      if (halfEth > 0n) {
        await this.swap.ensureWethBalance(halfEth, balancesBeforeSwap.nativeEthWei);
        try {
          const quote = await this.swap.fetchQuote(TOKENS.eth.address, TOKENS.pengu.address, halfEth);
          const swapResult = await this.swap.executeSwap(quote);
          swapExecuted = swapResult.success;
        } catch (error) {
          logger.error({ err: error }, 'Failed to obtain swap quote');
        }
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

    summary.swap.executed = swapExecuted;
    summary.swap.finalEthWei = balances.wethWei + balances.nativeEthWei;
    summary.swap.finalPenguWei = balances.penguWei;

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

    summary.liquidity.active = activePosition.lpTokenAmount > 0n;
    summary.liquidity.depositedEthWei = activePosition.depositedEth;
    summary.liquidity.depositedPenguWei = activePosition.depositedPengu;
    summary.liquidity.rebalanceReason = rebalance.reason;
    if (feesCollected) {
      summary.liquidity.feesEthWei = feesCollected.fees.accruedEth;
      summary.liquidity.feesPenguWei = feesCollected.fees.accruedPengu;
    }

    const report = {
      timestamp: Date.now(),
      bridgeExecuted,
      swapExecuted,
      lpPosition: activePosition,
      feesCollected,
      rebalance,
    } satisfies StrategyReport;

    this.latestSummary = summary;
    return report;
  }

  getLatestSummary() {
    if (!this.latestSummary) return null;
    const summary = this.latestSummary;
    return {
      funding: {
        source: summary.funding.source,
        requestedEth: fromWei(summary.funding.requestedWei),
        confirmedEth: fromWei(summary.funding.confirmedWei),
      },
      distribution: {
        fundedWallets: summary.distribution.fundedWallets,
        totalEth: fromWei(summary.distribution.totalWei),
      },
      bridge: {
        executed: summary.bridge.executed,
        amountEth: fromWei(summary.bridge.amountWei),
      },
      swap: {
        executed: summary.swap.executed,
        finalEth: fromWei(summary.swap.finalEthWei),
        finalPengu: fromWei(summary.swap.finalPenguWei),
      },
      liquidity: {
        active: summary.liquidity.active,
        depositedEth: fromWei(summary.liquidity.depositedEthWei),
        depositedPengu: fromWei(summary.liquidity.depositedPenguWei),
        rebalanceReason: summary.liquidity.rebalanceReason,
        harvestedEth: fromWei(summary.liquidity.feesEthWei),
        harvestedPengu: fromWei(summary.liquidity.feesPenguWei),
      },
    } satisfies Record<string, unknown>;
  }

  async executeCycleDryRun(): Promise<void> {
    const withdrawAmountWei = toWei(env.HUB_WITHDRAW_AMOUNT);
    const gasPrice = weiFromGwei(env.GAS_PRICE_GWEI);

    logger.info('Starting DRY RUN strategy cycle (no real transactions)');

    // Simulate funding
    const fundingSource = this.bybit.isConfigured() ? 'BYBIT' : 
                         env.BASE_FUNDING_PRIVATE_KEY ? 'BASE' : 'NONE';
    
    logger.info(`[DRY RUN] Funding source: ${fundingSource}`);
    logger.info(`[DRY RUN] Requested amount: ${fromWei(withdrawAmountWei)} ETH`);

    // Simulate distribution (without creating real wallets)
    const hubBalance = withdrawAmountWei; // Simulate full funding
    const satelliteCount = 99;
    const avgPerWallet = hubBalance / BigInt(satelliteCount);
    const fundedWallets = satelliteCount;
    const totalDistributed = hubBalance;

    logger.info(`[DRY RUN] Distribution: ${fundedWallets} wallets, ${fromWei(totalDistributed)} ETH total`);
    logger.info(`[DRY RUN] Average per wallet: ${fromWei(avgPerWallet)} ETH`);

    // Simulate bridge
    const strategyAllocation = avgPerWallet; // First satellite gets average amount
    if (strategyAllocation > 0n) {
      logger.info(`[DRY RUN] Bridge: ${fromWei(strategyAllocation)} ETH Base → Abstract`);
    } else {
      logger.warn('[DRY RUN] No funds allocated to strategy wallet');
    }

    // Simulate swap
    if (strategyAllocation > 0n) {
      const halfEth = strategyAllocation / 2n;
      logger.info(`[DRY RUN] Swap: ${fromWei(halfEth)} ETH → PENGU`);
      logger.info(`[DRY RUN] Final balances: ${fromWei(halfEth)} ETH + ${fromWei(halfEth)} PENGU`);
    }

    // Simulate LP
    if (strategyAllocation > 0n) {
      const halfEth = strategyAllocation / 2n;
      const utilization = scaleByPercent(halfEth, STRATEGY_CONSTANTS.liquidityUtilizationPercent);
      logger.info(`[DRY RUN] LP Position: ${fromWei(utilization)} ETH + ${fromWei(utilization)} PENGU`);
      logger.info(`[DRY RUN] Pool: PENGU/WETH on Uniswap V2`);
    }

    // Simulate fee collection
    logger.info('[DRY RUN] Fee collection: Triggered when fees > 3× gas cost');
    logger.info('[DRY RUN] Fee recycling: 30% PENGU → ETH, 60% reinvested');

    logger.info('[DRY RUN] Cycle simulation completed successfully!');
  }
}
