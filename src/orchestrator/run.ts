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
import { costsReporter } from '../services/costs.js';
import { buildContext, type BotContext } from '../core/context.js';
import { stateManager } from './state.js';
import { MAX_UINT128 } from '../config/nums.js';
import { CollectStatus } from '../core/collect-status.js';
import { WalletManager } from '../core/wallet-manager.js';
import { createMultiWalletOrchestrator, type MultiWalletOrchestratorConfig } from './multi-wallet-orchestrator.js';
import type { 
  OrchestratorParams, 
  OrchestratorDirectParams,
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

  /**
   * Déterminer si on doit utiliser le mode multi-wallet
   */
  private shouldUseMultiWallet(): boolean {
    return !!(
      cfg.MNEMONIC && 
      cfg.BYBIT_API_KEY && 
      cfg.BYBIT_API_SECRET && 
      cfg.HUB_WALLET_PRIVATE_KEY
    );
  }

  // Exécuter le flow complet (single-wallet ou multi-wallet)
  async run(params: OrchestratorParams): Promise<OrchestratorResult> {
    // Vérifier si on est en mode multi-wallet
    if (this.shouldUseMultiWallet()) {
      return await this.runMultiWallet(params);
    }
    
    // Mode single-wallet (comportement original)
    return await this.runSingleWallet(params);
  }

  // Exécuter le flow multi-wallet
  private async runMultiWallet(params: OrchestratorParams): Promise<OrchestratorResult> {
    const startTime = Date.now();
    
    try {
      logger.info({
        walletCount: cfg.WALLET_COUNT,
        message: 'Démarrage du mode multi-wallet'
      });

      // Configuration de distribution
      const distributionConfig: any = {
        bybit: {
          apiKey: cfg.BYBIT_API_KEY!,
          apiSecret: cfg.BYBIT_API_SECRET!,
          sandbox: cfg.BYBIT_SANDBOX,
          testnet: cfg.BYBIT_TESTNET,
        },
        hubWalletPrivateKey: cfg.HUB_WALLET_PRIVATE_KEY!,
        tokens: {
          usdc: {
            amountPerWallet: cfg.DISTRIBUTION_USDC_PER_WALLET,
            totalAmount: cfg.DISTRIBUTION_USDC_PER_WALLET * cfg.WALLET_COUNT,
          },
          eth: {
            amountPerWallet: cfg.DISTRIBUTION_ETH_PER_WALLET,
            totalAmount: cfg.DISTRIBUTION_ETH_PER_WALLET * cfg.WALLET_COUNT,
          },
        },
        walletCount: cfg.WALLET_COUNT,
        randomizeAmounts: cfg.DISTRIBUTION_RANDOMIZE_AMOUNTS,
        minAmountVariation: cfg.DISTRIBUTION_VARIATION_PERCENT / 100,
        chainId: CONSTANTS.CHAIN_IDS.ABSTRACT,
        batchSize: 10,
      };

      // Configuration de l'orchestrateur multi-wallet
      const multiWalletConfig: MultiWalletOrchestratorConfig = {
        distributionConfig,
        walletCount: cfg.WALLET_COUNT,
        mnemonic: cfg.MNEMONIC!,
        sequential: true, // Commencer par séquentiel pour la stabilité
        maxConcurrentWallets: 5,
        defiParams: {
          bridgeAmount: params.bridgeAmount,
          bridgeToken: params.bridgeToken,
          swapAmount: params.swapAmount,
          swapPair: params.swapPair,
          lpRangePercent: params.lpRangePercent,
          collectAfterMinutes: params.collectAfterMinutes,
          dryRun: params.dryRun,
          autoGasTopUp: params.autoGasTopUp,
          minNativeOnDest: params.minNativeOnDest,
          gasTopUpTarget: params.gasTopUpTarget,
          routerOverride: params.routerOverride,
          npmOverride: params.npmOverride,
          factoryOverride: params.factoryOverride,
          autoTokenTopUp: params.autoTokenTopUp,
          tokenTopUpSafetyBps: params.tokenTopUpSafetyBps,
          tokenTopUpMin: params.tokenTopUpMin,
          tokenTopUpSourceChainId: params.tokenTopUpSourceChainId,
          tokenTopUpMaxWaitSec: params.tokenTopUpMaxWaitSec,
          swapEngine: params.swapEngine,
        },
      };

      // Créer et exécuter l'orchestrateur multi-wallet
      const multiWalletOrchestrator = createMultiWalletOrchestrator(multiWalletConfig);
      const multiWalletResult = await multiWalletOrchestrator.execute();

      // Convertir le résultat multi-wallet en format OrchestratorResult
      const result: OrchestratorResult = {
        success: multiWalletResult.success,
        state: {
          wallet: `multi-wallet-${cfg.WALLET_COUNT}`,
          currentStep: multiWalletResult.success ? OrchestratorStep.COLLECT_DONE : OrchestratorStep.ERROR,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        metrics: {
          totalFeesCollected: { token0: '', amount0: 0n, token1: '', amount1: 0n },
          totalGasUsed: 0n,
          totalDuration: Date.now() - startTime,
          pnl: { token0: 0n, token1: 0n },
        },
      };

      if (!multiWalletResult.success) {
        result.error = `Multi-wallet failed: ${multiWalletResult.errors.join(', ')}`;
      }

      logger.info({
        totalWallets: multiWalletResult.totalWallets,
        successfulWallets: multiWalletResult.successfulWallets,
        failedWallets: multiWalletResult.failedWallets,
        duration: Date.now() - startTime,
        message: 'Mode multi-wallet terminé'
      });

      return result;

    } catch (error) {
      logError(error, { 
        message: 'Erreur dans le mode multi-wallet'
      });

      return {
        success: false,
        state: {
          wallet: 'multi-wallet',
          currentStep: OrchestratorStep.ERROR,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // Exécuter le flow single-wallet (comportement original)
  private async runSingleWallet(params: OrchestratorParams): Promise<OrchestratorResult> {
    const startTime = Date.now();
    
    try {
      // Créer le contexte centralisé
      const context = buildContext({
        privateKey: params.privateKey,
        autoGasTopUp: params.autoGasTopUp,
        fresh: false, // Géré par le CLI
        dryRun: params.dryRun,
        minNativeOnDest: params.minNativeOnDest,
        gasTopUpTarget: params.gasTopUpTarget,
        routerOverride: params.routerOverride,
        npmOverride: params.npmOverride,
        factoryOverride: params.factoryOverride,
        autoTokenTopUp: params.autoTokenTopUp,
        tokenTopUpSafetyBps: params.tokenTopUpSafetyBps,
        tokenTopUpMin: params.tokenTopUpMin,
        tokenTopUpSourceChainId: params.tokenTopUpSourceChainId,
        tokenTopUpMaxWaitSec: params.tokenTopUpMaxWaitSec,
      });

      logger.info({
        wallet: context.walletAddress,
        signer: context.walletAddress,
        dryRun: context.dryRun,
        bridgeAmount: params.bridgeAmount,
        bridgeToken: params.bridgeToken,
        swapAmount: params.swapAmount,
        swapPair: params.swapPair,
        lpRangePercent: params.lpRangePercent,
        collectAfterMinutes: params.collectAfterMinutes,
        autoGasTopUp: context.autoGasTopUp,
        message: 'Démarrage de l\'orchestrateur'
      });

      // Log de debug pour vérifier le contexte
      logger.info({
        contextDryRun: context.dryRun,
        paramsDryRun: params.dryRun,
        message: 'DEBUG: Vérification du contexte dryRun'
      });

      // Charger ou créer l'état
      let state = this.stateManager.loadState(context.walletAddress) || this.stateManager.createState(context.walletAddress);

      // Initialiser le reporter de coûts
      await costsReporter.initializeBalances(context.walletAddress);

      // Vérifier la connexion RPC
      await this.checkRpcConnections();

      // Exécuter les étapes selon l'état actuel
      state = await this.executeSteps(state, params, context);

      // Calculer les métriques
      const metrics = await this.calculateMetrics(state, startTime);

      // Générer le rapport de coûts
      await costsReporter.generateReport(context.walletAddress, state);

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
      currentState = await this.executeBridgeStep(currentState, params, context);
    }

    // Étape 2: Swap (si bridge terminé)
    if (currentState.currentStep === 'bridge_done' || currentState.currentStep === 'swap_pending') {
      currentState = await this.executeSwapStep(currentState, params, context);
    }

    // Étape 3: LP (si swap terminé)
    if (currentState.currentStep === 'swap_done' || currentState.currentStep === 'lp_pending') {
      currentState = await this.executeLpStep(currentState, params, context, params.privateKey);
    }

    // Étape 4: Collect (si LP terminé)
    if (currentState.currentStep === 'lp_done' || currentState.currentStep === 'collect_pending') {
      currentState = await this.executeCollectStep(currentState, params, context);
    }

    return currentState;
  }

  // Exécuter l'étape de bridge
  private async executeBridgeStep(
    state: OrchestratorState,
    params: OrchestratorParams,
    context: BotContext
  ): Promise<OrchestratorState> {
    // Vérifier si auto token top-up nécessaire AVANT le bridge manuel
    if (params.bridgeToken === "USDC" && context.autoTokenTopUp) {
      const tokenIn = CONSTANTS.TOKENS.USDC[CONSTANTS.CHAIN_IDS.ABSTRACT];
      if (tokenIn) {
        const abstractProvider = getProvider(CONSTANTS.CHAIN_IDS.ABSTRACT);
        const tokenInContract = new ethers.Contract(tokenIn, ERC20_MIN_ABI, abstractProvider);
        const balance = await tokenInContract.balanceOf(state.wallet);
        const decimals = await tokenInContract.decimals();
        const requiredAmount = ethers.parseUnits(params.swapAmount, decimals);
        const gasBuffer = ethers.parseUnits("0.001", decimals);
        
        const missing = requiredAmount + gasBuffer - balance;
        if (missing > 0n) {
          logger.info({
            missing: ethers.formatUnits(missing, decimals),
            message: 'Auto token top-up nécessaire AVANT bridge manuel'
          });
          
          await this.executeTokenTopUp(state, params, context, tokenIn, missing, decimals, requiredAmount, gasBuffer);
          
          // Après l'auto top-up, ignorer le bridge manuel
          logger.info({
            message: 'Bridge manuel ignoré car auto token top-up exécuté'
          });
          return {
            ...state,
            currentStep: OrchestratorStep.BRIDGE_DONE,
            updatedAt: Date.now()
          };
        }
      }
    }
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
          currentStep: OrchestratorStep.BRIDGE_DONE,
          updatedAt: Date.now()
        };
      }

      // Obtenir la route de bridge
      const route = await bridgeService.getBridgeRoute(bridgeParams);

      // Vérifier le montant minimum USD
      const fromUsd = parseFloat(route.fromAmount) / Math.pow(10, route.fromToken.decimals) || parseFloat(params.bridgeAmount); // Fallback sur bridgeAmount
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
      if (route.steps?.[0]?.minAmount || route.steps?.[0]?.minAmountUSD) {
        logger.info({
          minAmount: route.steps[0].minAmount,
          minAmountUSD: route.steps[0].minAmountUSD,
          message: "Montant minimum requis par la route"
        });
      }

      // Exécuter le bridge
      const result = await bridgeService.executeRoute(route, params.privateKey, {
        dryRun: context.dryRun,
      });

      if (!result.success) {
        throw new Error(`Bridge échoué: ${result.error}`);
      }

      // En mode réel, attendre que le bridge soit reçu sur Abstract
      if (!context.dryRun && result.txHash) {
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

  // Exécuter l'auto token top-up
  private async executeTokenTopUp(
    state: OrchestratorState,
    params: OrchestratorParams,
    context: BotContext,
    tokenIn: string,
    missing: bigint,
    decimals: number,
    requiredAmount: bigint,
    gasBuffer: bigint
  ): Promise<void> {
    try {
      // Vérifier si déjà complété
      if (state.tokenTopUp?.completed) {
        logger.info({
          message: 'Token top-up déjà complété, passage au swap'
        });
        return;
      }

      // Si une route est en cours, reprendre l'attente
      if (state.tokenTopUp?.routeId && !state.tokenTopUp?.completed) {
        logger.info({
          routeId: state.tokenTopUp.routeId,
          message: 'Reprise de l\'attente du bridge en cours'
        });
        
        const startWait = Date.now();
        let completed = false;
        
        while (!completed && (Date.now() - startWait) < context.tokenTopUpMaxWaitSec * 1000) {
          await new Promise(resolve => setTimeout(resolve, 5000));
          
          const status = await bridgeService.getRouteStatus(state.tokenTopUp.routeId || '');
          logger.info({
            status: status.status,
            message: 'Reprise - Attente confirmation bridge Li.Fi'
          });
          
          if (status.status === 'DONE') {
            completed = true;
            logger.info({
              status: 'DONE',
              message: 'Bridge USDC auto top-up reçu (reprise)'
            });
          } else if (status.status === 'FAILED') {
            throw new Error(`Bridge USDC auto top-up échoué (reprise): ${status.status}`);
          }
        }

        if (!completed) {
          throw new Error(`Timeout du bridge USDC auto top-up (reprise) après ${context.tokenTopUpMaxWaitSec}s`);
        }

        // Mettre à jour l'état comme complété
        state = this.stateManager.updateState(state, {
          tokenTopUp: {
            ...state.tokenTopUp,
            completed: true
          }
        });
        return;
      }

      // Calculer le montant avec marge de sécurité
      const safetyMultiplier = 10000n + BigInt(context.tokenTopUpSafetyBps);
      const missingWithSafety = (missing * safetyMultiplier) / 10000n;
      
      // Vérifier le seuil minimum
      const minAmount = ethers.parseUnits(context.tokenTopUpMin, decimals);
      
      logger.info({
        missing: ethers.formatUnits(missing, decimals),
        missingWithSafety: ethers.formatUnits(missingWithSafety, decimals),
        minAmount: ethers.formatUnits(minAmount, decimals),
        missingWei: missing.toString(),
        missingWithSafetyWei: missingWithSafety.toString(),
        minAmountWei: minAmount.toString(),
        message: 'DEBUG: Calculs de top-up'
      });
      
      if (missingWithSafety < minAmount) {
        logger.info({
          missing: ethers.formatUnits(missing, decimals),
          missingWithSafety: ethers.formatUnits(missingWithSafety, decimals),
          minAmount: ethers.formatUnits(minAmount, decimals),
          message: 'Montant manquant trop faible pour déclencher le top-up'
        });
        return;
      }

      logger.info({
        token: 'USDC',
        fromChainId: context.tokenTopUpSourceChainId,
        toChainId: CONSTANTS.CHAIN_IDS.ABSTRACT,
        amount: ethers.formatUnits(missingWithSafety, decimals),
        message: 'Démarrage auto top-up token'
      });

      if (context.dryRun) {
        logger.info({
          missing: ethers.formatUnits(missing, decimals),
          missingWithSafety: ethers.formatUnits(missingWithSafety, decimals),
          fromChainId: context.tokenTopUpSourceChainId,
          toChainId: CONSTANTS.CHAIN_IDS.ABSTRACT,
          message: 'DRY_RUN: Token top-up USDC simulé'
        });
        
        // Mettre à jour l'état en mode dry-run
        state = this.stateManager.updateState(state, {
          tokenTopUp: {
            enabled: true,
            token: 'USDC',
            requested: ethers.formatUnits(missingWithSafety, decimals),
            bridged: ethers.formatUnits(missingWithSafety, decimals),
            fromChainId: context.tokenTopUpSourceChainId,
            toChainId: CONSTANTS.CHAIN_IDS.ABSTRACT,
            completed: true
          }
        });
        return;
      }

      // Calculer le fromAmount pour garantir le toAmount requis
      let targetTo = missingWithSafety;
      let fromAmount = missingWithSafety; // Premier essai naïf
      let chosenRoute = null;
      
      for (let i = 0; i < 3; i++) {
        const route = await bridgeService.quoteBaseToAbstract({
          fromChain: context.tokenTopUpSourceChainId,
          toChain: CONSTANTS.CHAIN_IDS.ABSTRACT,
          fromToken: CONSTANTS.TOKENS.USDC[context.tokenTopUpSourceChainId],
          toToken: CONSTANTS.TOKENS.USDC[CONSTANTS.CHAIN_IDS.ABSTRACT],
          fromAmountHuman: ethers.formatUnits(fromAmount, decimals),
          fromAddress: state.wallet
        });

        if (!route) {
          throw new Error('Aucune route Li.Fi trouvée pour le token top-up');
        }

        const estimatedTo = BigInt(route.toAmount || 0);
        
        logger.info({
          iteration: i + 1,
          fromAmount: ethers.formatUnits(fromAmount, decimals),
          estimatedTo: ethers.formatUnits(estimatedTo, decimals),
          targetTo: ethers.formatUnits(targetTo, decimals),
          message: 'Calcul fromAmount pour garantir toAmount'
        });

        if (estimatedTo >= targetTo) {
          chosenRoute = route;
          break;
        }

        // Scale factor + buffer de sécurité
        const scale = (Number(targetTo) / Number(estimatedTo)) * (1 + context.tokenTopUpSafetyBps / 10000);
        fromAmount = BigInt(Math.ceil(Number(fromAmount) * scale));
      }

      if (!chosenRoute) {
        throw new Error('Impossible de garantir le toAmount pour le top-up USDC après 3 tentatives');
      }

      const route = chosenRoute;

      logger.info({
        routeId: route.id,
        fromToken: route.fromToken?.symbol || 'USDC',
        toToken: route.toToken?.symbol || 'USDC',
        fromAmount: ethers.formatUnits(missingWithSafety, decimals),
        toAmount: ethers.formatUnits(BigInt(route.estimate?.toAmount || 0), decimals),
        message: 'Route USDC auto top-up obtenue'
      });

      // Approbation si nécessaire
      if (route.transactionRequest?.data && route.transactionRequest?.to) {
        logger.info({
          tokenAddress: CONSTANTS.TOKENS.USDC[context.tokenTopUpSourceChainId],
          spender: route.transactionRequest.to,
          message: 'Approbation requise'
        });

        const baseSigner = createSigner(params.privateKey, context.tokenTopUpSourceChainId);
        await bridgeService.executeApproval(
          CONSTANTS.TOKENS.USDC[context.tokenTopUpSourceChainId],
          route.transactionRequest.to,
          ethers.formatUnits(missingWithSafety, decimals),
          baseSigner
        );

        logger.info({
          message: 'Approbation confirmée'
        });
      }

      // Exécuter le bridge
      logger.info({
        to: route.transactionRequest?.to,
        value: route.transactionRequest?.value,
        dataLength: route.transactionRequest?.data?.length,
        message: 'Exécution transaction bridge Li.Fi'
      });

      const bridgeTx = await bridgeService.executeRoute(
        route,
        params.privateKey,
        { dryRun: false }
      );

      logger.info({
        txHash: bridgeTx.txHash,
        message: 'Transaction bridge confirmée'
      });

      // Attendre la finalisation
      const startWait = Date.now();
      let completed = false;
      
      while (!completed && (Date.now() - startWait) < context.tokenTopUpMaxWaitSec * 1000) {
        await new Promise(resolve => setTimeout(resolve, 5000)); // Attendre 5 secondes
        
        const status = await bridgeService.getRouteStatus(route.id || '');
        logger.info({
          status: status.status,
          message: 'Attente confirmation bridge Li.Fi'
        });
        
        if (status.status === 'DONE') {
          completed = true;
          logger.info({
            status: 'DONE',
            message: 'Bridge USDC auto top-up reçu'
          });
        } else if (status.status === 'FAILED') {
          throw new Error(`Bridge USDC auto top-up échoué: ${status.status}`);
        }
      }

      if (!completed) {
        throw new Error(`Timeout du bridge USDC auto top-up après ${context.tokenTopUpMaxWaitSec}s`);
      }

      // Poll du solde USDC Abstract jusqu'à ce qu'il soit suffisant
      logger.info({
        message: 'Vérification du solde USDC après bridge'
      });

      const deadline = Date.now() + context.tokenTopUpMaxWaitSec * 1000;
      let finalBalance = 0n;
      
      while (Date.now() < deadline) {
        const abstractProvider = getProvider(CONSTANTS.CHAIN_IDS.ABSTRACT);
        const tokenInContract = new ethers.Contract(tokenIn, ERC20_MIN_ABI, abstractProvider);
        finalBalance = await tokenInContract.balanceOf(state.wallet);
        
        if (finalBalance >= requiredAmount + gasBuffer) {
          logger.info({
            finalBalance: ethers.formatUnits(finalBalance, decimals),
            required: ethers.formatUnits(requiredAmount + gasBuffer, decimals),
            message: 'Solde USDC suffisant après bridge'
          });
          break;
        }
        
        logger.info({
          currentBalance: ethers.formatUnits(finalBalance, decimals),
          required: ethers.formatUnits(requiredAmount + gasBuffer, decimals),
          message: 'Attente du solde USDC après bridge'
        });
        
        await new Promise(resolve => setTimeout(resolve, 5000)); // Attendre 5 secondes
      }

      if (finalBalance < requiredAmount + gasBuffer) {
        throw new Error(`Solde USDC insuffisant après bridge: ${ethers.formatUnits(finalBalance, decimals)} < ${ethers.formatUnits(requiredAmount + gasBuffer, decimals)}`);
      }

      // Mettre à jour l'état
      state = this.stateManager.updateState(state, {
        tokenTopUp: {
          enabled: true,
          token: 'USDC',
          requested: ethers.formatUnits(missingWithSafety, decimals),
          bridged: ethers.formatUnits(BigInt(route.estimate?.toAmount || 0), decimals),
          fromChainId: context.tokenTopUpSourceChainId,
          toChainId: CONSTANTS.CHAIN_IDS.ABSTRACT,
          txHash: bridgeTx.txHash,
          routeId: route.id,
          completed: true
        }
      });

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        message: 'Erreur lors de l\'auto token top-up'
      });
      throw error;
    }
  }

  // Exécuter l'étape de swap
  public async executeSwapStep(
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

      // Vérifier le solde après le bridge/auto top-up
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
        if (!context.dryRun) {
          const gasCheck = await GasService.checkNativeBalance(state.wallet, CONSTANTS.CHAIN_IDS.ABSTRACT);
          if (!gasCheck.sufficient) {
            throw new Error(`Solde gas natif insuffisant après top-up: ${gasCheck.balanceEth} ETH`);
          }
        }
      } else {
        // Vérifier sans top-up automatique
        if (!context.dryRun) {
          const gasCheck = await GasService.checkNativeBalance(state.wallet, CONSTANTS.CHAIN_IDS.ABSTRACT);
          if (!gasCheck.sufficient) {
            throw new Error(
              `Solde gas natif insuffisant sur Abstract: ${gasCheck.balanceEth} ETH. ` +
              `Veuillez bridger ~${ethers.formatEther(targetWei)} ETH pour le gas ` +
              `ou activez --autoGasTopUp true.`
            );
          }
        }
      }

      // Préparer les paramètres de swap
      const swapParams = {
        tokenIn,
        tokenOut,
        amountIn: BigInt(ethers.parseUnits(params.swapAmount, 6)), // Convertir en wei
        slippageBps: cfg.SWAP_SLIPPAGE_BPS,
        recipient: state.wallet,
      };

      // Exécuter le swap
      const result = await swapService.executeSwap(swapParams, params.privateKey, {
        dryRun: context.dryRun,
        swapEngine: params.swapEngine,
        routerOverride: context.routerOverride,
        npmOverride: context.npmOverride,
        factoryOverride: context.factoryOverride,
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
          gasUsed: '0', // gasUsed sera calculé ailleurs
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
  public async executeLpStep(
    state: OrchestratorState,
    params: OrchestratorParams,
    context: BotContext,
    privateKey: string
  ): Promise<OrchestratorState> {
    try {
      logger.info({
        wallet: state.wallet,
        message: 'Exécution de l\'étape LP'
      });

      // Mettre à jour l'état
      state = this.stateManager.updateState(state, { currentStep: OrchestratorStep.LP_PENDING });

      // Déterminer les tokens pour la position LP
      const { tokenA, tokenB } = this.getLpTokens(params.swapPair);

      // Obtenir les informations du pool
      const pool = await swapService.getQuote({
        tokenIn: tokenA,
        tokenOut: tokenB,
        amountIn: parseAmount('0.001', 18), // Montant minimal pour obtenir les infos du pool
      });

      // CORRECTION: Utiliser l'ordre du pool (token0 < token1 lexicographiquement)
      const token0 = pool.pool.token0;
      const token1 = pool.pool.token1;
      const poolToken0 = token0;
      const poolToken1 = token1;
      
      logger.info({
        tokenA,
        tokenB,
        poolToken0: token0,
        poolToken1: token1,
        message: 'Ordre des tokens déterminé depuis le pool'
      });

      // CORRECTION: Calculer le range de ticks avec la bonne logique
      const tickSpacing = pool.pool.tickSpacing;
      const currentTick = pool.pool.tick;
      
      // Calculer le delta pour ±5% (ou le range spécifié)
      const rangePercent = params.lpRangePercent / 100; // Convertir en décimal
      const delta = Math.round(Math.log(1 + rangePercent) / Math.log(1.0001)); // ~487 pour 5%
      
      const rawLower = currentTick - delta;
      const rawUpper = currentTick + delta;
      const tickLower = Math.floor(rawLower / tickSpacing) * tickSpacing;
      const tickUpper = Math.ceil(rawUpper / tickSpacing) * tickSpacing;

      logger.info({
        currentTick,
        tickSpacing,
        rangePercent: params.lpRangePercent,
        delta,
        tickLower,
        tickUpper,
        message: 'Range de ticks calculé'
      });

      // CORRECTION: Utiliser les balances réelles après le swap
      const provider = getProvider(CONSTANTS.CHAIN_IDS.ABSTRACT);
      const signer = new ethers.Wallet(privateKey, provider);
      
      // Obtenir les décimales des tokens
      const decimals0 = await this.getTokenDecimals(token0);
      const decimals1 = await this.getTokenDecimals(token1);
      
      // Obtenir les balances réelles
      const balance0 = await this.getTokenBalance(token0, state.wallet, signer);
      const balance1 = await this.getTokenBalance(token1, state.wallet, signer);
      
      // Utiliser 50% de chaque balance disponible
      const amount0Desired = balance0 / 2n;
      const amount1Desired = balance1 / 2n;
      
      // Guard: éviter de mint avec des montants à 0
      if (amount0Desired === 0n && amount1Desired === 0n) {
        if (context.dryRun) {
          logger.info({
            token0: poolToken0,
            token1: poolToken1,
            fee: pool.pool.fee,
            tickLower,
            tickUpper,
            message: 'DRY_RUN: Position LP simulée (montants à zéro)'
          });
          
          // Simuler la création pour laisser la chaîne se poursuivre
          state = this.stateManager.updateState(state, {
            currentStep: OrchestratorStep.LP_DONE,
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
              success: true,
              gasUsed: '0'
            }
          });
          
          return state;
        }
        
        logger.warn({
          message: 'Montants LP à zéro - skip mint',
          balance0: balance0.toString(),
          balance1: balance1.toString()
        });
        throw new Error('Impossible de créer une position LP: balances insuffisantes');
      }
      
      logger.info({
        token0,
        token1,
        decimals0,
        decimals1,
        balance0: balance0.toString(),
        balance1: balance1.toString(),
        amount0Desired: amount0Desired.toString(),
        amount1Desired: amount1Desired.toString(),
        message: 'Montants LP calculés depuis les balances réelles'
      });

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
        dryRun: context.dryRun,
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
          gasUsed: '0', // gasUsed sera calculé ailleurs
        },
      });

      // Sauvegarder les données de la position dans l'état
      if (result.tokenId) {
        stateManager.saveStepData('lp', {
          tokenId: result.tokenId.toString(),
          tickLower: tickLower.toString(),
          tickUpper: tickUpper.toString(),
          token0,
          token1,
        });
      }

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

  // Helper pour obtenir les décimales d'un token
  private async getTokenDecimals(tokenAddress: string): Promise<number> {
    if (/^0x0{40}$/i.test(tokenAddress)) return 18; // ETH natif
    const provider = getProvider(CONSTANTS.CHAIN_IDS.ABSTRACT);
    const erc20 = new ethers.Contract(tokenAddress, ERC20_MIN_ABI, provider);
    return await erc20.decimals();
  }

  // Helper pour obtenir le solde d'un token
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

  // Exécuter l'étape de collect
  public async executeCollectStep(
    state: OrchestratorState,
    params: OrchestratorParams,
    context: BotContext
  ): Promise<OrchestratorState> {
    try {
      logger.info({
        wallet: state.wallet,
        message: 'Exécution de l\'étape Collect'
      });

      // Mettre à jour l'état
      state = this.stateManager.updateState(state, { currentStep: OrchestratorStep.COLLECT_PENDING });

      // Attendre le délai spécifié
      if (!context.dryRun) {
        const waitTime = params.collectAfterMinutes * 60 * 1000; // Convertir en ms
        logger.info({
          wallet: state.wallet,
          waitTime: params.collectAfterMinutes,
          message: 'Attente avant collecte des frais'
        });
        
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }

      // Obtenir le tokenId de la position
      let tokenId = state.positionResult?.tokenId;
      
      // Si pas dans positionResult, essayer de le lire depuis les données sauvegardées
      if (!tokenId) {
        const lpData = stateManager.getStepData('lp');
        if (lpData?.tokenId) {
          tokenId = BigInt(lpData.tokenId);
        }
      }
      
      if (!context.dryRun && !tokenId) {
        throw new Error('TokenId de position non trouvé dans l\'état. Assurez-vous qu\'une position LP a été créée.');
      }

      // Préparer les paramètres de collecte
      if (!tokenId && !context.dryRun) {
        throw new Error('TokenId de position LP manquant');
      }

      const collectParams = {
        tokenId: context.dryRun ? 0n : tokenId!,
        recipient: state.wallet,
        amount0Max: MAX_UINT128, // Collecter tous les frais
        amount1Max: MAX_UINT128, // Collecter tous les frais
      };

      // Collecter les frais
      const result = await liquidityPositionService.collectFees(collectParams, params.privateKey, {
        dryRun: context.dryRun,
      });

      // Mapper le statut de collecte
      let collectStatus: CollectStatus;
      if (result.status === 'collect_skipped') {
        collectStatus = 'collect_skipped';
      } else if (result.status === 'collect_executed') {
        collectStatus = 'collect_executed';
      } else {
        collectStatus = 'collect_failed';
        throw new Error(`Collecte des frais échouée: ${result.status}`);
      }

      // Mettre à jour l'état avec le résultat
      const finalStep = collectStatus === 'collect_skipped' ? OrchestratorStep.COLLECT_DONE : OrchestratorStep.COLLECT_DONE;
      state = this.stateManager.updateState(state, {
        currentStep: finalStep,
        collectResult: {
          tokenId: tokenId!,
          token0: state.positionResult?.token0 || '',
          token1: state.positionResult?.token1 || '',
          tickLower: state.positionResult?.tickLower || 0,
          tickUpper: state.positionResult?.tickUpper || 0,
          liquidity: 0n,
          amount0: result.amount0,
          amount1: result.amount1,
          txHash: result.txHash || '',
          success: true,
          gasUsed: '0', // gasUsed sera calculé ailleurs
        },
      });

      logger.info({
        wallet: state.wallet,
        tokenId: tokenId?.toString(),
        amount0: result.amount0.toString(),
        amount1: result.amount1.toString(),
        txHash: result.txHash,
        status: collectStatus,
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
    const signer = await createSigner(privateKey, CONSTANTS.CHAIN_IDS.ABSTRACT);
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
  private getLpTokens(swapPair: 'PENGU/ETH' | 'PENGU/USDC'): { tokenA: string; tokenB: string } {
    if (swapPair === 'PENGU/ETH') {
      // Corriger : utiliser WETH au lieu d'ETH natif pour les pools v3
      return {
        tokenA: CONSTANTS.TOKENS.PENGU,
        tokenB: CONSTANTS.TOKENS.WETH,
      };
    } else {
      return {
        tokenA: CONSTANTS.TOKENS.PENGU,
        tokenB: CONSTANTS.TOKENS.USDC,
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

  // Exécuter le mode direct (LP → Collect sans bridge/swap)
  async runDirect(params: OrchestratorDirectParams): Promise<OrchestratorResult> {
    const startTime = Date.now();
    
    try {
      // Créer le contexte centralisé
      const context = buildContext({
        privateKey: params.privateKey,
        autoGasTopUp: params.autoGasTopUp,
        fresh: false,
        dryRun: params.dryRun,
        minNativeOnDest: params.minNativeOnDest,
        gasTopUpTarget: params.gasTopUpTarget,
      });

      // Créer le signer pour obtenir l'adresse du wallet
      const signer = await createSigner(params.privateKey, CONSTANTS.CHAIN_IDS.ABSTRACT);
      const wallet = await signer.getAddress();

      logger.info({
        wallet,
        signer: wallet,
        dryRun: params.dryRun,
        pair: params.pair,
        amount0: params.amount0,
        amount1: params.amount1,
        rangePercent: params.rangePercent,
        collectAfterMinutes: params.collectAfterMinutes,
        autoGasTopUp: params.autoGasTopUp,
        message: 'Démarrage du mode LP direct'
      });

      // Charger ou créer l'état
      let state = this.stateManager.loadState(wallet);
      if (!state) {
        state = this.stateManager.createState(wallet);
        logger.info({
          wallet,
          message: 'Nouvel état créé pour le mode direct'
        });
      }

      // Vérifier les connexions RPC
      const baseProvider = getProvider(CONSTANTS.CHAIN_IDS.BASE);
      const abstractProvider = getProvider(CONSTANTS.CHAIN_IDS.ABSTRACT);
      
      const [baseConnected, abstractConnected] = await Promise.all([
        withRetryRpc(async () => {
          await baseProvider.getBlockNumber();
          return true;
        }),
        withRetryRpc(async () => {
          await abstractProvider.getBlockNumber();
          return true;
        })
      ]);

      logger.info({
        base: baseConnected,
        abstract: abstractConnected,
        message: 'Connexions RPC vérifiées'
      });

      // Exécuter l'étape LP direct
      state = await this.executeDirectLpStep(state, params, context);

      // Exécuter l'étape collecte directe
      state = await this.executeDirectCollectStep(state, params, context);

      // Calculer les métriques
      const metrics = this.calculateDirectMetrics(state, startTime);

      logger.info({
        wallet,
        currentStep: state.currentStep,
        totalDuration: metrics.totalDuration,
        message: 'Mode LP direct terminé avec succès'
      });

      return {
        success: true,
        state,
        metrics,
      };

    } catch (error) {
      logError(error, { 
        pair: params.pair,
        amount0: params.amount0,
        amount1: params.amount1,
      });
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        state: {
          wallet: '',
          currentStep: OrchestratorStep.ERROR,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      };
    }
  }

  // Exécuter l'étape LP directe
  private async executeDirectLpStep(
    state: OrchestratorState,
    params: OrchestratorDirectParams,
    context: BotContext
  ): Promise<OrchestratorState> {
    try {
      logger.info({
        wallet: state.wallet,
        message: 'Exécution de l\'étape LP directe'
      });

      // Mettre à jour l'état
      state = this.stateManager.updateState(state, { currentStep: OrchestratorStep.DIRECT_LP_PENDING });

      // Déterminer les tokens depuis la paire
      const { token0, token1 } = this.getPairTokens(params.pair);

      // Obtenir les informations du pool via le pool discovery service
      const { poolDiscoveryService } = await import('../dex/pools.js');
      const pools = await poolDiscoveryService.getAllPools({
        tokenA: token0,
        tokenB: token1,
        feeTiers: params.fee ? [params.fee] : CONSTANTS.UNIV3.FEE_TIERS,
      });

      if (pools.length === 0) {
        throw new Error(`Aucun pool trouvé pour la paire ${params.pair}`);
      }

      const pool = pools[0]; // Prendre le premier pool (le plus liquide)

      // Calculer le range de ticks
      const { tickLower, tickUpper } = liquidityPositionService.calculateTickRange({
        currentTick: pool.tick,
        tickSpacing: pool.tickSpacing,
        rangePercent: parseFloat(params.rangePercent.toString()),
      });

      // Convertir les montants en wei
      const amount0Desired = parseAmount(params.amount0, 6); // USDC a 6 décimales
      const amount1Desired = parseAmount(params.amount1, 18); // PENGU a 18 décimales

      // Vérifier les balances
      const signer = await createSigner(params.privateKey, CONSTANTS.CHAIN_IDS.ABSTRACT);
      const balance0 = await this.getTokenBalance(token0, signer.address, signer);
      const balance1 = await this.getTokenBalance(token1, signer.address, signer);

      logger.info({
        token0,
        token1,
        balance0: formatAmount(balance0, 6),
        balance1: formatAmount(balance1, 18),
        amount0Desired: formatAmount(amount0Desired, 6),
        amount1Desired: formatAmount(amount1Desired, 18),
        message: 'Vérification des balances'
      });

      // Ajuster les montants selon les balances disponibles
      const finalAmount0 = balance0 < amount0Desired ? balance0 : amount0Desired;
      const finalAmount1 = balance1 < amount1Desired ? balance1 : amount1Desired;

      if (finalAmount0 === 0n && finalAmount1 === 0n) {
        throw new Error('Solde insuffisant pour les deux tokens');
      }

      // Créer la position LP
      const result = await liquidityPositionService.createPosition({
        token0,
        token1,
        fee: pool.fee,
        tickLower,
        tickUpper,
        amount0Desired: finalAmount0,
        amount1Desired: finalAmount1,
        amount0Min: 0n,
        amount1Min: 0n,
        recipient: signer.address,
        deadline: Math.floor(Date.now() / 1000) + 600, // 10 minutes
      }, params.privateKey, {
        dryRun: context.dryRun,
      });

      if (!result.success) {
        throw new Error(`Création de position LP échouée: ${result.error}`);
      }

      // Mettre à jour l'état avec le résultat
      state = this.stateManager.updateState(state, {
        currentStep: OrchestratorStep.DIRECT_LP_DONE,
        positionResult: {
          tokenId: result.tokenId!,
          token0,
          token1,
          tickLower,
          tickUpper,
          liquidity: result.liquidity!,
          amount0: result.amount0!,
          amount1: result.amount1!,
          txHash: result.txHash!,
          success: true,
        },
      });

      logger.info({
        wallet: state.wallet,
        tokenId: result.tokenId?.toString(),
        amount0: result.amount0?.toString(),
        amount1: result.amount1?.toString(),
        liquidity: result.liquidity?.toString(),
        txHash: result.txHash,
        message: 'Position LP directe créée avec succès'
      });

      return state;

    } catch (error) {
      logError(error, { pair: params.pair });
      
      return this.stateManager.updateState(state, {
        currentStep: OrchestratorStep.ERROR,
      });
    }
  }

  // Exécuter l'étape de collecte directe
  private async executeDirectCollectStep(
    state: OrchestratorState,
    params: OrchestratorDirectParams,
    context: BotContext
  ): Promise<OrchestratorState> {
    try {
      logger.info({
        wallet: state.wallet,
        message: 'Exécution de l\'étape Collect directe'
      });

      // Mettre à jour l'état
      state = this.stateManager.updateState(state, { currentStep: OrchestratorStep.DIRECT_COLLECT_PENDING });

      // Attendre le délai spécifié
      if (!context.dryRun) {
        const waitTime = params.collectAfterMinutes * 60 * 1000; // Convertir en ms
        logger.info({
          wallet: state.wallet,
          waitTime: params.collectAfterMinutes,
          message: 'Attente avant collecte des frais (mode direct)'
        });
        
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }

      // Obtenir le tokenId de la position
      const tokenId = state.positionResult?.tokenId;
      
      if (!context.dryRun && !tokenId) {
        throw new Error('TokenId de position non trouvé dans l\'état');
      }

      // Préparer les paramètres de collecte
      const collectParams = {
        tokenId: context.dryRun ? 0n : tokenId!,
        recipient: state.wallet,
        amount0Max: MAX_UINT128,
        amount1Max: MAX_UINT128,
      };

      // Collecter les frais
      const result = await liquidityPositionService.collectFees(collectParams, params.privateKey, {
        dryRun: context.dryRun,
      });

      if (result.executed) {
        // Mettre à jour l'état avec le résultat de collecte
        state = this.stateManager.updateState(state, {
          currentStep: OrchestratorStep.DIRECT_COLLECT_DONE,
          collectResult: {
            tokenId: tokenId!,
            token0: state.positionResult!.token0,
            token1: state.positionResult!.token1,
            tickLower: state.positionResult!.tickLower,
            tickUpper: state.positionResult!.tickUpper,
            liquidity: 0n,
            amount0: result.amount0,
            amount1: result.amount1,
            txHash: result.txHash || '',
            success: true,
            gasUsed: result.gasUsed?.toString(),
          },
        });

        logger.info({
          wallet: state.wallet,
          tokenId: tokenId?.toString(),
          amount0: result.amount0.toString(),
          amount1: result.amount1.toString(),
          txHash: result.txHash,
          message: 'Collecte des frais directe terminée avec succès'
        });
      } else {
        // Aucune collecte effectuée (pas de frais disponibles)
        state = this.stateManager.updateState(state, {
          currentStep: OrchestratorStep.DIRECT_COLLECT_DONE,
        });

        logger.info({
          wallet: state.wallet,
          tokenId: tokenId?.toString(),
          status: result.status,
          message: 'Aucune collecte de frais nécessaire'
        });
      }

      return state;

    } catch (error) {
      logError(error, { 
        tokenId: state.positionResult?.tokenId?.toString(),
      });
      
      return this.stateManager.updateState(state, {
        currentStep: OrchestratorStep.ERROR,
      });
    }
  }

  // Calculer les métriques pour le mode direct
  private calculateDirectMetrics(state: OrchestratorState, startTime: number): OrchestratorMetrics {
    const totalDuration = Date.now() - startTime;
    
    // Calculer les frais collectés
    const totalFeesCollected = {
      token0: state.positionResult?.token0 || '',
      amount0: state.collectResult?.amount0 || 0n,
      token1: state.positionResult?.token1 || '',
      amount1: state.collectResult?.amount1 || 0n,
    };

    // Calculer le PnL (simplifié pour le mode direct)
    const pnl = {
      token0: totalFeesCollected.amount0,
      token1: totalFeesCollected.amount1,
    };

    return {
      totalFeesCollected,
      totalGasUsed: 0n, // TODO: Calculer le gas total utilisé
      totalDuration,
      pnl,
    };
  }

  // Fonction utilitaire pour obtenir les tokens d'une paire
  private getPairTokens(pair: string): { token0: string; token1: string } {
    const [token0Symbol, token1Symbol] = pair.split('/');
    
    const token0 = this.getTokenAddress(token0Symbol);
    const token1 = this.getTokenAddress(token1Symbol);
    
    return { token0, token1 };
  }

  // Fonction utilitaire pour obtenir l'adresse d'un token
  private getTokenAddress(token: string): string {
    switch (token.toUpperCase()) {
      case 'PENGU':
        return CONSTANTS.TOKENS.PENGU;
      case 'USDC':
        return CONSTANTS.TOKENS.USDC;
      case 'ETH':
        return CONSTANTS.NATIVE_ADDRESS;
      case 'WETH':
        return CONSTANTS.TOKENS.WETH;
      default:
        throw new Error(`Token non supporté: ${token}`);
    }
  }

}

// Instance singleton de l'orchestrateur
export const orchestratorService = new OrchestratorService();
