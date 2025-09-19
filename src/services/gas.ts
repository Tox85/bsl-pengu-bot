/**
 * Service de gestion du gas natif sur Abstract
 */

import { ethers } from 'ethers';
import { CONSTANTS } from '../config/env.js';
import { logger } from '../core/logger.js';
import { getProvider } from '../core/rpc.js';
import type { BridgeService } from '../bridge/index.js';
import type { BotContext } from '../core/context.js';

export interface GasTopUpParams {
  context: BotContext;
  bridgeService: BridgeService;
  minWeiNeeded: bigint;
  targetWei: bigint;
}

export class GasService {
  /**
   * S'assurer qu'il y a assez de gas natif sur Abstract
   */
  static async ensureNativeOnAbstract(params: GasTopUpParams): Promise<void> {
    const {
      context,
      bridgeService,
      minWeiNeeded,
      targetWei
    } = params;

    const { signerBase, signerAbstract, walletAddress } = context;
    
    // Vérifier le solde actuel
    const currentBalance = await signerAbstract.provider.getBalance(walletAddress);
    
    logger.info({
      wallet: walletAddress,
      currentBalance: currentBalance.toString(),
      currentBalanceEth: ethers.formatEther(currentBalance),
      minWeiNeeded: minWeiNeeded.toString(),
      targetWei: targetWei.toString(),
      message: 'Vérification solde gas natif Abstract'
    });

    // Calculer le montant nécessaire
    const requiredWei = minWeiNeeded > targetWei ? minWeiNeeded : targetWei;
    const neededWei = requiredWei > currentBalance ? requiredWei - currentBalance : 0n;

    if (neededWei <= 0n) {
      logger.info({
        currentBalance: currentBalance.toString(),
        requiredWei: requiredWei.toString(),
        message: 'Solde gas natif suffisant sur Abstract'
      });
      return;
    }

    // Utiliser le targetWei paramétré ou neededWei si plus grand
    const topUpWei = neededWei > targetWei ? neededWei : targetWei;
    const topUpEth = ethers.formatEther(topUpWei);

    logger.info({
      neededWei: neededWei.toString(),
      topUpWei: topUpWei.toString(),
      topUpEth,
      message: 'Solde gas natif insuffisant → top-up requis'
    });

    if (!context.autoGasTopUp) {
      throw new Error(
        `Solde natif insuffisant sur Abstract: ${ethers.formatEther(currentBalance)} ETH. ` +
        `Veuillez bridger ~${topUpEth} ETH pour le gas ou activez --autoGasTopUp true.`
      );
    }

    // Effectuer le bridge ETH
    logger.info({
      fromChainId: CONSTANTS.CHAIN_IDS.BASE,
      toChainId: CONSTANTS.CHAIN_IDS.ABSTRACT,
      topUpEth,
      message: 'Démarrage auto top-up ETH vers Abstract'
    });

    try {
      // Obtenir la route de bridge ETH NATIF → NATIF
      const result = await bridgeService.getBridgeRoute({
        fromChainId: CONSTANTS.CHAIN_IDS.BASE,
        toChainId: CONSTANTS.CHAIN_IDS.ABSTRACT,
        fromTokenAddress: CONSTANTS.NATIVE_ADDRESS, // ETH natif Base
        toTokenAddress: CONSTANTS.NATIVE_ADDRESS,   // ETH natif Abstract
        amount: topUpEth, // Montant humain en ETH
        fromAddress: walletAddress,
        toAddress: walletAddress,
        slippage: 50, // 0.5%
      });

      logger.info({
        routeId: result.id || 'unknown',
        fromToken: result.fromToken?.symbol || 'unknown',
        toToken: result.toToken?.symbol || 'unknown',
        fromAmount: result.fromAmount || '0',
        toAmount: result.toAmount || '0',
        message: 'Route ETH auto top-up obtenue'
      });

      // Exécuter le bridge (mode réel seulement si pas DRY_RUN)
      if (context.dryRun !== true && context.dryRun !== "true") {
        // Exécuter le bridge réel avec le signer Base
        const bridgeResult = await bridgeService.executeRoute(result, signerBase);
        
        if (!bridgeResult.success || !bridgeResult.txHash) {
          throw new Error(`Échec exécution bridge ETH: ${bridgeResult.error}`);
        }

        logger.info({
          txHash: bridgeResult.txHash,
          message: 'Bridge ETH auto top-up envoyé'
        });

        // Attendre que le bridge soit reçu
        if (bridgeResult.status) {
          const finalStatus = await bridgeService.lifiClient.waitUntilReceived({
            bridge: result.tool,
            fromChain: CONSTANTS.CHAIN_IDS.BASE,
            toChain: CONSTANTS.CHAIN_IDS.ABSTRACT,
            txHash: bridgeResult.txHash,
            timeoutMs: 10 * 60_000 // 10 minutes
          });

          logger.info({
            status: finalStatus.status,
            message: 'Bridge ETH auto top-up reçu'
          });

          // Vérifier si nous avons reçu du WETH au lieu d'ETH natif
          if (result.toToken.address !== CONSTANTS.NATIVE_ADDRESS) {
            logger.info({
              receivedToken: result.toToken.symbol,
              message: 'WETH reçu, unwrap nécessaire'
            });
            
            // TODO: Implémenter l'unwrap WETH → ETH natif
            // Pour l'instant, on considère que WETH peut être utilisé pour le gas
            // (certaines chaînes acceptent WETH comme gas)
          }
        }

      } else {
        logger.info({
          topUpEth,
          message: 'DRY_RUN: Auto top-up ETH simulé'
        });
      }

      // Vérifier le nouveau solde après un délai
      await new Promise(resolve => setTimeout(resolve, 2000)); // 2 secondes
      const newBalance = await signerAbstract.provider.getBalance(walletAddress);
      
      logger.info({
        oldBalance: currentBalance.toString(),
        newBalance: newBalance.toString(),
        topUpEth,
        message: 'Auto top-up ETH terminé'
      });

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : 'Unknown error',
        topUpEth,
        message: 'Échec auto top-up ETH'
      });
      throw error;
    }
  }

  /**
   * Vérifier le solde gas natif et proposer une action
   */
  static async checkNativeBalance(wallet: string, chainId: number = CONSTANTS.CHAIN_IDS.ABSTRACT): Promise<{
    balance: bigint;
    balanceEth: string;
    sufficient: boolean;
  }> {
    const provider = getProvider(chainId);
    const balance = await provider.getBalance(wallet);
    const balanceEth = ethers.formatEther(balance);
    
    const minRequired = CONSTANTS.MIN_NATIVE_DEST_WEI_FOR_APPROVE + CONSTANTS.MIN_NATIVE_DEST_WEI_FOR_SWAP;
    const sufficient = balance >= minRequired;

    logger.info({
      wallet,
      balance: balance.toString(),
      balanceEth,
      minRequired: minRequired.toString(),
      sufficient,
      message: 'Vérification solde gas natif'
    });

    return { balance, balanceEth, sufficient };
  }
}
