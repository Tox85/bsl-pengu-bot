import { BybitClient } from './bybitClient.js';
import { WalletHub } from './walletHub.js';
import { BridgeService } from './bridgeService.js';
import { SwapService } from './swapService.js';
import { LPManager } from './lpManager.js';
import { FeeManager } from './feeManager.js';
import { ensureWalletState } from './walletStore.js';
import { env, STRATEGY_CONSTANTS, TOKENS } from './config.js';
import type { LiquidityPosition, StrategyReport, RebalanceReason } from './types.js';
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
    const gasPrice = weiFromGwei(env.GAS_PRICE_GWEI);

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
      await this.walletHub.fundHubFromExternal(env.BASE_FUNDING_PRIVATE_KEY, withdrawAmountWei, gasPrice);
      summary.funding.source = 'BASE';
    } else {
      logger.warn('No Bybit credentials or base funding key provided; skipping external funding');
      summary.funding.source = 'NONE';
    }
    const hubBalance = await this.walletHub.getHubBalance();
    const plan = this.walletHub.createDistributionPlan(hubBalance);
    summary.distribution.fundedWallets = plan.filter((item) => item.amountWei > 0n).length;
    summary.distribution.totalWei = plan.reduce((total, item) => total + item.amountWei, 0n);
    summary.funding.confirmedWei = summary.distribution.totalWei;
    await this.walletHub.executeDistribution(plan, gasPrice);

    let bridgeExecuted = false;
    let bridgeAmountWei = 0n;
    
    // Vérifier d'abord les fonds existants sur Abstract
    const existingBalances = await this.swap.getTokenBalances();
    if (existingBalances.ethWei > 0n) {
      logger.info({ 
        existingEth: fromWei(existingBalances.ethWei),
        message: 'Fonds existants détectés sur Abstract, bridge non nécessaire'
      });
      bridgeExecuted = true; // Considérer comme "réussi" car on a déjà des fonds
      bridgeAmountWei = existingBalances.ethWei;
    } else {
      // Essayer de bridger les nouveaux fonds
      const strategyAllocation = plan[0]?.amountWei ?? 0n;
      const minBridgeAmount = toWei(0.0001); // Minimum 0.0001 ETH pour LiFi (réduit)
      
      if (strategyAllocation >= minBridgeAmount) {
        try {
          const quote = await this.bridge.fetchQuote(strategyAllocation);
          const result = await this.bridge.executeBridge(quote);
          
          if (result.success && result.txHash) {
            // Attendre que le bridge soit reçu sur Abstract
            try {
              await this.bridge.waitUntilReceived(result.txHash, 600_000); // 10 minutes
              bridgeExecuted = true;
              bridgeAmountWei = strategyAllocation;
              logger.info({ 
                amount: fromWei(strategyAllocation),
                txHash: result.txHash,
                message: 'Bridge exécuté et reçu avec succès'
              });
            } catch (error) {
              logger.error({ 
                err: error,
                txHash: result.txHash,
                message: 'Bridge soumis mais pas reçu dans les temps'
              });
              bridgeExecuted = false;
              bridgeAmountWei = 0n;
            }
          } else {
            logger.warn({ 
              error: result.error?.message,
              message: 'Bridge échoué, continuer avec les fonds existants'
            });
            bridgeExecuted = false;
            bridgeAmountWei = 0n;
          }
        } catch (error) {
          logger.error({ 
            err: error,
            message: 'Erreur lors du bridge, continuer sans bridge'
          });
          bridgeExecuted = false;
          bridgeAmountWei = 0n;
        }
      } else {
        // Si on a des fonds mais pas assez pour le bridge normal, essayer quand même
        if (strategyAllocation > 0n) {
          logger.warn({ 
            allocation: fromWei(strategyAllocation),
            minimum: fromWei(minBridgeAmount),
            message: 'Montant faible mais tentative de bridge quand même'
          });
          
          try {
            const quote = await this.bridge.fetchQuote(strategyAllocation);
            const result = await this.bridge.executeBridge(quote);
            bridgeExecuted = result.success;
            bridgeAmountWei = result.success ? strategyAllocation : 0n;
            
            if (result.success) {
              logger.info({ 
                amount: fromWei(strategyAllocation),
                message: 'Bridge réussi avec montant faible'
              });
            } else {
              logger.warn({ 
                error: result.error?.message,
                message: 'Bridge échoué avec montant faible'
              });
            }
          } catch (error) {
            logger.warn({ 
              err: error,
              message: 'Bridge échoué, continuer sans bridge'
            });
            bridgeExecuted = false;
            bridgeAmountWei = 0n;
          }
        } else {
          logger.warn({ 
            allocation: fromWei(strategyAllocation),
            minimum: fromWei(minBridgeAmount),
            message: 'Aucun fonds à bridger'
          });
          bridgeExecuted = false;
          bridgeAmountWei = 0n;
        }
      }
    }
    
    summary.bridge.executed = bridgeExecuted;
    summary.bridge.amountWei = bridgeAmountWei;

    const balancesBeforeSwap = await this.swap.getTokenBalances();
    let swapExecuted = false;
    
    // Calculer le montant minimum pour un swap viable (inclut les frais de gas)
    const minSwapAmount = gasPrice * 100000n; // Réserve réduite pour les frais de gas futurs
    
    if (balancesBeforeSwap.ethWei > 0n) {
      const halfEth = balancesBeforeSwap.ethWei / 2n;
      // Essayer le swap même avec des montants faibles
      if (halfEth > 0n) {
        try {
          await this.swap.ensureWethBalance(halfEth, balancesBeforeSwap.nativeEthWei);
          const quote = await this.swap.fetchQuote(TOKENS.eth.address, TOKENS.pengu.address, halfEth);
          const swapResult = await this.swap.executeSwap(quote);
          swapExecuted = swapResult.success;
          
          if (swapResult.success) {
            logger.info({ 
              amount: fromWei(halfEth),
              message: 'Swap ETH vers PENGU exécuté avec succès'
            });
          } else {
            logger.warn({ 
              error: swapResult.error?.message,
              message: 'Swap échoué, continuer sans swap'
            });
          }
        } catch (error) {
          logger.error({ 
            err: error,
            message: 'Erreur lors du swap, continuer sans swap'
          });
          swapExecuted = false;
        }
      } else {
        logger.warn({ 
          available: fromWei(balancesBeforeSwap.ethWei),
          message: 'Montant insuffisant pour un swap'
        });
      }
    } else {
      logger.warn({ 
        available: fromWei(balancesBeforeSwap.ethWei),
        message: 'Aucun fonds ETH disponible pour le swap'
      });
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
      
      // Vérifier que nous avons suffisamment de fonds pour créer une position LP
      const minLpAmount = gasPrice * 200000n; // Minimum réduit pour une position LP viable
      
      if (instruction.targetEthWei > 0n && instruction.targetPenguWei > 0n) {
        try {
          this.position = await this.lpManager.createPosition(instruction, gasPrice);
          logger.info({ 
            ethAmount: fromWei(instruction.targetEthWei),
            penguAmount: fromWei(instruction.targetPenguWei),
            message: 'Position LP créée avec succès'
          });
        } catch (error) {
          logger.error({ 
            err: error,
            message: 'Erreur lors de la création de la position LP'
          });
          this.position = null;
        }
      } else {
        logger.warn({ 
          ethAmount: fromWei(instruction.targetEthWei),
          penguAmount: fromWei(instruction.targetPenguWei),
          message: 'Fonds insuffisants pour créer une position LP (besoin de ETH et PENGU)'
        });
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
    
    // Logique de continuation : si on n'a pas de position LP mais qu'on a des fonds, 
    // essayer de créer une position plus tard ou attendre plus de fonds
    if (!this.position && (availableWeth > 0n || availablePengu > 0n)) {
      logger.info({ 
        wethBalance: fromWei(availableWeth),
        penguBalance: fromWei(availablePengu),
        message: 'Fonds disponibles mais position LP non créée, sera retenté au prochain cycle'
      });
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
}
