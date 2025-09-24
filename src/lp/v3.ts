import { ethers, Interface, Log, ContractTransactionReceipt, type Signer } from 'ethers';
import { CONSTANTS, cfg } from '../config/env.js';
import { logger, logError } from '../core/logger.js';
import { withRetryRpc, withRetryTransaction } from '../core/retry.js';
import { createSigner, getProvider, getGasPrice } from '../core/rpc.js';
import { 
  calculateTickRange, 
  calculateMinAmountOut, 
  calculateMaxAmountIn,
  Q96,
  Q128 
} from '../core/math.js';
import { NONFUNGIBLE_POSITION_MANAGER_ABI, ERC20_MIN_ABI, UNIV3_FACTORY_ABI, UNIV3_POOL_ABI } from '../abis/index.js';
import { MAX_UINT128 } from '../config/nums.js';
import { CollectResult, CollectStatus } from '../core/collect-status.js';
import { swapService } from '../dex/index.js';
import { tokenService } from '../services/token.js';
import type { 
  PositionInfo, 
  CreatePositionParams, 
  IncreaseLiquidityParams,
  DecreaseLiquidityParams,
  CollectFeesParams,
  PositionResult,
  RangeParams,
  AmountParams,
  CalculationResult,
  FeeSnapshot,
  FeeValueEstimation,
  HarvestBreakdown
} from './types.js';

// Helpers pour parsing des events
const npmIface = new Interface(NONFUNGIBLE_POSITION_MANAGER_ABI);
const COLLECT_TOPIC = npmIface.getEvent("Collect").topicHash;

function parseCollectFromReceipt(
  receipt: ContractTransactionReceipt,
  npmAddress: string
) {
  const addr = npmAddress.toLowerCase();
  for (const log of receipt.logs as Log[]) {
    if (log.address.toLowerCase() !== addr) continue;
    if (log.topics?.[0] !== COLLECT_TOPIC) continue;
    // ethers v6: decodeEventLog(eventName, data, topics)
    const decoded = npmIface.decodeEventLog("Collect", log.data, log.topics);
    // Event Collect(uint256 tokenId, address recipient, uint256 amount0, uint256 amount1)
    const tokenId = BigInt(decoded.tokenId);
    const recipient = decoded.recipient as string;
    const amount0 = BigInt(decoded.amount0);
    const amount1 = BigInt(decoded.amount1);
    return { tokenId, recipient, amount0, amount1 };
  }
  return null;
}

// Service de gestion des positions LP Uniswap v3
export class LiquidityPositionService {
  private readonly provider: ethers.Provider;
  private readonly positionManager: ethers.Contract;

  constructor() {
    this.provider = getProvider(CONSTANTS.CHAIN_IDS.ABSTRACT);
    this.positionManager = new ethers.Contract(
      CONSTANTS.UNIV3.NF_POSITION_MANAGER,
      NONFUNGIBLE_POSITION_MANAGER_ABI,
      this.provider
    );
  }

  private getPositionManager(signer?: Signer): ethers.Contract {
    return signer ? this.positionManager.connect(signer) : this.positionManager;
  }

  // Créer une nouvelle position LP
  async createPosition(
    params: CreatePositionParams,
    privateKey: string,
    options: { dryRun?: boolean } = {}
  ): Promise<PositionResult> {
    const { dryRun = false } = options;

    logger.info({
      dryRun,
      message: 'DEBUG: LiquidityPositionService - dryRun reçu'
    });

    try {
      if (dryRun) {
        logger.info({
          token0: params.token0,
          token1: params.token1,
          fee: params.fee,
          tickLower: params.tickLower,
          tickUpper: params.tickUpper,
          amount0Desired: params.amount0Desired.toString(),
          amount1Desired: params.amount1Desired.toString(),
          message: 'DRY_RUN: Position LP simulée'
        });

        return {
          success: true,
        };
      }

      // Créer le signer
      const signer = await createSigner(privateKey, CONSTANTS.CHAIN_IDS.ABSTRACT);
      const recipient = await signer.getAddress();

      // Le positionManager partagé est initialisé dans le constructeur

      // CORRECTION 1: Déterminer l'ordre correct des tokens depuis le pool
      const poolInfo = await this.getPoolInfo(params.token0, params.token1, params.fee);
      const { token0: poolToken0, token1: poolToken1 } = poolInfo;
      
      logger.info({
        poolToken0,
        poolToken1,
        inputToken0: params.token0,
        inputToken1: params.token1,
        message: 'Ordre des tokens du pool'
      });

      // CORRECTION 2: Obtenir les décimales des tokens
      const decimals0 = await this.getTokenDecimals(poolToken0);
      const decimals1 = await this.getTokenDecimals(poolToken1);
      
      logger.info({
        token0: poolToken0,
        token1: poolToken1,
        decimals0,
        decimals1,
        message: 'Décimales des tokens'
      });

      // CORRECTION 3: Adapter les montants selon l'ordre du pool
      let amount0Desired, amount1Desired, amount0Min, amount1Min;
      
      if (poolToken0.toLowerCase() === params.token0.toLowerCase()) {
        // Ordre correct : token0 = params.token0, token1 = params.token1
        amount0Desired = params.amount0Desired;
        amount1Desired = params.amount1Desired;
        amount0Min = params.amount0Min;
        amount1Min = params.amount1Min;
      } else {
        // Ordre inversé : échanger les montants
        amount0Desired = params.amount1Desired;
        amount1Desired = params.amount0Desired;
        amount0Min = params.amount1Min;
        amount1Min = params.amount0Min;
      }

      // CORRECTION 4: Vérifier les balances et ajuster si nécessaire
      const balance0 = await this.getTokenBalance(poolToken0, recipient, signer);
      const balance1 = await this.getTokenBalance(poolToken1, recipient, signer);
      
      if (balance0 < amount0Desired) {
        logger.warn({
          token: poolToken0,
          balance: balance0.toString(),
          requested: amount0Desired.toString(),
          message: 'Balance insuffisante pour token0, ajustement automatique'
        });
        amount0Desired = balance0;
        amount0Min = 0n;
      }
      
      if (balance1 < amount1Desired) {
        logger.warn({
          token: poolToken1,
          balance: balance1.toString(),
          requested: amount1Desired.toString(),
          message: 'Balance insuffisante pour token1, ajustement automatique'
        });
        amount1Desired = balance1;
        amount1Min = 0n;
      }

      logger.info({
        token0: poolToken0,
        token1: poolToken1,
        amount0Desired: amount0Desired.toString(),
        amount1Desired: amount1Desired.toString(),
        amount0Min: amount0Min.toString(),
        amount1Min: amount1Min.toString(),
        message: 'Montants ajustés selon l\'ordre du pool'
      });

      // S'assurer que les tokens sont approuvés
      await this.ensureTokenApproval(poolToken0, CONSTANTS.UNIV3.NF_POSITION_MANAGER, amount0Desired, signer);
      await this.ensureTokenApproval(poolToken1, CONSTANTS.UNIV3.NF_POSITION_MANAGER, amount1Desired, signer);

      // Préparer les paramètres de mint avec l'ordre correct
      const mintParams = {
        token0: poolToken0,
        token1: poolToken1,
        fee: params.fee,
        tickLower: params.tickLower,
        tickUpper: params.tickUpper,
        amount0Desired,
        amount1Desired,
        amount0Min,
        amount1Min,
        recipient,
        deadline: params.deadline,
      };

      const pm = this.getPositionManager(signer);

      await pm.mint.staticCall(mintParams, { from: recipient, value: 0n });

      const gasLimit = await pm.mint.estimateGas(mintParams, { from: recipient, value: 0n });
      const gasPrice = await getGasPrice(signer.provider! as any);

      // Exécuter la création de position
      const tx = await withRetryTransaction(async () => {
        return await pm.mint(mintParams, {
          from: recipient,
          value: 0n,
          gasLimit,
          gasPrice,
        });
      });

      logger.info({
        txHash: tx.hash,
        message: 'Transaction de création de position envoyée'
      });

      // Attendre la confirmation
      const receipt = await tx.wait();

      if (!receipt) {
        throw new Error('Transaction de création de position échouée');
      }

      // Extraire le tokenId et les montants du receipt
      const tokenId = this.extractTokenIdFromReceipt(receipt);
      const { amount0, amount1, liquidity } = this.extractAmountsFromReceipt(receipt);

      logger.info({
        tokenId: tokenId.toString(),
        amount0: amount0.toString(),
        amount1: amount1.toString(),
        liquidity: liquidity.toString(),
        txHash: receipt.hash,
        message: 'Position LP créée avec succès'
      });

      return {
        tokenId,
        amount0,
        amount1,
        liquidity,
        txHash: receipt.hash,
        success: true,
        gasUsed: receipt.gasUsed.toString(),
      };

    } catch (error) {
      logError(error, { 
        token0: params.token0,
        token1: params.token1,
        fee: params.fee,
      });
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // Augmenter la liquidité d'une position
  async increaseLiquidity(
    params: IncreaseLiquidityParams,
    privateKey: string,
    options: { dryRun?: boolean } = {}
  ): Promise<PositionResult> {
    const { dryRun = false } = options;

    try {
      logger.info({
        tokenId: params.tokenId.toString(),
        amount0Desired: params.amount0Desired.toString(),
        amount1Desired: params.amount1Desired.toString(),
        message: 'Augmentation de liquidité'
      });

      if (dryRun) {
        logger.info({
          tokenId: params.tokenId.toString(),
          amount0Desired: params.amount0Desired.toString(),
          amount1Desired: params.amount1Desired.toString(),
          message: 'DRY_RUN: Augmentation de liquidité simulée'
        });

        return {
          success: true,
        };
      }

      // Créer le signer
      const signer = await createSigner(privateKey, CONSTANTS.CHAIN_IDS.ABSTRACT);

      // Obtenir les informations de la position
      const position = await this.getPosition(params.tokenId);
      
      // S'assurer que les tokens sont approuvés
      await this.ensureTokenApproval(position.token0, CONSTANTS.UNIV3.NF_POSITION_MANAGER, params.amount0Desired, signer);
      await this.ensureTokenApproval(position.token1, CONSTANTS.UNIV3.NF_POSITION_MANAGER, params.amount1Desired, signer);

      // Préparer les paramètres d'augmentation
      const increaseParams = {
        tokenId: params.tokenId,
        amount0Desired: params.amount0Desired,
        amount1Desired: params.amount1Desired,
        amount0Min: params.amount0Min,
        amount1Min: params.amount1Min,
        deadline: params.deadline,
      };

      // Estimer le gas
      const pm = this.getPositionManager(signer);
      const gasLimit = await pm.increaseLiquidity.estimateGas(increaseParams, { value: 0n });

      // Obtenir le gas price
      const gasPrice = await getGasPrice(signer.provider! as any);

      // Exécuter l'augmentation de liquidité
      const tx = await withRetryTransaction(async () => {
        return await pm.increaseLiquidity(increaseParams, {
          value: 0n,
          gasLimit,
          gasPrice,
        });
      });

      logger.info({
        txHash: tx.hash,
        message: 'Transaction d\'augmentation de liquidité envoyée'
      });

      // Attendre la confirmation
      const receipt = await tx.wait();

      if (!receipt) {
        throw new Error('Transaction d\'augmentation de liquidité échouée');
      }

      // Extraire les montants du receipt
      const { amount0, amount1, liquidity } = this.extractAmountsFromReceipt(receipt);

      logger.info({
        tokenId: params.tokenId.toString(),
        amount0: amount0.toString(),
        amount1: amount1.toString(),
        liquidity: liquidity.toString(),
        txHash: receipt.hash,
        message: 'Liquidité augmentée avec succès'
      });

      return {
        amount0,
        amount1,
        liquidity,
        txHash: receipt.hash,
        success: true,
      };

    } catch (error) {
      logError(error, { tokenId: params.tokenId.toString() });
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // Diminuer la liquidité d'une position
  async decreaseLiquidity(
    params: DecreaseLiquidityParams,
    privateKey: string,
    options: { dryRun?: boolean } = {}
  ): Promise<PositionResult> {
    const { dryRun = false } = options;

    try {
      logger.info({
        tokenId: params.tokenId.toString(),
        liquidity: params.liquidity.toString(),
        message: 'Diminution de liquidité'
      });

      if (dryRun) {
        logger.info({
          tokenId: params.tokenId.toString(),
          liquidity: params.liquidity.toString(),
          message: 'DRY_RUN: Diminution de liquidité simulée'
        });

        return {
          success: true,
        };
      }

      // Créer le signer
      const signer = await createSigner(privateKey, CONSTANTS.CHAIN_IDS.ABSTRACT);

      // Préparer les paramètres de diminution
      const decreaseParams = {
        tokenId: params.tokenId,
        liquidity: params.liquidity,
        amount0Min: params.amount0Min,
        amount1Min: params.amount1Min,
        deadline: params.deadline,
      };

      // Estimer le gas
      const pm = this.getPositionManager(signer);
      const gasLimit = await pm.decreaseLiquidity.estimateGas(decreaseParams, { value: 0n });

      // Obtenir le gas price
      const gasPrice = await getGasPrice(signer.provider! as any);

      // Exécuter la diminution de liquidité
      const tx = await withRetryTransaction(async () => {
        return await pm.decreaseLiquidity(decreaseParams, {
          value: 0n,
          gasLimit,
          gasPrice,
        });
      });

      logger.info({
        txHash: tx.hash,
        message: 'Transaction de diminution de liquidité envoyée'
      });

      // Attendre la confirmation
      const receipt = await tx.wait();

      if (!receipt) {
        throw new Error('Transaction de diminution de liquidité échouée');
      }

      // Extraire les montants du receipt
      const { amount0, amount1 } = this.extractAmountsFromReceipt(receipt);

      logger.info({
        tokenId: params.tokenId.toString(),
        amount0: amount0.toString(),
        amount1: amount1.toString(),
        txHash: receipt.hash,
        message: 'Liquidité diminuée avec succès'
      });

      return {
        amount0,
        amount1,
        txHash: receipt.hash,
        success: true,
      };

    } catch (error) {
      logError(error, { tokenId: params.tokenId.toString() });
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async getCollectableFees(tokenId: bigint): Promise<FeeSnapshot> {
    const position = await this.getPosition(tokenId);

    return {
      tokenId,
      token0: position.token0,
      token1: position.token1,
      fee: position.fee,
      tokensOwed0: position.tokensOwed0,
      tokensOwed1: position.tokensOwed1,
    };
  }

  private async estimateTokenValueInWeth(
    tokenAddress: string,
    amount: bigint,
    fee: number
  ): Promise<{ valueWei: bigint }> {
    if (amount === 0n) {
      return { valueWei: 0n };
    }

    const lower = tokenAddress.toLowerCase();

    if (lower === CONSTANTS.TOKENS.WETH.toLowerCase() || lower === CONSTANTS.NATIVE_ADDRESS) {
      return { valueWei: amount };
    }

    try {
      const quote = await swapService.getQuote({
        tokenIn: tokenAddress,
        tokenOut: CONSTANTS.TOKENS.WETH,
        amountIn: amount,
        fee,
      });

      return { valueWei: quote.amountOut };
    } catch (error) {
      logError(error, {
        token: tokenAddress,
        amount: amount.toString(),
        context: 'estimateTokenValueInWeth'
      });

      return { valueWei: 0n };
    }
  }

  private async estimateFeeValue(snapshot: FeeSnapshot): Promise<FeeValueEstimation> {
    const token0Value = await this.estimateTokenValueInWeth(snapshot.token0, snapshot.tokensOwed0, snapshot.fee);
    const token1Value = await this.estimateTokenValueInWeth(snapshot.token1, snapshot.tokensOwed1, snapshot.fee);

    const totalValueWei = token0Value.valueWei + token1Value.valueWei;

    return {
      token0ValueWei: token0Value.valueWei,
      token1ValueWei: token1Value.valueWei,
      totalValueWei,
    };
  }

  private computeHarvestBreakdown(
    snapshot: FeeSnapshot,
    values: FeeValueEstimation
  ): HarvestBreakdown {
    if (values.totalValueWei === 0n) {
      return {
        reinvest0: 0n,
        reinvest1: 0n,
        cashout0: 0n,
        cashout1: 0n,
        cashedOutEth: 0n,
      };
    }

    const reinvestPercent = BigInt(cfg.FEE_REINVEST_PERCENT);
    const reinvestValue = (values.totalValueWei * reinvestPercent) / 100n;

    const reinvest0Value = values.token0ValueWei === 0n
      ? 0n
      : (reinvestValue * values.token0ValueWei) / values.totalValueWei;
    const reinvest1Value = values.token1ValueWei === 0n
      ? 0n
      : (reinvestValue * values.token1ValueWei) / values.totalValueWei;

    const reinvest0 = values.token0ValueWei === 0n
      ? 0n
      : snapshot.tokensOwed0 * reinvest0Value / values.token0ValueWei;
    const reinvest1 = values.token1ValueWei === 0n
      ? 0n
      : snapshot.tokensOwed1 * reinvest1Value / values.token1ValueWei;

    const cashout0 = snapshot.tokensOwed0 - reinvest0;
    const cashout1 = snapshot.tokensOwed1 - reinvest1;

    return {
      reinvest0,
      reinvest1,
      cashout0,
      cashout1,
      cashedOutEth: 0n,
    };
  }

  private async convertToWeth(
    tokenAddress: string,
    amount: bigint,
    fee: number,
    privateKey: string,
    recipient: string
  ): Promise<{ wethAmount: bigint; swapTxHash?: string }> {
    if (amount === 0n) {
      return { wethAmount: 0n };
    }

    const lower = tokenAddress.toLowerCase();

    if (lower === CONSTANTS.TOKENS.WETH.toLowerCase()) {
      return { wethAmount: amount };
    }

    if (lower === CONSTANTS.NATIVE_ADDRESS) {
      return { wethAmount: amount };
    }

    const swapResult = await swapService.executeSwap({
      tokenIn: tokenAddress,
      tokenOut: CONSTANTS.TOKENS.WETH,
      amountIn: amount,
      slippageBps: cfg.SWAP_SLIPPAGE_BPS,
      recipient,
      fee,
    }, privateKey, { dryRun: false });

    if (!swapResult.success) {
      logger.warn({
        tokenIn: tokenAddress,
        amount: amount.toString(),
        message: 'Swap pour conversion WETH échoué'
      });
      return { wethAmount: 0n };
    }

    return {
      wethAmount: swapResult.amountOut,
      swapTxHash: swapResult.txHash,
    };
  }

  // Collecter les frais d'une position (version corrigée ethers v6)
  async collectFees(
    params: CollectFeesParams,
    privateKey: string,
    options: { dryRun?: boolean } = {}
  ): Promise<CollectResult> {
    const { dryRun = false } = options;

    if (dryRun) {
      logger.info({
        tokenId: params.tokenId.toString(),
        message: 'Collecte ignorée (dry-run)'
      });

      return {
        executed: false,
        expected0: 0n,
        expected1: 0n,
        amount0: 0n,
        amount1: 0n,
        txHash: null,
        gasUsed: undefined,
        status: 'collect_skipped',
        skippedReason: 'dry_run'
      };
    }

    try {
      const signer = await createSigner(privateKey, CONSTANTS.CHAIN_IDS.ABSTRACT);
      const recipient = params.recipient || await signer.getAddress();
      const pm = this.getPositionManager(signer);
      const tokenId = params.tokenId;

      const snapshot = await this.getCollectableFees(tokenId);

      if (snapshot.tokensOwed0 === 0n && snapshot.tokensOwed1 === 0n) {
        logger.info({
          tokenId: tokenId.toString(),
          message: 'Aucun frais collectable, étape ignorée'
        });

        return {
          executed: false,
          expected0: 0n,
          expected1: 0n,
          amount0: 0n,
          amount1: 0n,
          txHash: null,
          gasUsed: undefined,
          status: 'collect_skipped',
          skippedReason: 'no_fees'
        };
      }

      const collectParams = {
        tokenId,
        recipient,
        amount0Max: params.amount0Max ?? MAX_UINT128,
        amount1Max: params.amount1Max ?? MAX_UINT128,
      };

      logger.info({
        tokenId: tokenId.toString(),
        recipient,
        message: 'Collecte des frais démarrée'
      });

      const valueEstimate = await this.estimateFeeValue(snapshot);

      const gasEstimate = await pm.collect.estimateGas(collectParams);
      const gasPrice = await getGasPrice(signer.provider! as any);
      const gasCostWei = gasEstimate * gasPrice;

      const minMultiple = BigInt(cfg.FEE_GAS_MULTIPLE_TRIGGER);
      if (valueEstimate.totalValueWei < gasCostWei * minMultiple) {
        logger.info({
          tokenId: tokenId.toString(),
          estimatedFeesEth: ethers.formatEther(valueEstimate.totalValueWei),
          gasCostEth: ethers.formatEther(gasCostWei),
          minMultiple: cfg.FEE_GAS_MULTIPLE_TRIGGER,
          message: 'Collecte ignorée car les frais ne couvrent pas le gas'
        });

        return {
          executed: false,
          expected0: snapshot.tokensOwed0,
          expected1: snapshot.tokensOwed1,
          amount0: 0n,
          amount1: 0n,
          txHash: null,
          gasUsed: undefined,
          status: 'collect_skipped',
          skippedReason: 'fees_below_threshold'
        };
      }

      let expected0 = snapshot.tokensOwed0;
      let expected1 = snapshot.tokensOwed1;

      try {
        const simulation = await pm.collect.staticCall(collectParams);
        const a0 = (simulation?.[0] ?? (simulation as any)?.amount0 ?? 0n);
        const a1 = (simulation?.[1] ?? (simulation as any)?.amount1 ?? 0n);
        expected0 = BigInt(a0);
        expected1 = BigInt(a1);
      } catch (error) {
        logger.debug({
          tokenId: tokenId.toString(),
          message: 'Static call collect indisponible, fallback sur balances locales'
        });
      }

      const gasLimit = gasEstimate + gasEstimate / 5n;
      const tx = await withRetryTransaction(async () => {
        return await pm.collect(collectParams, {
          gasLimit,
          gasPrice,
        });
      });

      const receipt = await tx.wait();
      if (!receipt) {
        throw new Error('Transaction de collecte non confirmée');
      }

      const parsed = parseCollectFromReceipt(receipt as ContractTransactionReceipt, pm.target as string);
      const amount0 = parsed?.amount0 ?? expected0;
      const amount1 = parsed?.amount1 ?? expected1;

      const harvestedSnapshot: FeeSnapshot = {
        tokenId,
        token0: snapshot.token0,
        token1: snapshot.token1,
        fee: snapshot.fee,
        tokensOwed0: amount0,
        tokensOwed1: amount1,
      };

      const harvestedValues = await this.estimateFeeValue(harvestedSnapshot);
      const harvest = this.computeHarvestBreakdown(harvestedSnapshot, harvestedValues);

      let reinvestTxHash: string | null = null;
      if (harvest.reinvest0 > 0n || harvest.reinvest1 > 0n) {
        const reinvestResult = await this.increaseLiquidity({
          tokenId,
          amount0Desired: harvest.reinvest0,
          amount1Desired: harvest.reinvest1,
          amount0Min: 0n,
          amount1Min: 0n,
          deadline: Math.floor(Date.now() / 1000) + 900,
        }, privateKey, { dryRun: false });

        if (reinvestResult.success) {
          reinvestTxHash = reinvestResult.txHash ?? null;
        } else if (reinvestResult.error) {
          logger.warn({
            tokenId: tokenId.toString(),
            error: reinvestResult.error,
            message: 'Augmentation de liquidité après collecte échouée'
          });
        }
      }

      let totalWethToUnwrap = 0n;
      let swapTxHash: string | null = null;

      const handleCashout = async (tokenAddress: string, amount: bigint) => {
        if (amount === 0n) return;
        const lower = tokenAddress.toLowerCase();

        if (lower === CONSTANTS.NATIVE_ADDRESS) {
          harvest.cashedOutEth += amount;
          return;
        }

        const swapPortion = lower === CONSTANTS.TOKENS.PENGU.toLowerCase()
          ? (amount * BigInt(cfg.PENGU_TO_ETH_FEE_SWAP_PERCENT)) / 100n
          : amount;

        if (swapPortion === 0n) return;

        const conversion = await this.convertToWeth(tokenAddress, swapPortion, snapshot.fee, privateKey, recipient);
        totalWethToUnwrap += conversion.wethAmount;
        if (conversion.swapTxHash) {
          swapTxHash = conversion.swapTxHash;
        }
      };

      await handleCashout(snapshot.token0, harvest.cashout0);
      await handleCashout(snapshot.token1, harvest.cashout1);

      let unwrapTxHash: string | null = null;
      if (totalWethToUnwrap > 0n) {
        const humanAmount = ethers.formatUnits(totalWethToUnwrap, 18);
        const unwrapResult = await tokenService.unwrapWETH(humanAmount, privateKey, { dryRun: false });
        if (unwrapResult.success) {
          unwrapTxHash = unwrapResult.txHash ?? null;
          harvest.cashedOutEth += totalWethToUnwrap;
        } else if (unwrapResult.error) {
          logger.warn({
            amount: humanAmount,
            error: unwrapResult.error,
            message: 'Unwrap WETH échoué lors de la collecte'
          });
        }
      }

      logger.info({
        tokenId: tokenId.toString(),
        amount0: amount0.toString(),
        amount1: amount1.toString(),
        reinvest0: harvest.reinvest0.toString(),
        reinvest1: harvest.reinvest1.toString(),
        cashedOutEth: harvest.cashedOutEth.toString(),
        txHash: receipt.hash,
        message: 'Collecte des frais exécutée'
      });

      return {
        executed: true,
        expected0,
        expected1,
        amount0,
        amount1,
        txHash: receipt.hash,
        gasUsed: receipt.gasUsed.toString(),
        status: 'collect_executed',
        reinvested0: harvest.reinvest0,
        reinvested1: harvest.reinvest1,
        reinvestTxHash,
        cashedOutEth: harvest.cashedOutEth,
        swapTxHash,
        unwrapTxHash,
      };

    } catch (error) {
      logError(error, { tokenId: params.tokenId.toString() });

      return {
        executed: false,
        expected0: 0n,
        expected1: 0n,
        amount0: 0n,
        amount1: 0n,
        txHash: null,
        gasUsed: undefined,
        status: 'collect_failed'
      };
    }
  }

  // Obtenir les informations d'une position
  async getPosition(tokenId: bigint): Promise<PositionInfo> {
    const position = await withRetryRpc(async () => {
      const pm = this.getPositionManager();
      return await pm.positions(tokenId);
    });

    return {
      tokenId,
      token0: position.token0,
      token1: position.token1,
      fee: Number(position.fee),
      tickLower: Number(position.tickLower),
      tickUpper: Number(position.tickUpper),
      liquidity: BigInt(position.liquidity),
      feeGrowthInside0LastX128: BigInt(position.feeGrowthInside0LastX128),
      feeGrowthInside1LastX128: BigInt(position.feeGrowthInside1LastX128),
      tokensOwed0: BigInt(position.tokensOwed0),
      tokensOwed1: BigInt(position.tokensOwed1),
    };
  }

  // Calculer le range de ticks
  calculateTickRange(params: RangeParams): { tickLower: number; tickUpper: number } {
    return calculateTickRange(params.currentTick, params.tickSpacing, params.rangePercent);
  }

  // Calculer les montants pour une position
  calculateAmounts(params: AmountParams): CalculationResult {
    // Calcul simplifié - en réalité, il faudrait implémenter la logique complète de Uniswap v3
    const { sqrtPriceX96, tickLower, tickUpper, amount0Desired, amount1Desired } = params;
    
    // Pour simplifier, on retourne les montants désirés
    // En réalité, il faudrait calculer les montants exacts selon la formule de Uniswap v3
    return {
      tickLower,
      tickUpper,
      amount0: amount0Desired,
      amount1: amount1Desired,
      liquidity: 0n, // Calculé par le contrat
    };
  }

  // S'assurer que le token est approuvé
  private async ensureTokenApproval(
    tokenAddress: string,
    spender: string,
    amount: bigint,
    signer: ethers.Wallet
  ): Promise<void> {
    // Si c'est ETH natif, pas besoin d'approbation
    if (tokenAddress === CONSTANTS.NATIVE_ADDRESS) {
      return;
    }

    const token = new ethers.Contract(tokenAddress, ERC20_MIN_ABI, signer);
    const owner = await signer.getAddress();

    // Vérifier l'allowance actuelle
    const allowance = await withRetryRpc(async () => {
      return await token.allowance(owner, spender);
    });

    if (allowance >= amount) {
      logger.debug({
        tokenAddress,
        spender,
        allowance: allowance.toString(),
        amount: amount.toString(),
        message: 'Allowance suffisante'
      });
      return;
    }

    logger.info({
      tokenAddress,
      spender,
      allowance: allowance.toString(),
      amount: amount.toString(),
      message: 'Approbation du token nécessaire'
    });

    // Approuver le token
    const approveTx = await withRetryTransaction(async () => {
      return await token.approve(spender, amount);
    });

    await approveTx.wait();

    logger.info({
      tokenAddress,
      spender,
      amount: amount.toString(),
      txHash: approveTx.hash,
      message: 'Token approuvé'
    });
  }

  // Extraire le tokenId du receipt
  private extractTokenIdFromReceipt(receipt: ethers.TransactionReceipt): bigint {
    const pm = this.getPositionManager();
    const npmAddress = (pm.target as string).toLowerCase();

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== npmAddress) continue;

      try {
        const parsed = pm.interface.parseLog({ topics: log.topics, data: log.data });

        if (!parsed) {
          continue;
        }

        if (parsed.name === 'Mint' || parsed.name === 'IncreaseLiquidity') {
          const tokenId = parsed.args?.tokenId;
          if (tokenId) {
            return BigInt(tokenId);
          }
        }

        if (parsed.name === 'Transfer') {
          const args = parsed.args as Record<string, unknown> | undefined;
          const parsedFrom = typeof args?.from === 'string' ? (args.from as string).toLowerCase() : undefined;
          const fromTopic = typeof log.topics?.[1] === 'string' ? log.topics[1].toLowerCase() : undefined;
          const from = parsedFrom ?? fromTopic;

          let tokenIdValue: bigint | null = null;
          const argTokenId = args?.tokenId as string | bigint | number | undefined;
          if (typeof argTokenId === 'string' || typeof argTokenId === 'number' || typeof argTokenId === 'bigint') {
            tokenIdValue = BigInt(argTokenId);
          } else if (log.topics?.[3]) {
            tokenIdValue = BigInt(log.topics[3]);
          }

          if (from === CONSTANTS.NATIVE_ADDRESS && tokenIdValue !== null) {
            return tokenIdValue;
          }
        }
      } catch {
        continue;
      }
    }

    throw new Error('TokenId non trouvé dans le receipt');
  }

  // Extraire les montants du receipt
  private extractAmountsFromReceipt(receipt: ethers.TransactionReceipt): { amount0: bigint; amount1: bigint; liquidity: bigint } {
    // Chercher l'event IncreaseLiquidity ou Mint
    for (const log of receipt.logs) {
      try {
        const pm = this.getPositionManager();
        const parsed = pm.interface.parseLog({
          topics: log.topics,
          data: log.data,
        });
        
        if (parsed && (parsed.name === 'IncreaseLiquidity' || parsed.name === 'Mint')) {
          const { amount0, amount1, liquidity } = parsed.args;
          return {
            amount0: BigInt(amount0),
            amount1: BigInt(amount1),
            liquidity: BigInt(liquidity),
          };
        }
      } catch (error) {
        // Ignorer les logs qui ne correspondent pas à notre contrat
        continue;
      }
    }
    
    // Si pas trouvé, retourner des valeurs par défaut
    return { amount0: 0n, amount1: 0n, liquidity: 0n };
  }

  // Obtenir les informations d'un pool
  private async getPoolInfo(tokenA: string, tokenB: string, fee: number): Promise<{ token0: string; token1: string; fee: number }> {
    const pool = new ethers.Contract(
      CONSTANTS.UNIV3.FACTORY,
      UNIV3_FACTORY_ABI,
      this.provider
    );

    const poolAddress = await withRetryRpc(async () => {
      return await pool.getPool(tokenA, tokenB, fee);
    });

    if (poolAddress === '0x0000000000000000000000000000000000000000') {
      throw new Error(`Pool non trouvé pour ${tokenA}/${tokenB} avec fee ${fee}`);
    }

    const poolContract = new ethers.Contract(poolAddress, UNIV3_POOL_ABI, this.provider);
    const [token0, token1] = await withRetryRpc(async () => {
      return await Promise.all([
        poolContract.token0(),
        poolContract.token1()
      ]);
    });

    return { token0, token1, fee };
  }

  // Obtenir les décimales d'un token
  private async getTokenDecimals(tokenAddress: string): Promise<number> {
    if (/^0x0{40}$/i.test(tokenAddress)) return 18; // ETH natif
    const erc20 = new ethers.Contract(tokenAddress, ERC20_MIN_ABI, this.provider);
    return await erc20.decimals();
  }

  // Obtenir le solde d'un token
  private async getTokenBalance(tokenAddress: string, owner: string, signer: ethers.Wallet): Promise<bigint> {
    if (/^0x0{40}$/i.test(tokenAddress)) {
      // ETH natif
      return await signer.provider!.getBalance(owner);
    }
    
    const token = new ethers.Contract(tokenAddress, ERC20_MIN_ABI, signer);
    return await withRetryRpc(async () => {
      return await token.balanceOf(owner);
    });
  }
}

// Instance singleton du service de positions LP
export const liquidityPositionService = new LiquidityPositionService();
