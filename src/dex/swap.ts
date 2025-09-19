import { ethers } from 'ethers';
import { CONSTANTS } from '../config/env.js';
import { logger, logError } from '../core/logger.js';
import { withRetryRpc, withRetryTransaction } from '../core/retry.js';
import { createSigner, getProvider, getGasPrice, estimateGasLimit } from '../core/rpc.js';
import { calculateMinAmountOut, calculatePriceImpact, isPriceImpactAcceptable } from '../core/math.js';
import { QUOTER_V2_ABI, SWAP_ROUTER_02_ABI, ERC20_MIN_ABI } from '../abis/index.js';
import { UNISWAP_V3_QUOTER_V2_ABI } from './univ3.js';
import { poolDiscoveryService } from './pools.js';
import type { SwapParams, SwapResult, QuoteParams, QuoteResult } from './types.js';

// Service de swap
export class SwapService {
  private quoter: ethers.Contract;
  private router: ethers.Contract;

  constructor() {
    const provider = getProvider(CONSTANTS.CHAIN_IDS.ABSTRACT);
    
    this.quoter = new ethers.Contract(
      CONSTANTS.UNIV3.QUOTER_V2,
      UNISWAP_V3_QUOTER_V2_ABI,
      provider
    );
    
    this.router = new ethers.Contract(
      CONSTANTS.UNIV3.SWAP_ROUTER_02,
      SWAP_ROUTER_02_ABI,
      provider
    );
  }

  // Obtenir les décimales d'un token
  private async getTokenDecimals(tokenAddress: string): Promise<number> {
    if (/^0x0{40}$/i.test(tokenAddress)) return 18; // ETH natif
    const provider = getProvider(CONSTANTS.CHAIN_IDS.ABSTRACT);
    const erc20 = new ethers.Contract(tokenAddress, ERC20_MIN_ABI, provider);
    return await erc20.decimals();
  }

  // Essayer un quote avec fallback sur différents fee tiers
  private async tryQuoteWithFallback(
    quoteParams: any, 
    tokenIn: string, 
    tokenOut: string, 
    amountInWei: bigint, 
    inDecimals: number
  ): Promise<any[]> {
    const feeTiers = [500, 3000, 10000];
    let lastError: any;

    // Essayer d'abord avec le fee du pool trouvé
    try {
      return await withRetryRpc(async () => {
        return await this.quoter.quoteExactInputSingle(quoteParams);
      });
    } catch (error) {
      lastError = error;
      logger.warn({
        tokenIn,
        tokenOut,
        fee: quoteParams[3],
        amountIn: amountInWei.toString(),
        error: error instanceof Error ? error.message : 'Unknown error',
        message: 'Quote échoué, tentative avec autres fee tiers'
      });
    }

    // Essayer avec d'autres fee tiers
    for (const fee of feeTiers) {
      if (fee === quoteParams[3]) continue;
      
      try {
        const pool = await this.getPoolInfo(tokenIn, tokenOut, fee);
        if (!pool) continue;

        const fallbackParams = [
          quoteParams[0],  // tokenIn
          quoteParams[1],  // tokenOut
          quoteParams[2],  // amountIn
          pool.fee,        // fee
          quoteParams[4],  // sqrtPriceLimitX96
        ];

        return await withRetryRpc(async () => {
          return await this.quoter.quoteExactInputSingle(fallbackParams);
        });
      } catch (error) {
        lastError = error;
        continue;
      }
    }

    // Si tous les fee tiers échouent, essayer avec un montant minimum
    try {
      const minAmount = ethers.parseUnits("0.001", inDecimals);
      const adjustedParams = [
        quoteParams[0],  // tokenIn
        quoteParams[1],  // tokenOut
        minAmount > amountInWei ? minAmount : amountInWei,  // amountIn
        quoteParams[3],  // fee
        quoteParams[4],  // sqrtPriceLimitX96
      ];

      return await withRetryRpc(async () => {
        return await this.quoter.quoteExactInputSingle(adjustedParams);
      });
    } catch (error) {
      lastError = error;
    }

    throw new Error(`Tous les quotes ont échoué. Dernière erreur: ${lastError instanceof Error ? lastError.message : 'Unknown error'}`);
  }

  // Obtenir un quote pour un swap
  async getQuote(params: QuoteParams): Promise<QuoteResult> {
    const { tokenIn, tokenOut, amountIn, fee } = params;

    // Convertir le montant humain en wei avec les bonnes décimales
    const inDecimals = await this.getTokenDecimals(tokenIn);
    const amountInWei = typeof amountIn === 'string' 
      ? ethers.parseUnits(amountIn, inDecimals)
      : amountIn;

    logger.info({
      tokenIn,
      tokenOut,
      amountInHuman: typeof amountIn === 'string' ? amountIn : amountIn.toString(),
      amountInWei: amountInWei.toString(),
      inDecimals,
      fee,
      message: 'Calcul du quote de swap'
    });

    // Découvrir le pool si le fee n'est pas fourni
    let pool: any;
    if (fee) {
      pool = await this.getPoolInfo(tokenIn, tokenOut, fee);
    } else {
      pool = await poolDiscoveryService.discoverBestPool({
        tokenA: tokenIn,
        tokenB: tokenOut,
        feeTiers: CONSTANTS.UNIV3.FEE_TIERS,
      });

      if (!pool) {
        throw new Error('Aucun pool trouvé pour cette paire de tokens');
      }
    }

    // Obtenir le quote - ORDRE CORRECT: amountIn AVANT fee
    // Passer un array au lieu d'un objet pour l'ABI tuple
    const quoteParams = [
      tokenIn,
      tokenOut,
      amountInWei,    // <-- IMPORTANT: amountIn AVANT fee
      pool.fee,       // <-- puis fee
      0n,             // sqrtPriceLimitX96
    ];

    const [amountOut, sqrtPriceX96After, initializedTicksCrossed, gasEstimate] = await this.tryQuoteWithFallback(quoteParams, tokenIn, tokenOut, amountInWei, inDecimals);

    const result: QuoteResult = {
      amountOut: BigInt(amountOut),
      sqrtPriceX96After: BigInt(sqrtPriceX96After),
      initializedTicksCrossed: Number(initializedTicksCrossed),
      gasEstimate: BigInt(gasEstimate),
      pool,
    };

    logger.info({
      amountIn: amountIn.toString(),
      amountOut: result.amountOut.toString(),
      gasEstimate: result.gasEstimate.toString(),
      message: 'Quote calculé'
    });

    return result;
  }

  // Exécuter un swap
  async executeSwap(
    params: SwapParams,
    privateKey: string,
    options: { dryRun?: boolean } = {}
  ): Promise<SwapResult> {
    const { dryRun = CONSTANTS.DRY_RUN } = options;

    try {
      // Obtenir le quote
      const quote = await this.getQuote({
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        amountIn: params.amountIn,
        fee: params.fee,
      });

      // Calculer le montant minimum avec slippage
      const amountOutMin = calculateMinAmountOut(quote.amountOut, params.slippageBps);

      // Vérifier le price impact
      const priceImpact = calculatePriceImpact(
        params.amountIn,
        quote.amountOut,
        quote.amountOut
      );

      if (!isPriceImpactAcceptable(priceImpact)) {
        throw new Error(`Price impact trop élevé: ${priceImpact.toFixed(2)}%`);
      }

      logger.info({
        amountIn: params.amountIn.toString(),
        amountOut: quote.amountOut.toString(),
        amountOutMin: amountOutMin.toString(),
        priceImpact: priceImpact.toFixed(2),
        slippageBps: params.slippageBps,
        message: 'Paramètres de swap calculés'
      });

      if (dryRun) {
        logger.info({
          pool: quote.pool.address,
          amountIn: params.amountIn.toString(),
          amountOut: quote.amountOut.toString(),
          amountOutMin: amountOutMin.toString(),
          message: 'DRY_RUN: Swap simulé'
        });

        return {
          pool: quote.pool,
          amountOut: quote.amountOut,
          amountOutMin,
          success: true,
        };
      }

      // Créer le signer
      const signer = createSigner(privateKey, CONSTANTS.CHAIN_IDS.ABSTRACT);
      const recipient = await signer.getAddress();

      // Convertir amountIn en BigInt si nécessaire
      const amountInBigInt = typeof params.amountIn === 'string' 
        ? ethers.parseUnits(params.amountIn, await this.getTokenDecimals(params.tokenIn))
        : params.amountIn;

      // Vérifier et approuver les tokens si nécessaire
      await this.ensureTokenApproval(
        params.tokenIn,
        CONSTANTS.UNIV3.SWAP_ROUTER_02,
        amountInBigInt,
        signer
      );

      // Préparer les paramètres du swap - ORDRE CORRECT pour exactInputSingle
      const swapParams = {
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        fee: quote.pool.fee,
        recipient,
        amountIn: amountInBigInt,         // <-- amountIn AVANT amountOutMinimum
        amountOutMinimum: amountOutMin,   // <-- puis amountOutMinimum
        sqrtPriceLimitX96: 0n,
      };

      // Estimer le gas
      const gasLimit = await estimateGasLimit(
        this.router,
        'exactInputSingle',
        [swapParams],
        { value: params.tokenIn === CONSTANTS.NATIVE_ADDRESS ? amountInBigInt : 0n }
      );

      // Obtenir le gas price
      const gasPrice = await getGasPrice(signer.provider! as any);

      // Exécuter le swap
      const tx = await withRetryTransaction(async () => {
        return await this.router.exactInputSingle(swapParams, {
          value: params.tokenIn === CONSTANTS.NATIVE_ADDRESS ? amountInBigInt : 0n,
          gasLimit,
          gasPrice,
        });
      });

      logger.info({
        txHash: tx.hash,
        message: 'Transaction de swap envoyée'
      });

      // Attendre la confirmation
      const receipt = await tx.wait();

      if (!receipt) {
        throw new Error('Transaction de swap échouée');
      }

      logger.info({
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        message: 'Swap exécuté avec succès'
      });

      return {
        pool: quote.pool,
        amountOut: quote.amountOut,
        amountOutMin,
        txHash: receipt.hash,
        success: true,
      };

    } catch (error) {
      logError(error, { 
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        amountIn: params.amountIn.toString(),
      });
      
      return {
        pool: { address: '', token0: '', token1: '', fee: 0, tickSpacing: 0, liquidity: 0n, sqrtPriceX96: 0n, tick: 0 },
        amountOut: 0n,
        amountOutMin: 0n,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // Obtenir les informations d'un pool
  private async getPoolInfo(tokenA: string, tokenB: string, fee: number): Promise<any> {
    const pool = await poolDiscoveryService.discoverBestPool({
      tokenA,
      tokenB,
      feeTiers: [fee],
    });

    if (!pool) {
      throw new Error(`Pool non trouvé pour ${tokenA}/${tokenB} avec fee ${fee}`);
    }

    return pool;
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
}

// Instance singleton du service de swap
export const swapService = new SwapService();
