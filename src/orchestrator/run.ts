import { ethers } from 'ethers';
import { CONSTANTS, cfg } from '../config/env.js';
import { logger, logError, logMetrics } from '../core/logger.js';
import { withRetryRpc } from '../core/retry.js';
import { createSigner, getProvider } from '../core/rpc.js';
import { parseAmount, formatAmount } from '../core/math.js';
import { ERC20_MIN_ABI } from '../abis/erc20.js';
import { bridgeService } from '../bridge/index.js';
import { swapService } from '../dex/index.js';
import { liquidityPositionService } from '../lp/index.js';
import { GasService } from '../services/gas.js';
import { buildContext, type BotContext } from '../core/context.js';
import { stateManager } from './state.js';
import type { 
  OrchestratorParams, 
  OrchestratorResult, 
  OrchestratorState,
  OrchestratorMetrics 
} from './types.js';
import { OrchestratorStep } from './types.js';

// Service principal de l'orchestrateur
export class OrchestratorService {
  private stateManager: typeof stateManager;

  constructor() {
    this.stateManager = stateManager;
  }

  // Exécuter le flow complet
  async run(params: OrchestratorParams): Promise<OrchestratorResult> {
    const startTime = Date.now();
    
    try {
      // Créer le contexte centralisé
      const context = buildContext({
        privateKey: params.privateKey,
        autoGasTopUp: params.autoGasTopUp,
        fresh: false, // Géré par le CLI
        dryRun: params.dryRun?.toString() || "false",
        minNativeOnDest: params.minNativeOnDest,
        gasTopUpTarget: params.gasTopUpTarget,
      });

      logger.info({
        wallet: context.walletAddress,
        bridgeAmount: params.bridgeAmount,
        bridgeToken: params.bridgeToken,
        swapAmount: params.swapAmount,
        swapPair: params.swapPair,
        lpRangePercent: params.lpRangePercent,
        collectAfterMinutes: params.collectAfterMinutes,
        dryRun: context.dryRun,
        autoGasTopUp: context.autoGasTopUp,
        message: 'Démarrage de l\'orchestrateur'
      });

      // Charger ou créer l'état
      let state = this.stateManager.loadState(context.walletAddress) || this.stateManager.createState(context.walletAddress);

      // Vérifier la connexion RPC
      await this.checkRpcConnections();

      // Exécuter les étapes selon l'état actuel
      state = await this.executeSteps(state, params, context);

      // Calculer les métriques
      const metrics = await this.calculateMetrics(state, startTime);

      // Sauvegarder l'état final
      this.stateManager.saveState(state);

      logger.info({
        wallet: context.walletAddress,
        currentStep: state.currentStep,
        duration: Date.now() - startTime,
        message: 'Orchestrateur terminé'
      });

      return {
        success: state.currentStep === 'collect_done',
        state,
        metrics,
      };

    } catch (error) {
      const walletAddress = params.privateKey ? '***' : 'unknown';
      logError(error, { 
        wallet: walletAddress,
        message: 'Erreur dans l\'orchestrateur'
      });

      return {
        success: false,
        state: {
          wallet: walletAddress,
          currentStep: OrchestratorStep.ERROR,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // Exécuter les étapes selon l'état actuel
  private async executeSteps(
    state: OrchestratorState,
    params: OrchestratorParams,
    context: BotContext
  ): Promise<OrchestratorState> {
    let currentState = state;

    // Étape 1: Bridge (si pas encore fait)
    if (currentState.currentStep === 'idle' || currentState.currentStep === 'bridge_pending') {
      currentState = await this.executeBridgeStep(currentState, params);
    }

    // Étape 2: Swap (si bridge terminé)
    if (currentState.currentStep === 'bridge_done' || currentState.currentStep === 'swap_pending') {
      currentState = await this.executeSwapStep(currentState, params, context);
    }

    // Étape 3: LP (si swap terminé)
    if (currentState.currentStep === 'swap_done' || currentState.currentStep === 'lp_pending') {
      currentState = await this.executeLpStep(currentState, params);
    }

    // Étape 4: Collect (si LP terminé)
    if (currentState.currentStep === 'lp_done' || currentState.currentStep === 'collect_pending') {
      currentState = await this.executeCollectStep(currentState, params);
    }

    return currentState;
  }

  // Exécuter l'étape de bridge
  private async executeBridgeStep(
    state: OrchestratorState,
    params: OrchestratorParams
  ): Promise<OrchestratorState> {
    try {
      logger.info({
        wallet: state.wallet,
        message: 'Exécution de l\'étape Bridge'
      });

      // Mettre à jour l'état
      state = this.stateManager.updateState(state, { currentStep: OrchestratorStep.BRIDGE_PENDING });

      // Préparer les paramètres de bridge
      const bridgeParams = {
        fromChainId: CONSTANTS.CHAIN_IDS.BASE,
        toChainId: CONSTANTS.CHAIN_IDS.ABSTRACT,
        fromTokenAddress: this.getBridgeTokenAddress(params.bridgeToken, 'source'), // Token source
        toTokenAddress: this.getBridgeTokenAddress(params.bridgeToken, 'destination'), // Token destination
        amount: this.getBridgeAmount(params.bridgeToken, params.bridgeAmount), // Décimales correctes selon le token
        fromAddress: state.wallet,
        toAddress: state.wallet,
        slippage: 50, // 0.5%
      };

      // Skip bridge si montant = 0 (pour tester directement le swap)
      if (params.bridgeAmount === "0") {
        logger.info({ message: "Bridge ignoré (montant = 0), passage direct au swap" });
        return {
          ...state,
          currentStep: 'bridge_done',
          bridgeTxHash: 'skipped',
          updatedAt: Date.now()
        };
      }

      // Obtenir la route de bridge
      const route = await bridgeService.getBridgeRoute(bridgeParams);

      // Vérifier le montant minimum USD
      const fromUsd = route.estimate?.fromAmountUSD || 0;
      const minBridgeUsd = Number(process.env.MIN_BRIDGE_USD || 1);
      
      logger.info({
        fromUsd,
        minBridgeUsd,
        message: "Vérification montant minimum bridge"
      });

      if (fromUsd > 0 && fromUsd < minBridgeUsd) {
        throw new Error(`Bridge amount too small (fromUsd=${fromUsd} USD). Set --bridgeAmount ≥ ${minBridgeUsd} USDC or tweak MIN_BRIDGE_USD.`);
      }

      // Logger si minAmount disponible
      if (route.step?.minAmount || route.step?.minAmountUSD) {
        logger.info({
          minAmount: route.step.minAmount,
          minAmountUSD: route.step.minAmountUSD,
          message: "Montant minimum requis par la route"
        });
      }

      // Exécuter le bridge
      const result = await bridgeService.executeRoute(route, params.privateKey, {
        dryRun: params.dryRun,
      });

      if (!result.success) {
        throw new Error(`Bridge échoué: ${result.error}`);
      }

      // En mode réel, attendre que le bridge soit reçu sur Abstract
      if (!params.dryRun && result.txHash) {
        logger.info({
          txHash: result.txHash,
          message: 'Attente confirmation bridge sur Abstract...'
        });
        
        // Le bridge service a déjà attendu la confirmation via waitUntilReceived
        // Vérifier que le statut est bien RECEIVED
        if (result.status?.status !== 'RECEIVED' && result.status?.status !== 'DONE') {
          throw new Error(`Bridge non confirmé sur Abstract. Statut: ${result.status?.status}`);
        }
      }

      // Mettre à jour l'état avec le résultat
      state = this.stateManager.updateState(state, {
        currentStep: OrchestratorStep.BRIDGE_DONE,
        bridgeResult: {
          routeId: route.id,
          txHash: result.txHash || '',
          fromAmount: route.fromAmount,
          toAmount: route.toAmount,
          status: result.status?.status || 'PENDING',
          success: true,
        },
      });

      // Ajouter le montant humain à la route pour l'exécution
      (route as any).fromAmountHuman = params.bridgeAmount;

      logger.info({
        wallet: state.wallet,
        txHash: result.txHash,
        fromAmount: route.fromAmount,
        toAmount: route.toAmount,
        message: 'Bridge terminé avec succès'
      });

      return state;

    } catch (error) {
      logError(error, { wallet: state.wallet, step: 'bridge' });
      
      return this.stateManager.updateState(state, {
        currentStep: OrchestratorStep.ERROR,
        bridgeResult: {
          routeId: '',
          txHash: '',
          fromAmount: '',
          toAmount: '',
          status: 'FAILED',
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }
  }

  // Exécuter l'étape de swap
  private async executeSwapStep(
    state: OrchestratorState,
    params: OrchestratorParams,
    context: BotContext
  ): Promise<OrchestratorState> {
    try {
      logger.info({
        wallet: state.wallet,
        message: 'Exécution de l\'étape Swap'
      });

      // Mettre à jour l'état
      state = this.stateManager.updateState(state, { currentStep: OrchestratorStep.SWAP_PENDING });

      // Déterminer les tokens pour le swap
      const { tokenIn, tokenOut } = this.getSwapTokens(params.bridgeToken, params.swapPair);

      // Vérifier le solde sur Abstract avant le swap
      const abstractProvider = getProvider(CONSTANTS.CHAIN_IDS.ABSTRACT);
      const tokenInContract = new ethers.Contract(tokenIn, ERC20_MIN_ABI, abstractProvider);
      const balance = await tokenInContract.balanceOf(state.wallet);
      const decimals = await tokenInContract.decimals();
      const requiredAmount = ethers.parseUnits(params.swapAmount, decimals);
      const gasBuffer = ethers.parseUnits("0.001", decimals); // Buffer pour le gas
      
      logger.info({
        tokenIn,
        balance: ethers.formatUnits(balance, decimals),
        requiredAmount: ethers.formatUnits(requiredAmount, decimals),
        gasBuffer: ethers.formatUnits(gasBuffer, decimals),
        message: 'Vérification solde Abstract'
      });

      if (balance < requiredAmount + gasBuffer) {
        throw new Error(`Solde insuffisant sur Abstract. Disponible: ${ethers.formatUnits(balance, decimals)}, Requis: ${ethers.formatUnits(requiredAmount + gasBuffer, decimals)}`);
      }

      // Vérifier et auto top-up du gas natif sur Abstract
      const minWeiNeeded = BigInt(params.minNativeOnDest || CONSTANTS.MIN_NATIVE_DEST_WEI_FOR_APPROVE.toString()) + 
                          BigInt(params.minNativeOnDest || CONSTANTS.MIN_NATIVE_DEST_WEI_FOR_SWAP.toString());
      const targetWei = BigInt(params.gasTopUpTarget || CONSTANTS.GAS_TOPUP_TARGET_WEI.toString());
      
      if (context.autoGasTopUp) {
        await GasService.ensureNativeOnAbstract({
          context,
          bridgeService,
          minWeiNeeded,
          targetWei
        });

        // Re-vérifier le solde après top-up
        const gasCheck = await GasService.checkNativeBalance(state.wallet, CONSTANTS.CHAIN_IDS.ABSTRACT);
        if (!gasCheck.sufficient) {
          throw new Error(`Solde gas natif insuffisant après top-up: ${gasCheck.balanceEth} ETH`);
        }
      } else {
        // Vérifier sans top-up automatique
        const gasCheck = await GasService.checkNativeBalance(state.wallet, CONSTANTS.CHAIN_IDS.ABSTRACT);
        if (!gasCheck.sufficient) {
          throw new Error(
            `Solde gas natif insuffisant sur Abstract: ${gasCheck.balanceEth} ETH. ` +
            `Veuillez bridger ~${ethers.formatEther(targetWei)} ETH pour le gas ` +
            `ou activez --autoGasTopUp true.`
          );
        }
      }

      // Préparer les paramètres de swap
      const swapParams = {
        tokenIn,
        tokenOut,
        amountIn: params.swapAmount, // Montant humain, sera converti dans SwapService
        slippageBps: cfg.SWAP_SLIPPAGE_BPS,
        recipient: state.wallet,
      };

      // Exécuter le swap
      const result = await swapService.executeSwap(swapParams, params.privateKey, {
        dryRun: params.dryRun,
      });

      if (!result.success) {
        throw new Error(`Swap échoué: ${result.error}`);
      }

      // Mettre à jour l'état avec le résultat
      state = this.stateManager.updateState(state, {
        currentStep: OrchestratorStep.SWAP_DONE,
        swapResult: {
          poolAddress: result.pool.address,
          tokenIn,
          tokenOut,
          amountIn: params.swapAmount,
          amountOut: result.amountOut.toString(),
          txHash: result.txHash || '',
          success: true,
        },
      });

      logger.info({
        wallet: state.wallet,
        tokenIn,
        tokenOut,
        amountIn: params.swapAmount,
        amountOut: result.amountOut.toString(),
        txHash: result.txHash,
        message: 'Swap terminé avec succès'
      });

      return state;

    } catch (error) {
      logError(error, { wallet: state.wallet, step: 'swap' });
      
      return this.stateManager.updateState(state, {
        currentStep: OrchestratorStep.ERROR,
        swapResult: {
          poolAddress: '',
          tokenIn: '',
          tokenOut: '',
          amountIn: '',
          amountOut: '',
          txHash: '',
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }
  }

  // Exécuter l'étape de LP
  private async executeLpStep(
    state: OrchestratorState,
    params: OrchestratorParams
  ): Promise<OrchestratorState> {
    try {
      logger.info({
        wallet: state.wallet,
        message: 'Exécution de l\'étape LP'
      });

      // Mettre à jour l'état
      state = this.stateManager.updateState(state, { currentStep: OrchestratorStep.LP_PENDING });

      // Déterminer les tokens pour la position LP
      const { token0, token1 } = this.getLpTokens(params.swapPair);

      // Obtenir les informations du pool
      const pool = await swapService.getQuote({
        tokenIn: token0,
        tokenOut: token1,
        amountIn: parseAmount('0.001', 18), // Montant minimal pour obtenir les infos du pool
      });

      // Calculer le range de ticks
      const { tickLower, tickUpper } = liquidityPositionService.calculateTickRange({
        currentTick: pool.pool.tick,
        tickSpacing: pool.pool.tickSpacing,
        rangePercent: params.lpRangePercent,
      });

      // Calculer les montants pour la position
      const amount0Desired = parseAmount('0.0005', 18); // Montant minimal
      const amount1Desired = parseAmount('0.0005', 18); // Montant minimal

      // Préparer les paramètres de création de position
      const createParams = {
        token0,
        token1,
        fee: pool.pool.fee,
        tickLower,
        tickUpper,
        amount0Desired,
        amount1Desired,
        amount0Min: 0n, // Pas de slippage pour le test
        amount1Min: 0n, // Pas de slippage pour le test
        recipient: state.wallet,
        deadline: Math.floor(Date.now() / 1000) + 600, // 10 minutes
      };

      // Créer la position LP
      const result = await liquidityPositionService.createPosition(createParams, params.privateKey, {
        dryRun: params.dryRun,
      });

      if (!result.success) {
        throw new Error(`Création de position LP échouée: ${result.error}`);
      }

      // Mettre à jour l'état avec le résultat
      state = this.stateManager.updateState(state, {
        currentStep: OrchestratorStep.LP_DONE,
        positionResult: {
          tokenId: result.tokenId || 0n,
          token0,
          token1,
          tickLower,
          tickUpper,
          liquidity: result.liquidity || 0n,
          amount0: result.amount0 || 0n,
          amount1: result.amount1 || 0n,
          txHash: result.txHash || '',
          success: true,
        },
      });

      logger.info({
        wallet: state.wallet,
        tokenId: result.tokenId?.toString(),
        token0,
        token1,
        tickLower,
        tickUpper,
        liquidity: result.liquidity?.toString(),
        txHash: result.txHash,
        message: 'Position LP créée avec succès'
      });

      return state;

    } catch (error) {
      logError(error, { wallet: state.wallet, step: 'lp' });
      
      return this.stateManager.updateState(state, {
        currentStep: OrchestratorStep.ERROR,
        positionResult: {
          tokenId: 0n,
          token0: '',
          token1: '',
          tickLower: 0,
          tickUpper: 0,
          liquidity: 0n,
          amount0: 0n,
          amount1: 0n,
          txHash: '',
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }
  }

  // Exécuter l'étape de collect
  private async executeCollectStep(
    state: OrchestratorState,
    params: OrchestratorParams
  ): Promise<OrchestratorState> {
    try {
      logger.info({
        wallet: state.wallet,
        message: 'Exécution de l\'étape Collect'
      });

      // Mettre à jour l'état
      state = this.stateManager.updateState(state, { currentStep: OrchestratorStep.COLLECT_PENDING });

      // Attendre le délai spécifié
      if (!params.dryRun) {
        const waitTime = params.collectAfterMinutes * 60 * 1000; // Convertir en ms
        logger.info({
          wallet: state.wallet,
          waitTime: params.collectAfterMinutes,
          message: 'Attente avant collecte des frais'
        });
        
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }

      // Obtenir le tokenId de la position
      const tokenId = state.positionResult?.tokenId;
      if (!tokenId) {
        throw new Error('TokenId de position non trouvé');
      }

      // Préparer les paramètres de collecte
      const collectParams = {
        tokenId,
        recipient: state.wallet,
        amount0Max: ethers.MaxUint256, // Collecter tous les frais
        amount1Max: ethers.MaxUint256, // Collecter tous les frais
      };

      // Collecter les frais
      const result = await liquidityPositionService.collectFees(collectParams, params.privateKey, {
        dryRun: params.dryRun,
      });

      if (!result.success) {
        throw new Error(`Collecte des frais échouée: ${result.error}`);
      }

      // Mettre à jour l'état avec le résultat
      state = this.stateManager.updateState(state, {
        currentStep: OrchestratorStep.COLLECT_DONE,
        collectResult: {
          tokenId,
          token0: state.positionResult?.token0 || '',
          token1: state.positionResult?.token1 || '',
          tickLower: state.positionResult?.tickLower || 0,
          tickUpper: state.positionResult?.tickUpper || 0,
          liquidity: 0n,
          amount0: result.amount0 || 0n,
          amount1: result.amount1 || 0n,
          txHash: result.txHash || '',
          success: true,
        },
      });

      logger.info({
        wallet: state.wallet,
        tokenId: tokenId.toString(),
        amount0: result.amount0?.toString(),
        amount1: result.amount1?.toString(),
        txHash: result.txHash,
        message: 'Frais collectés avec succès'
      });

      return state;

    } catch (error) {
      logError(error, { wallet: state.wallet, step: 'collect' });
      
      return this.stateManager.updateState(state, {
        currentStep: OrchestratorStep.ERROR,
        collectResult: {
          tokenId: 0n,
          token0: '',
          token1: '',
          tickLower: 0,
          tickUpper: 0,
          liquidity: 0n,
          amount0: 0n,
          amount1: 0n,
          txHash: '',
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }
  }

  // Obtenir l'adresse du wallet
  private async getWalletAddress(privateKey: string): Promise<string> {
    const signer = createSigner(privateKey, CONSTANTS.CHAIN_IDS.ABSTRACT);
    return await signer.getAddress();
  }

  // Vérifier les connexions RPC
  private async checkRpcConnections(): Promise<void> {
    const baseConnected = await withRetryRpc(async () => {
      const provider = getProvider(CONSTANTS.CHAIN_IDS.BASE);
      await provider.getBlockNumber();
      return true;
    });

    const abstractConnected = await withRetryRpc(async () => {
      const provider = getProvider(CONSTANTS.CHAIN_IDS.ABSTRACT);
      await provider.getBlockNumber();
      return true;
    });

    if (!baseConnected) {
      throw new Error('Connexion RPC Base échouée');
    }

    if (!abstractConnected) {
      throw new Error('Connexion RPC Abstract échouée');
    }

    logger.info({
      base: baseConnected,
      abstract: abstractConnected,
      message: 'Connexions RPC vérifiées'
    });
  }

  // Obtenir l'adresse du token de bridge
  private getBridgeTokenAddress(token: 'ETH' | 'USDC', chain: 'source' | 'destination'): string {
    switch (token) {
      case 'ETH':
        return CONSTANTS.NATIVE_ADDRESS; // ETH natif sur Base
      case 'USDC':
        if (chain === 'source') {
          // USDC sur Base (source)
          return CONSTANTS.TOKENS.USDC_BASE;
        } else {
          // USDC sur Abstract (destination)
          return CONSTANTS.TOKENS.USDC;
        }
      default:
        throw new Error(`Token de bridge non supporté: ${token}`);
    }
  }

  // Obtenir le montant avec les bonnes décimales selon le token
  private getBridgeAmount(token: 'ETH' | 'USDC', amount: string): string {
    // Retourner le montant humain tel quel - la conversion se fera dans LiFiClient
    return amount;
  }

  // Obtenir les tokens pour le swap
  private getSwapTokens(bridgeToken: 'ETH' | 'USDC', swapPair: 'PENGU/ETH' | 'PENGU/USDC'): { tokenIn: string; tokenOut: string } {
    // Corriger : utiliser WETH au lieu d'ETH natif pour les swaps Uniswap v3
    const tokenIn = bridgeToken === 'ETH' ? CONSTANTS.TOKENS.WETH : CONSTANTS.TOKENS.USDC;
    const tokenOut = CONSTANTS.TOKENS.PENGU; // Toujours PENGU en sortie
    
    logger.info({
      bridgeToken,
      swapPair,
      tokenIn,
      tokenOut,
      message: 'Tokens de swap déterminés (ETH→WETH pour v3)'
    });
    
    return { tokenIn, tokenOut };
  }

  // Obtenir les tokens pour la position LP
  private getLpTokens(swapPair: 'PENGU/ETH' | 'PENGU/USDC'): { token0: string; token1: string } {
    if (swapPair === 'PENGU/ETH') {
      // Corriger : utiliser WETH au lieu d'ETH natif pour les pools v3
      return {
        token0: CONSTANTS.TOKENS.PENGU,
        token1: CONSTANTS.TOKENS.WETH,
      };
    } else {
      return {
        token0: CONSTANTS.TOKENS.PENGU,
        token1: CONSTANTS.TOKENS.USDC,
      };
    }
  }

  // Calculer les métriques
  private async calculateMetrics(
    state: OrchestratorState,
    startTime: number
  ): Promise<OrchestratorMetrics> {
    const totalDuration = Date.now() - startTime;
    
    // Calculer les frais collectés
    const totalFeesCollected = {
      token0: state.collectResult?.token0 || '',
      amount0: state.collectResult?.amount0 || 0n,
      token1: state.collectResult?.token1 || '',
      amount1: state.collectResult?.amount1 || 0n,
    };

    // Calculer le PnL (simplifié)
    const pnl = {
      token0: totalFeesCollected.amount0,
      token1: totalFeesCollected.amount1,
    };

    const metrics: OrchestratorMetrics = {
      totalFeesCollected,
      totalGasUsed: 0n, // TODO: Calculer le gas total utilisé
      totalDuration,
      pnl,
    };

    // Logger les métriques
    logMetrics({
      wallet: state.wallet,
      currentStep: state.currentStep,
      totalDuration,
      feesCollected: {
        token0: totalFeesCollected.amount0.toString(),
        token1: totalFeesCollected.amount1.toString(),
      },
    });

    return metrics;
  }
}

// Instance singleton de l'orchestrateur
export const orchestratorService = new OrchestratorService();
