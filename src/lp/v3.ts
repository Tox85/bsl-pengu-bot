import { ethers } from 'ethers';
import { CONSTANTS } from '../config/env.js';
import { logger, logError } from '../core/logger.js';
import { withRetryRpc, withRetryTransaction } from '../core/retry.js';
import { createSigner, getProvider, getGasPrice, estimateGasLimit } from '../core/rpc.js';
import { 
  calculateTickRange, 
  calculateMinAmountOut, 
  calculateMaxAmountIn,
  Q96,
  Q128 
} from '../core/math.js';
import { NONFUNGIBLE_POSITION_MANAGER_ABI, ERC20_MIN_ABI } from '../abis/index.js';
import type { 
  PositionInfo, 
  CreatePositionParams, 
  IncreaseLiquidityParams,
  DecreaseLiquidityParams,
  CollectFeesParams,
  PositionResult,
  RangeParams,
  AmountParams,
  CalculationResult
} from './types.js';

// Service de gestion des positions LP Uniswap v3
export class LiquidityPositionService {
  private positionManager: ethers.Contract;

  constructor() {
    const provider = getProvider(CONSTANTS.CHAIN_IDS.ABSTRACT);
    this.positionManager = new ethers.Contract(
      CONSTANTS.UNIV3.NF_POSITION_MANAGER,
      NONFUNGIBLE_POSITION_MANAGER_ABI,
      provider
    );
  }

  // Créer une nouvelle position LP
  async createPosition(
    params: CreatePositionParams,
    privateKey: string,
    options: { dryRun?: boolean } = {}
  ): Promise<PositionResult> {
    const { dryRun = CONSTANTS.DRY_RUN } = options;

    try {
      logger.info({
        token0: params.token0,
        token1: params.token1,
        fee: params.fee,
        tickLower: params.tickLower,
        tickUpper: params.tickUpper,
        amount0Desired: params.amount0Desired.toString(),
        amount1Desired: params.amount1Desired.toString(),
        message: 'Création de position LP'
      });

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
      const signer = createSigner(privateKey, CONSTANTS.CHAIN_IDS.ABSTRACT);
      const recipient = await signer.getAddress();

      // S'assurer que les tokens sont approuvés
      await this.ensureTokenApproval(params.token0, CONSTANTS.UNIV3.NF_POSITION_MANAGER, params.amount0Desired, signer);
      await this.ensureTokenApproval(params.token1, CONSTANTS.UNIV3.NF_POSITION_MANAGER, params.amount1Desired, signer);

      // Préparer les paramètres de mint
      const mintParams = {
        token0: params.token0,
        token1: params.token1,
        fee: params.fee,
        tickLower: params.tickLower,
        tickUpper: params.tickUpper,
        amount0Desired: params.amount0Desired,
        amount1Desired: params.amount1Desired,
        amount0Min: params.amount0Min,
        amount1Min: params.amount1Min,
        recipient,
        deadline: params.deadline,
      };

      // Estimer le gas
      const gasLimit = await estimateGasLimit(
        this.positionManager,
        'mint',
        [mintParams],
        { value: 0n }
      );

      // Obtenir le gas price
      const gasPrice = await getGasPrice(signer.provider! as any);

      // Exécuter la création de position
      const tx = await withRetryTransaction(async () => {
        return await this.positionManager.mint(mintParams, {
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
    const { dryRun = CONSTANTS.DRY_RUN } = options;

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
      const signer = createSigner(privateKey, CONSTANTS.CHAIN_IDS.ABSTRACT);

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
      const gasLimit = await estimateGasLimit(
        this.positionManager,
        'increaseLiquidity',
        [increaseParams],
        { value: 0n }
      );

      // Obtenir le gas price
      const gasPrice = await getGasPrice(signer.provider! as any);

      // Exécuter l'augmentation de liquidité
      const tx = await withRetryTransaction(async () => {
        return await this.positionManager.increaseLiquidity(increaseParams, {
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
    const { dryRun = CONSTANTS.DRY_RUN } = options;

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
      const signer = createSigner(privateKey, CONSTANTS.CHAIN_IDS.ABSTRACT);

      // Préparer les paramètres de diminution
      const decreaseParams = {
        tokenId: params.tokenId,
        liquidity: params.liquidity,
        amount0Min: params.amount0Min,
        amount1Min: params.amount1Min,
        deadline: params.deadline,
      };

      // Estimer le gas
      const gasLimit = await estimateGasLimit(
        this.positionManager,
        'decreaseLiquidity',
        [decreaseParams],
        { value: 0n }
      );

      // Obtenir le gas price
      const gasPrice = await getGasPrice(signer.provider! as any);

      // Exécuter la diminution de liquidité
      const tx = await withRetryTransaction(async () => {
        return await this.positionManager.decreaseLiquidity(decreaseParams, {
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

  // Collecter les frais d'une position
  async collectFees(
    params: CollectFeesParams,
    privateKey: string,
    options: { dryRun?: boolean } = {}
  ): Promise<PositionResult> {
    const { dryRun = CONSTANTS.DRY_RUN } = options;

    try {
      logger.info({
        tokenId: params.tokenId.toString(),
        recipient: params.recipient,
        amount0Max: params.amount0Max.toString(),
        amount1Max: params.amount1Max.toString(),
        message: 'Collecte des frais'
      });

      if (dryRun) {
        logger.info({
          tokenId: params.tokenId.toString(),
          recipient: params.recipient,
          amount0Max: params.amount0Max.toString(),
          amount1Max: params.amount1Max.toString(),
          message: 'DRY_RUN: Collecte des frais simulée'
        });

        return {
          success: true,
        };
      }

      // Créer le signer
      const signer = createSigner(privateKey, CONSTANTS.CHAIN_IDS.ABSTRACT);

      // Préparer les paramètres de collecte
      const collectParams = {
        tokenId: params.tokenId,
        recipient: params.recipient,
        amount0Max: params.amount0Max,
        amount1Max: params.amount1Max,
      };

      // Estimer le gas
      const gasLimit = await estimateGasLimit(
        this.positionManager,
        'collect',
        [collectParams],
        { value: 0n }
      );

      // Obtenir le gas price
      const gasPrice = await getGasPrice(signer.provider! as any);

      // Exécuter la collecte de frais
      const tx = await withRetryTransaction(async () => {
        return await this.positionManager.collect(collectParams, {
          value: 0n,
          gasLimit,
          gasPrice,
        });
      });

      logger.info({
        txHash: tx.hash,
        message: 'Transaction de collecte de frais envoyée'
      });

      // Attendre la confirmation
      const receipt = await tx.wait();

      if (!receipt) {
        throw new Error('Transaction de collecte de frais échouée');
      }

      // Extraire les montants du receipt
      const { amount0, amount1 } = this.extractAmountsFromReceipt(receipt);

      logger.info({
        tokenId: params.tokenId.toString(),
        amount0: amount0.toString(),
        amount1: amount1.toString(),
        txHash: receipt.hash,
        message: 'Frais collectés avec succès'
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

  // Obtenir les informations d'une position
  async getPosition(tokenId: bigint): Promise<PositionInfo> {
    const position = await withRetryRpc(async () => {
      return await this.positionManager.positions(tokenId);
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
    // Logique pour extraire le tokenId du receipt
    // En réalité, il faudrait parser les logs du receipt
    return 0n; // Placeholder
  }

  // Extraire les montants du receipt
  private extractAmountsFromReceipt(receipt: ethers.TransactionReceipt): { amount0: bigint; amount1: bigint; liquidity: bigint } {
    // Logique pour extraire les montants du receipt
    // En réalité, il faudrait parser les logs du receipt
    return { amount0: 0n, amount1: 0n, liquidity: 0n }; // Placeholder
  }
}

// Instance singleton du service de positions LP
export const liquidityPositionService = new LiquidityPositionService();
