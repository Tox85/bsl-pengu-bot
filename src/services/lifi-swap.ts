import { ethers } from 'ethers';
import { CONSTANTS } from '../config/env.js';
import { logger, logError } from '../core/logger.js';
import { withRetryTransaction } from '../core/retry.js';
import { createSigner, getGasPrice, estimateGasLimit } from '../core/rpc.js';
import { getRoutes, executeRoute } from '@lifi/sdk';

export interface LiFiSwapParams {
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  recipient: string;
  slippageBps: number;
}

export interface LiFiSwapResult {
  success: boolean;
  txHash?: string;
  amountOut?: bigint;
  error?: string;
}

export class LiFiSwapService {
  constructor() {
    // Pas besoin d'instance, on utilise les fonctions directement
  }

  async executeSwap(
    params: LiFiSwapParams,
    privateKey: string,
    options: { dryRun?: boolean } = {}
  ): Promise<LiFiSwapResult> {
    const { dryRun = false } = options;

    try {
      logger.info({
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        amountIn: params.amountIn.toString(),
        recipient: params.recipient,
        slippageBps: params.slippageBps,
        dryRun,
        message: 'Démarrage swap Li.Fi same-chain'
      });

      if (dryRun) {
        logger.info({
          message: 'DRY_RUN: Swap Li.Fi simulé'
        });
        return { success: true };
      }

      // Obtenir les routes Li.Fi pour same-chain
      const routes = await getRoutes({
        fromChainId: CONSTANTS.CHAIN_IDS.ABSTRACT,
        toChainId: CONSTANTS.CHAIN_IDS.ABSTRACT,
        fromTokenAddress: params.tokenIn,
        toTokenAddress: params.tokenOut,
        fromAmount: params.amountIn.toString(),
        fromAddress: params.recipient,
        options: {
          slippage: params.slippageBps / 10000, // Convertir bps en décimal
          allowSwitchChain: false,
        },
      });

      if (!routes.routes || routes.routes.length === 0) {
        throw new Error('Aucune route Li.Fi trouvée pour ce swap');
      }

      // Prendre la meilleure route
      const route = routes.routes[0];
      logger.info({
        routeId: route.id,
        steps: route.steps.length,
        message: 'Route Li.Fi sélectionnée'
      });

      // Exécuter la route
      const signer = await createSigner(privateKey, CONSTANTS.CHAIN_IDS.ABSTRACT);
      const execution = await executeRoute({
        route,
        signer: signer as any,
        updateRouteHook: (route) => {
          logger.debug({
            status: route.status,
            message: 'Mise à jour route Li.Fi'
          });
        },
      });

      if (execution.status === 'DONE') {
        const txHash = execution.steps[0]?.transactionHash;
        const amountOut = execution.toAmount ? BigInt(execution.toAmount) : undefined;

        logger.info({
          txHash,
          amountOut: amountOut?.toString(),
          message: 'Swap Li.Fi exécuté avec succès'
        });

        return {
          success: true,
          txHash,
          amountOut,
        };
      } else {
        throw new Error(`Échec de l'exécution Li.Fi: ${execution.status}`);
      }

    } catch (error) {
      logError(error, {
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        amountIn: params.amountIn.toString(),
        message: 'Erreur swap Li.Fi'
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}

export const lifiSwapService = new LiFiSwapService();
