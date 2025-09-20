import { ethers } from 'ethers';
import { CONSTANTS } from '../config/env.js';
import { logger, logError } from '../core/logger.js';
import { withRetryRpc, withRetryTransaction } from '../core/retry.js';
import { createSigner, getProvider, getGasPrice, estimateGasLimit } from '../core/rpc.js';
import { calculateMinAmountOut, calculatePriceImpact, isPriceImpactAcceptable } from '../core/math.js';
import { QUOTER_V2_ABI, SWAP_ROUTER_02_ABI, ERC20_MIN_ABI } from '../abis/index.js';
import { UNISWAP_V3_QUOTER_V2_ABI } from './univ3.js';
import { poolDiscoveryService } from './pools.js';
import { PERMIT2_ABI, PERMIT2_ADDRESS, MAX_UINT160, ONE_YEAR } from '../abi/permit2.js';
import { SWAP_ROUTER_02_ABI, SWAP_ROUTER_02_ADDRESS } from '../abi/swap-router-02.js';
import { lifiSwapService, type LiFiSwapParams } from '../services/lifi-swap.js';
import { factoryChecker } from '../services/factory-checker.js';
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
    const feeTiers = [3000, 10000, 500]; // Prioriser 3000 (plus liquide)
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
    options: { 
      dryRun?: boolean; 
      swapEngine?: 'v3' | 'lifi' | 'auto';
      routerOverride?: string;
      npmOverride?: string;
      factoryOverride?: string;
    } = {}
  ): Promise<SwapResult> {
    const { 
      dryRun = false, 
      swapEngine = 'v3',
      routerOverride,
      npmOverride,
      factoryOverride
    } = options;

    logger.info({
      dryRun,
      message: 'DEBUG: SwapService - dryRun reçu'
    });

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

      // Créer le signer avec provider
      const provider = getProvider(CONSTANTS.CHAIN_IDS.ABSTRACT);
      const signer = new ethers.Wallet(privateKey, provider);
      const recipient = await signer.getAddress();

      // Convertir amountIn en BigInt si nécessaire
      const amountInBigInt = typeof params.amountIn === 'string' 
        ? ethers.parseUnits(params.amountIn, await this.getTokenDecimals(params.tokenIn))
        : params.amountIn;

      // Vérification de factory (pré-flight)
      const factoryCheck = await factoryChecker.checkWithOverrides(
        quote.pool.address,
        routerOverride,
        npmOverride,
        factoryOverride
      );

      if (!factoryCheck.isCompatible) {
        const errorMessage = `Factory mismatch détecté:\n` +
          `Pool: ${quote.pool.address} (factory: ${factoryCheck.poolFactory})\n` +
          `Router: ${routerOverride || CONSTANTS.UNIV3.SWAP_ROUTER_02} (factory: ${factoryCheck.routerFactory})\n` +
          `NPM: ${npmOverride || CONSTANTS.UNIV3.NF_POSITION_MANAGER} (factory: ${factoryCheck.npmFactory})\n\n` +
          `Re-lancer avec --router/--npm du DEX hébergeant le pool ${quote.pool.address}`;
        
        throw new Error(errorMessage);
      }

      logger.info({
        message: 'Vérification factory OK - toutes les factories sont compatibles'
      });

      // Vérifier et approuver les tokens si nécessaire (ERC20 -> Permit2)
      await this.ensureTokenApproval(
        params.tokenIn,
        CONSTANTS.UNIV3.SWAP_ROUTER_02,
        amountInBigInt,
        signer
      );

      // Vérifier et approuver Permit2 -> Router
      await this.ensurePermit2Approval(
        params.tokenIn,
        amountInBigInt,
        signer
      );

      // Fallback : approuver directement le router (pour les overloads sans Permit2)
      await this.ensureDirectRouterApproval(
        params.tokenIn,
        amountInBigInt,
        signer
      );

      // Créer le router avec le signer (pas le provider)
      const router = new ethers.Contract(SWAP_ROUTER_02_ADDRESS, SWAP_ROUTER_02_ABI, signer);

      // Préparer les paramètres du swap - SwapRouter02 avec payerIsUser
      const swapParams = {
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        fee: quote.pool.fee,
        recipient,
        amountIn: amountInBigInt,
        amountOutMinimum: amountOutMin,
        sqrtPriceLimitX96: 0n,
        payerIsUser: true  // ⚠️ OBLIGATOIRE pour SwapRouter02 + Permit2
      };

      logger.info({
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        fee: quote.pool.fee,
        amountIn: amountInBigInt.toString(),
        amountOutMinimum: amountOutMin.toString(),
        payerIsUser: true,
        message: 'Paramètres SwapRouter02 préparés'
      });

      // Utiliser uniquement exactInput (path bytes) - chemin simple et fiable
      const swapResult = await this.executeExactInputSwap(router, {
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        fee: quote.pool.fee,
        recipient,
        amountIn: amountInBigInt,
        amountOutMinimum: amountOutMin,
        sqrtPriceLimitX96: 0n,
      }, recipient, privateKey, provider);

      if (!swapResult.success) {
        throw new Error(`Swap exactInput échoué: ${swapResult.error}`);
      }

      // Le swap a réussi
      logger.info({
        txHash: swapResult.txHash,
        amountOut: swapResult.amountOut?.toString(),
        gasUsed: swapResult.gasUsed?.toString(),
        message: 'Swap exactInput exécuté avec succès'
      });

      return {
        pool: quote.pool,
        amountOut: swapResult.amountOut || quote.amountOut,
        amountOutMin,
        success: true,
        txHash: swapResult.txHash || 'unknown',
        gasUsed: swapResult.gasUsed?.toString() || '0',
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

    // V3SwapRouter02 utilise Permit2, donc on approuve Permit2 au lieu du router

    const token = new ethers.Contract(tokenAddress, ERC20_MIN_ABI, signer);
    const owner = await signer.getAddress();

    // Vérifier l'allowance actuelle
    const allowance = await withRetryRpc(async () => {
      return await token.allowance(owner, PERMIT2_ADDRESS);
    });

    if (allowance >= amount) {
      logger.debug({
        tokenAddress,
        spender: PERMIT2_ADDRESS,
        allowance: allowance.toString(),
        amount: amount.toString(),
        message: 'Allowance ERC20 -> Permit2 suffisante'
      });
      return;
    }

    logger.info({
      tokenAddress,
      spender: PERMIT2_ADDRESS,
      allowance: allowance.toString(),
      amount: amount.toString(),
      message: 'Approbation ERC20 -> Permit2 nécessaire'
    });

    // Approuver le token pour Permit2
    const approveTx = await withRetryTransaction(async () => {
      return await token.approve(PERMIT2_ADDRESS, ethers.MaxUint256);
    });

    logger.info({
      tokenAddress,
      spender: PERMIT2_ADDRESS,
      txHash: approveTx.hash,
      message: 'Token approuvé pour Permit2'
    });

    await approveTx.wait();
  }

  // S'assurer que Permit2 a l'allowance interne vers le router
  private async ensurePermit2Approval(
    tokenAddress: string,
    amount: bigint,
    signer: ethers.Wallet
  ): Promise<void> {
    const permit2 = new ethers.Contract(PERMIT2_ADDRESS, PERMIT2_ABI, signer);
    const owner = await signer.getAddress();

    // Vérifier l'allowance interne Permit2
    const [pAmount] = await withRetryRpc(async () => {
      return await permit2.allowance(owner, tokenAddress, SWAP_ROUTER_02_ADDRESS);
    });

    logger.info({
      tokenAddress,
      permit2Allowance: pAmount.toString(),
      requiredAmount: amount.toString(),
      message: 'Vérification allowance Permit2 -> Router'
    });

    if (pAmount >= amount) {
      logger.debug({
        tokenAddress,
        permit2Allowance: pAmount.toString(),
        amount: amount.toString(),
        message: 'Allowance Permit2 -> Router suffisante'
      });
      return;
    }

    logger.info({
      tokenAddress,
      permit2Allowance: pAmount.toString(),
      amount: amount.toString(),
      message: 'Approbation Permit2 -> Router nécessaire'
    });

    // Approuver Permit2 vers le router
    const now = BigInt(Math.floor(Date.now() / 1000));
    const expiration = now + ONE_YEAR;

    const approveTx = await withRetryTransaction(async () => {
      return await permit2.approve(tokenAddress, SWAP_ROUTER_02_ADDRESS, MAX_UINT160, expiration);
    });

    logger.info({
      tokenAddress,
      spender: SWAP_ROUTER_02_ADDRESS,
      txHash: approveTx.hash,
      message: 'Permit2 approuvé pour Router'
    });

    await approveTx.wait();
  }

  private async ensureDirectRouterApproval(
    tokenAddress: string,
    amount: bigint,
    signer: ethers.Wallet
  ): Promise<void> {
    const token = new ethers.Contract(tokenAddress, ERC20_MIN_ABI, signer);
    const owner = await signer.getAddress();
    
    // Vérifier l'allowance directe ERC20 -> Router
    const allowance = await withRetryRpc(async () => {
      return await token.allowance(owner, SWAP_ROUTER_02_ADDRESS);
    });
    
    if (allowance < amount) {
      logger.info({
        tokenAddress,
        requiredAmount: amount.toString(),
        currentAllowance: allowance.toString(),
        message: 'Approbation directe ERC20 -> Router nécessaire'
      });
      
      const tx = await withRetryTransaction(async () => {
        return await token.approve(SWAP_ROUTER_02_ADDRESS, ethers.MaxUint256);
      });
      
      await tx.wait();
      
      logger.info({
        txHash: tx.hash,
        tokenAddress,
        spender: SWAP_ROUTER_02_ADDRESS,
        amount: ethers.MaxUint256.toString(),
        message: 'Approbation directe ERC20 -> Router confirmée'
      });
    } else {
      logger.info({
        tokenAddress,
        directAllowance: allowance.toString(),
        requiredAmount: amount.toString(),
        message: 'Vérification allowance directe ERC20 -> Router'
      });
    }
  }

  // Méthode simplifiée : utiliser uniquement exactInput (path bytes)
  private async executeExactInputSwap(
    router: ethers.Contract,
    params: {
      tokenIn: string;
      tokenOut: string;
      fee: number;
      recipient: string;
      amountIn: bigint;
      amountOutMinimum: bigint;
      sqrtPriceLimitX96: bigint;
    },
    from: string,
    privateKey: string,
    provider: ethers.Provider
  ): Promise<{ success: boolean; txHash?: string; amountOut?: bigint; gasUsed?: bigint; error?: string }> {
    const { tokenIn, tokenOut, fee, recipient, amountIn, amountOutMinimum } = params;

    try {
      logger.info({ 
        message: 'Exécution swap exactInput (path bytes)',
        tokenIn,
        tokenOut,
        fee,
        amountIn: amountIn.toString(),
        amountOutMinimum: amountOutMinimum.toString()
      });
      
      // Garde-fou : s'assurer que l'allowance directe ERC20 → Router est suffisante
      const signer = new ethers.Wallet(privateKey, provider);
      await this.ensureDirectRouterApproval(tokenIn, amountIn, signer);
      
      // Construire le path: tokenIn (20) | fee (3) | tokenOut (20)
      const path = ethers.solidityPacked(
        ['address', 'uint24', 'address'],
        [tokenIn, fee, tokenOut]
      );

      const exactInputParams = {
        path,
        recipient,
        amountIn,
        amountOutMinimum
      };

      // Test avec callStatic d'abord
      await router.getFunction('exactInput((bytes,address,uint256,uint256))').staticCall(exactInputParams, { from, value: 0n });
      logger.info({ message: 'callStatic exactInput réussi' });

      // Exécuter la transaction
      const gasLimit = await router.getFunction('exactInput((bytes,address,uint256,uint256))').estimateGas(exactInputParams, { from, value: 0n });
      const gasPrice = await getGasPrice(provider);

      const tx = await withRetryTransaction(async () => {
        return await router.getFunction('exactInput((bytes,address,uint256,uint256))')(exactInputParams, {
          from,
          value: 0n,
          gasLimit,
          gasPrice,
        });
      });

      const receipt = await tx.wait();
      if (!receipt) throw new Error('Transaction échouée');

      logger.info({
        txHash: receipt.hash,
        gasUsed: receipt.gasUsed.toString(),
        message: 'Swap exactInput exécuté avec succès'
      });

      return {
        success: true,
        txHash: receipt.hash,
        amountOut: amountOutMinimum, // Approximation
        gasUsed: receipt.gasUsed
      };
    } catch (error) {
      logger.error({
        error: error.message,
        message: 'Swap exactInput échoué'
      });
      
      return {
        success: false,
        error: error.message
      };
    }
  }
}

// Instance singleton du service de swap
export const swapService = new SwapService();
