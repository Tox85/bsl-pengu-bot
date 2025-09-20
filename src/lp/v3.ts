import { ethers, Interface, Log, ContractTransactionReceipt } from 'ethers';
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
import { NONFUNGIBLE_POSITION_MANAGER_ABI, ERC20_MIN_ABI, UNIV3_FACTORY_ABI, UNIV3_POOL_ABI } from '../abis/index.js';
import { MAX_UINT128 } from '../config/nums.js';
import { CollectResult, CollectStatus } from '../core/collect-status.js';
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
  private positionManager?: ethers.Contract;

  constructor() {
    // L'initialisation sera faite via ensurePositionManager()
  }

  // IMPORTANT: synchrones, pas d'async, toujours return
  private ensurePositionManager(): ethers.Contract {
    if (this.positionManager) return this.positionManager;

    const addr = process.env.NF_POSITION_MANAGER;
    if (!addr) throw new Error('NF_POSITION_MANAGER manquant dans .env');

    // Créer le signer pour le positionManager
    const signer = new ethers.Wallet(process.env.PRIVATE_KEY!, getProvider(CONSTANTS.CHAIN_IDS.ABSTRACT));
    
    // log utile
    logger.info({ 
      chainId: 2741, 
      signer: signer.address, 
      npmAddress: addr 
    }, 'Initialisation du positionManager');

    this.positionManager = new ethers.Contract(addr, NONFUNGIBLE_POSITION_MANAGER_ABI, signer);
    
    // Debug: vérifier que le contrat est bien créé
    logger.info({
      positionManagerExists: !!this.positionManager,
      hasMint: !!this.positionManager?.mint,
      message: 'Debug: positionManager créé'
    });
    
    const result = this.positionManager;
    logger.info({
      resultExists: !!result,
      resultHasMint: !!result?.mint,
      message: 'Debug: avant return dans ensurePositionManager'
    });
    
    return result;
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

      // Le positionManager sera initialisé via ensurePositionManager() quand nécessaire

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

      // CORRECTION 5: Utiliser callStatic d'abord, puis estimateGas direct
      logger.info({
        thisExists: !!this,
        ensurePositionManagerExists: !!this.ensurePositionManager,
        message: 'Debug: avant ensurePositionManager()'
      });
      
      const pm = this.ensurePositionManager();
      
      logger.info({
        pmExists: !!pm,
        pmHasMint: !!pm?.mint,
        message: 'Debug: après ensurePositionManager()'
      });
      
      // Debug: vérifier pm juste avant l'appel
      logger.info({
        pmBeforeCall: !!pm,
        pmMintBeforeCall: !!pm?.mint,
        message: 'Debug: juste avant pm.mint.staticCall'
      });
      
      // Guard pour vérifier l'API ethers v6
      if (!pm || !(pm as any).mint || !(pm as any).mint.staticCall) {
        logger.error({
          hasPm: !!pm,
          hasMint: !!(pm as any)?.mint,
          hasStaticCall: !!(pm as any)?.mint?.staticCall,
          hasCallStatic: !!(pm as any)?.callStatic
        }, "Ethers API mismatch: use pm.mint.staticCall with ethers v6");
        throw new Error("Ethers v6 expected: pm.mint.staticCall is required");
      }
      
      await pm.mint.staticCall(mintParams, { from: recipient, value: 0n });
      logger.info({ message: 'staticCall mint réussi' });
      
      // Debug: vérifier pm juste après l'appel
      logger.info({
        pmAfterCall: !!pm,
        pmMintAfterCall: !!pm?.mint,
        message: 'Debug: juste après pm.mint.staticCall'
      });

      // Debug: vérifier pm juste avant estimateGas
      logger.info({
        pmBeforeEstimateGas: !!pm,
        pmMintBeforeEstimateGas: !!pm?.mint,
        message: 'Debug: juste avant pm.mint.estimateGas'
      });
      
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
      const pm = this.ensurePositionManager();
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
      const pm = this.ensurePositionManager();
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

  // Collecter les frais d'une position (version corrigée ethers v6)
  async collectFees(
    params: CollectFeesParams,
    privateKey: string,
    options: { dryRun?: boolean } = {}
  ): Promise<CollectResult> {
    const { dryRun = false } = options;

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
          executed: false,
          expected0: 0n,
          expected1: 0n,
          amount0: 0n,
          amount1: 0n,
          txHash: null,
          gasUsed: undefined,
          status: 'collect_skipped'
        };
      }

      // Créer le signer
      const signer = await createSigner(privateKey, CONSTANTS.CHAIN_IDS.ABSTRACT);
      const pm = this.ensurePositionManager();
      const to = params.recipient || await signer.getAddress();

      const collectParams = {
        tokenId: params.tokenId,
        recipient: to,
        amount0Max: MAX_UINT128,
        amount1Max: MAX_UINT128,
      };

      // 1) Simuler pour savoir s'il y a des frais à collecter
      let expected0: bigint = 0n;
      let expected1: bigint = 0n;
      try {
        // v6 simulation
        const result = await pm.collect.staticCall(collectParams);
        // Uniswap NPM retourne (uint256 amount0, uint256 amount1)
        // ethers v6 retourne soit un tuple soit un objet nommé; normaliser vers BigInt
        const a0 = (result?.[0] ?? (result?.amount0 as any) ?? 0n);
        const a1 = (result?.[1] ?? (result?.amount1 as any) ?? 0n);
        expected0 = BigInt(a0);
        expected1 = BigInt(a1);
      } catch (e) {
        logger.warn({ 
          tokenId: params.tokenId.toString(), 
          err: String(e) 
        }, "Collect.staticCall failed; will attempt tx anyway");
      }

      // 2) Si rien à collecter, sortir proprement (évite .toString sur undefined)
      if (expected0 === 0n && expected1 === 0n) {
        logger.info({
          tokenId: params.tokenId.toString(),
          expected0: expected0.toString(),
          expected1: expected1.toString(),
        }, "No fees to collect yet; skipping collect tx");
        
        logger.info({
          tokenId: params.tokenId.toString(),
          status: 'collect_skipped'
        }, "Collect status: collect_skipped");
        
        return { 
          executed: false,
          expected0: 0n,
          expected1: 0n,
          amount0: 0n,
          amount1: 0n,
          txHash: null,
          gasUsed: undefined,
          status: 'collect_skipped'
        };
      }

      // 3) Estimer et envoyer la tx
      const gas = await pm.collect.estimateGas(collectParams);
      const tx = await pm.collect(collectParams, { 
        gasLimit: gas + gas / 5n,
        value: 0n
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

      // 4) Parser l'event Collect du receipt (robuste) et fallback vers les valeurs attendues
      const parsed = parseCollectFromReceipt(receipt, pm.target as string);
      const amount0 = parsed?.amount0 ?? expected0 ?? 0n;
      const amount1 = parsed?.amount1 ?? expected1 ?? 0n;

      // Guard avant d'utiliser les montants décodés
      if (parsed && (parsed.amount0 === undefined || parsed.amount1 === undefined)) {
        logger.warn({ parsed }, "Parsed Collect missing amounts; falling back to staticCall values");
      }

      logger.info({
        tokenId: params.tokenId.toString(),
        amount0: amount0.toString(),
        amount1: amount1.toString(),
        txHash: receipt.hash,
        message: 'Frais collectés avec succès'
      });

      logger.info({
        tokenId: params.tokenId.toString(),
        status: 'collect_executed'
      }, "Collect status: collect_executed");

      return {
        executed: true,
        expected0,
        expected1,
        amount0,
        amount1,
        txHash: receipt.hash,
        gasUsed: receipt.gasUsed.toString(),
        status: 'collect_executed'
      };

    } catch (error) {
      logError(error, { tokenId: params.tokenId.toString() });
      
      logger.info({
        tokenId: params.tokenId.toString(),
        status: 'collect_failed'
      }, "Collect status: collect_failed");
      
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
      const pm = this.ensurePositionManager();
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
    const pm = this.ensurePositionManager();
    
    // Debug: lister tous les events du receipt
    logger.info({
      logsCount: receipt.logs.length,
      message: 'Debug: nombre de logs dans le receipt'
    });
    
    for (let i = 0; i < receipt.logs.length; i++) {
      const log = receipt.logs[i];
      logger.info({
        logIndex: i,
        address: log.address,
        topics: log.topics,
        data: log.data,
        message: 'Debug: log du receipt'
      });
      
      try {
        const parsed = pm.interface.parseLog({
          topics: log.topics,
          data: log.data,
        });
        
        if (parsed) {
          logger.info({
            logIndex: i,
            eventName: parsed.name,
            args: parsed.args,
            message: 'Debug: event parsé'
          });
          
          if (parsed.name === 'IncreaseLiquidity' || parsed.name === 'Mint') {
            if (parsed.args.tokenId) {
              logger.info({
                tokenId: parsed.args.tokenId.toString(),
                message: 'Debug: tokenId trouvé dans IncreaseLiquidity/Mint'
              });
              return BigInt(parsed.args.tokenId);
            }
          }
          
          if (parsed.name === 'Transfer') {
            const { from, to, tokenId } = parsed.args;
            logger.info({
              from,
              to,
              tokenId: tokenId?.toString(),
              message: 'Debug: event Transfer'
            });
            if (from === '0x0000000000000000000000000000000000000000') {
              logger.info({
                tokenId: tokenId.toString(),
                message: 'Debug: tokenId trouvé dans Transfer mint'
              });
              return BigInt(tokenId);
            }
          }
          
          // Fallback: chercher le tokenId dans les topics si les args ne le contiennent pas
          if (parsed.name === 'Transfer' && log.topics.length >= 4) {
            const from = log.topics[1];
            const to = log.topics[2];
            const tokenId = log.topics[3];
            
            logger.info({
              from,
              to,
              tokenId: tokenId,
              message: 'Debug: event Transfer (topics)'
            });
            
            if (from === '0x0000000000000000000000000000000000000000') {
              const tokenIdBigInt = BigInt(tokenId);
              logger.info({
                tokenId: tokenIdBigInt.toString(),
                message: 'Debug: tokenId trouvé dans Transfer mint (topics)'
              });
              return tokenIdBigInt;
            }
          }
        }
      } catch (error) {
        // Ignorer les logs qui ne correspondent pas à notre contrat
        logger.info({
          logIndex: i,
          error: error.message,
          message: 'Debug: erreur parsing log'
        });
        continue;
      }
    }
    
    // Fallback final: chercher directement dans les topics sans parsing
    for (let i = 0; i < receipt.logs.length; i++) {
      const log = receipt.logs[i];
      
      // Vérifier si c'est un event Transfer du NonfungiblePositionManager
      if (log.address.toLowerCase() === process.env.NF_POSITION_MANAGER?.toLowerCase() && 
          log.topics.length >= 4 && 
          log.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef') {
        
        const from = log.topics[1];
        const to = log.topics[2];
        const tokenId = log.topics[3];
        
        logger.info({
          logIndex: i,
          from,
          to,
          tokenId: tokenId,
          message: 'Debug: event Transfer direct (topics)'
        });
        
        if (from === '0x0000000000000000000000000000000000000000' || from === '0x0000000000000000000000000000000000000000000000000000000000000000') {
          const tokenIdBigInt = BigInt(tokenId);
          logger.info({
            tokenId: tokenIdBigInt.toString(),
            message: 'Debug: tokenId trouvé dans Transfer mint (direct)'
          });
          return tokenIdBigInt;
        }
      }
    }
    
    throw new Error('TokenId non trouvé dans le receipt');
  }

  // Extraire les montants du receipt
  private extractAmountsFromReceipt(receipt: ethers.TransactionReceipt): { amount0: bigint; amount1: bigint; liquidity: bigint } {
    // Chercher l'event IncreaseLiquidity ou Mint
    for (const log of receipt.logs) {
      try {
        const pm = this.ensurePositionManager();
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
    const provider = getProvider(CONSTANTS.CHAIN_IDS.ABSTRACT);
    
    // Utiliser directement process.env au lieu des constantes
    const factoryAddress = process.env.UNIV3_FACTORY;
    if (!factoryAddress) {
      throw new Error('UNIV3_FACTORY non défini dans .env');
    }
    
    const pool = new ethers.Contract(
      factoryAddress,
      UNIV3_FACTORY_ABI,
      provider
    );

    const poolAddress = await withRetryRpc(async () => {
      return await pool.getPool(tokenA, tokenB, fee);
    });

    if (poolAddress === '0x0000000000000000000000000000000000000000') {
      throw new Error(`Pool non trouvé pour ${tokenA}/${tokenB} avec fee ${fee}`);
    }

    const poolContract = new ethers.Contract(poolAddress, UNIV3_POOL_ABI, provider);
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
    const provider = getProvider(CONSTANTS.CHAIN_IDS.ABSTRACT);
    const erc20 = new ethers.Contract(tokenAddress, ERC20_MIN_ABI, provider);
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
