import axios from 'axios';
import { Contract, JsonRpcProvider, Wallet } from 'ethers';
import { NETWORKS, TOKENS, env, STRATEGY_CONSTANTS } from './config.js';
import type { BalanceBreakdown, ExecutionResult, SwapQuote } from './types.js';
import { applySlippageBps, calculateAllocation, fromWei, percentBps, nowPlusSecs } from './utils.js';
import { logger } from './logger.js';

const LIFI_BASE_URL = 'https://li.quest/v1';
const ERC20_ABI = ['function balanceOf(address owner) view returns (uint256)'];
const WETH_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function deposit() payable',
  'function approve(address spender, uint256 value) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

export class SwapService {
  private readonly provider: JsonRpcProvider;
  private readonly signer: Wallet;
  private readonly weth: Contract;
  private readonly pengu: Contract;

  constructor(privateKey: string) {
    this.provider = new JsonRpcProvider(NETWORKS.abstract.rpcUrl, NETWORKS.abstract.chainId);
    this.signer = new Wallet(privateKey, this.provider);
    this.weth = new Contract(TOKENS.eth.address, WETH_ABI, this.signer);
    this.pengu = new Contract(TOKENS.pengu.address, ERC20_ABI, this.provider);
  }

  async fetchQuote(tokenIn: string, tokenOut: string, amountWei: bigint): Promise<SwapQuote> {
    // Pour l'instant, utiliser LiFi, mais si ça échoue, on implémentera Uniswap direct
    const params = {
      fromChain: NETWORKS.abstract.chainId,
      toChain: NETWORKS.abstract.chainId,
      fromToken: tokenIn,
      toToken: tokenOut,
      fromAmount: amountWei.toString(),
      fromAddress: await this.signer.getAddress(),
      toAddress: await this.signer.getAddress(),
      slippage: percentBps(env.SWAP_SLIPPAGE_BPS), // ex: 100 bps -> 0.01
      integratorId: 'bsl-pengu-bot',
    } as const;

    try {
      const { data: step } = await axios.get(`${LIFI_BASE_URL}/quote`, { params });
      // step is a Step with transactionRequest + estimate
      if (!step?.transactionRequest) throw new Error('LiFi: no transactionRequest');
      
      const minOut = BigInt(step.estimate?.toAmountMin ?? step.estimate?.toAmount ?? '0');
      
      return {
        tokenIn,
        tokenOut,
        amountInWei: amountWei,
        minAmountOutWei: minOut,
        calldata: step.transactionRequest.data,
        target: step.transactionRequest.to,
        valueWei: BigInt(step.transactionRequest.value ?? 0),
        approvalAddress: step.estimate?.approvalAddress, // utile pour approve
      } satisfies SwapQuote;
    } catch (error) {
      logger.warn({ 
        err: error,
        message: 'LiFi swap quote failed, logging response for debugging'
      });
      
      // Log détaillé pour debug
      if (error.response) {
        logger.error({
          status: error.response.status,
          statusText: error.response.statusText,
          data: error.response.data,
          url: error.config?.url,
          params: error.config?.params,
          message: 'LiFi API error response details'
        });
      }
      
      // Fallback: Swap direct avec Universal Router
      logger.info({
        tokenIn,
        tokenOut,
        amountWei: amountWei.toString(),
        message: 'LiFi échoué, tentative avec Universal Router direct'
      });
      
      return await this.createUniversalRouterSwap(tokenIn, tokenOut, amountWei);
    }
  }

  private async createUniversalRouterSwap(tokenIn: string, tokenOut: string, amountWei: bigint): Promise<SwapQuote> {
    try {
      // Approve WETH au router si nécessaire
      if (tokenIn === TOKENS.eth.address) {
        const allowance = await this.weth.allowance(this.signer.address, env.UNISWAP_ROUTER_ADDRESS);
        if (allowance < amountWei) {
          logger.info({
            amount: amountWei.toString(),
            message: 'Approve WETH au Universal Router'
          });
          const approveTx = await this.weth.approve(env.UNISWAP_ROUTER_ADDRESS, amountWei);
          await approveTx.wait();
        }
      }

      // Encoder le swap exactInputSingle pour WETH → PENGU
      // Universal Router command: V3_SWAP_EXACT_IN
      const deadline = Math.floor(Date.now() / 1000) + 300; // 5 minutes
      
      // Pour l'instant, simulation avec estimation basique
      // En production, il faudrait encoder correctement les paramètres Universal Router
      const estimatedOutput = amountWei * 1000000n / 1000000000000000000n; // Estimation: 1 WETH ≈ 1M PENGU
      const minAmount = applySlippageBps(estimatedOutput, env.SWAP_SLIPPAGE_BPS);
      
      // Calldata simulé pour Universal Router execute
      // En réalité, il faudrait encoder: execute(bytes commands, bytes[] inputs, uint256 deadline)
      const calldata = this.encodeUniversalRouterSwap(tokenIn, tokenOut, amountWei, minAmount, deadline);
      
      return {
        tokenIn,
        tokenOut,
        amountInWei: amountWei,
        minAmountOutWei: minAmount,
        calldata,
        target: env.UNISWAP_ROUTER_ADDRESS,
        valueWei: 0n,
      } satisfies SwapQuote;
      
    } catch (error) {
      logger.error({
        err: error,
        message: 'Erreur création swap Universal Router'
      });
      
      // Fallback final: quote simulée
      const estimatedOutput = amountWei / 1000000n;
      const minAmount = applySlippageBps(estimatedOutput, env.SWAP_SLIPPAGE_BPS);
      
      return {
        tokenIn,
        tokenOut,
        amountInWei: amountWei,
        minAmountOutWei: minAmount,
        calldata: '0x',
        target: '0x0000000000000000000000000000000000000000',
        valueWei: 0n,
      } satisfies SwapQuote;
    }
  }

  private encodeUniversalRouterSwap(tokenIn: string, tokenOut: string, amountIn: bigint, minAmountOut: bigint, deadline: number): string {
    // Encodage simplifié pour Universal Router
    // En production, utiliser le SDK Uniswap pour l'encodage correct
    
    // Command V3_SWAP_EXACT_IN = 0x00
    const command = '0x00';
    
    // Encoder les paramètres du swap
    const inputs = [
      // recipient (address)
      this.signer.address,
      // amountIn (uint256)
      amountIn.toString(),
      // amountOutMin (uint256) 
      minAmountOut.toString(),
      // path (bytes) - WETH → PENGU
      this.encodeSwapPath(tokenIn, tokenOut, 3000), // Fee tier 0.3%
      // payerIsUser (bool)
      'true'
    ];
    
    // Pour l'instant, retourner un calldata basique
    // En réalité, il faudrait encoder execute(bytes commands, bytes[] inputs, uint256 deadline)
    return `0x${command}${deadline.toString(16).padStart(64, '0')}`;
  }

  private encodeSwapPath(tokenIn: string, tokenOut: string, fee: number): string {
    // Encoder le path pour Uniswap v3: tokenIn -> fee -> tokenOut
    // Format: tokenIn (20 bytes) + fee (3 bytes) + tokenOut (20 bytes)
    const tokenInHex = tokenIn.slice(2).toLowerCase();
    const feeHex = fee.toString(16).padStart(6, '0');
    const tokenOutHex = tokenOut.slice(2).toLowerCase();
    return `0x${tokenInHex}${feeHex}${tokenOutHex}`;
  }

  async executeSwap(quote: SwapQuote): Promise<ExecutionResult<void>> {
    try {
      // Si pas de calldata ou target invalide, c'est un fallback - ne pas exécuter
      if (quote.calldata === '0x' || quote.target === '0x0000000000000000000000000000000000000000') {
        logger.warn({ 
          tokenIn: quote.tokenIn,
          tokenOut: quote.tokenOut,
          message: 'Swap simulé - pas d\'exécution réelle'
        });
        return { success: false, error: new Error('Swap simulation only - no real execution') };
      }

      // Approval ERC-20 (WETH → approvalAddress) si nécessaire
      const NATIVE_ETH_SENTINEL = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
      if (quote.approvalAddress && quote.tokenIn.toLowerCase() !== NATIVE_ETH_SENTINEL.toLowerCase()) {
        const allowance = await this.weth.allowance(this.signer.address, quote.approvalAddress);
        if (allowance < quote.amountInWei) {
          const txA = await this.weth.approve(quote.approvalAddress, quote.amountInWei);
          await txA.wait();
          logger.info({ hash: txA.hash }, 'Approved WETH for LiFi');
        }
      }

      // Si c'est Universal Router, utiliser une approche simplifiée
      if (quote.target === env.UNISWAP_ROUTER_ADDRESS) {
        return await this.executeUniversalRouterSwap(quote);
      }

      // Exécution LiFi normale
      const tx = await this.signer.sendTransaction({
        to: quote.target,
        data: quote.calldata,
        value: quote.valueWei,
      });
      await tx.wait();
      logger.info({ txHash: tx.hash, tokenIn: quote.tokenIn, tokenOut: quote.tokenOut }, 'LiFi swap executed');
      return { success: true, txHash: tx.hash };
    } catch (error) {
      logger.error({ err: error }, 'Swap failed');
      return { success: false, error: error as Error };
    }
  }

  private async executeUniversalRouterSwap(quote: SwapQuote): Promise<ExecutionResult<void>> {
    try {
      // Approbation WETH au Universal Router si nécessaire
      const allowance = await this.weth.allowance(this.signer.address, env.UNISWAP_ROUTER_ADDRESS);
      if (allowance < quote.amountInWei) {
        logger.info({ message: 'Approve WETH au Universal Router' });
        const approveTx = await this.weth.approve(env.UNISWAP_ROUTER_ADDRESS, quote.amountInWei);
        await approveTx.wait();
      }
      
      // Utiliser SwapRouter02 directement (plus simple que Universal Router)
      const SWAP_ROUTER_02 = '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45'; // Adresse standard
      const deadline = nowPlusSecs(300);
      
      // Encoder exactInputSingle
      const exactInputSingleCalldata = await this.encodeExactInputSingle(
        quote.tokenIn,
        quote.tokenOut,
        quote.amountInWei,
        quote.minAmountOutWei,
        deadline
      );
      
      logger.info({
        routerAddress: SWAP_ROUTER_02,
        tokenIn: quote.tokenIn,
        tokenOut: quote.tokenOut,
        amountIn: quote.amountInWei.toString(),
        minAmountOut: quote.minAmountOutWei.toString(),
        message: 'Exécution swap direct Uniswap v3 SwapRouter02'
      });
      
      const tx = await this.signer.sendTransaction({
        to: SWAP_ROUTER_02,
        data: exactInputSingleCalldata,
        value: quote.valueWei,
      });
      
      await tx.wait();
      logger.info({ 
        txHash: tx.hash, 
        tokenIn: quote.tokenIn, 
        tokenOut: quote.tokenOut,
        message: 'Swap Universal Router exécuté avec succès'
      });
      
      return { success: true, txHash: tx.hash };
    } catch (error) {
      logger.error({ 
        err: error,
        message: 'Erreur exécution Universal Router'
      });
      return { success: false, error: error as Error };
    }
  }

  private async encodeExactInputSingle(
    tokenIn: string, 
    tokenOut: string, 
    amountIn: bigint, 
    amountOutMinimum: bigint, 
    deadline: number
  ): Promise<string> {
    // Fonction selector pour exactInputSingle
    const selector = '0x414bf389'; // exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))
    
    // Encoder les paramètres dans le bon ordre
    const params = [
      tokenIn,                    // tokenIn
      tokenOut,                   // tokenOut  
      '0x0bb8',                   // fee (3000 = 0.3%)
      await this.signer.getAddress(), // recipient
      amountIn.toString(),        // amountIn
      amountOutMinimum.toString(), // amountOutMinimum
      deadline.toString(),        // deadline
      '0x0'                       // sqrtPriceLimitX96 (0 = pas de limite)
    ];
    
    // Encoder en hex
    let calldata = selector;
    for (const param of params) {
      calldata += param.slice(2).padStart(64, '0');
    }
    
    return calldata;
  }

  async rebalanceToTargetMix(totalEthWei: bigint): Promise<BalanceBreakdown> {
    const targetPengu = calculateAllocation(totalEthWei, STRATEGY_CONSTANTS.penguAllocation * 100);
    const targetEth = totalEthWei - targetPengu;
    return {
      ethWei: targetEth,
      penguWei: targetPengu,
      nativeEthWei: 0n,
      wethWei: targetEth,
    };
  }

  async getTokenBalances(): Promise<BalanceBreakdown> {
    const nativeEth = await this.provider.getBalance(this.signer.address);
    const wethBalance = await this.weth.balanceOf(this.signer.address);
    const penguBalance = await this.pengu.balanceOf(this.signer.address);
    const totalEth = nativeEth + wethBalance;
    return {
      ethWei: totalEth,
      penguWei: penguBalance,
      nativeEthWei: nativeEth,
      wethWei: wethBalance,
    };
  }

  async wrapNative(amountWei: bigint) {
    if (amountWei <= 0n) return;
    const tx = await this.weth.deposit({ value: amountWei });
    await tx.wait();
    logger.info({ amountEth: fromWei(amountWei) }, 'Wrapped native ETH into WETH');
  }

  async ensureWethBalance(targetWei: bigint, maxWrapFromNative?: bigint) {
    const current = await this.weth.balanceOf(this.signer.address);
    if (current >= targetWei) return;
    const shortfall = targetWei - current;
    const cap = typeof maxWrapFromNative === 'bigint' ? maxWrapFromNative : shortfall;
    const wrapAmount = shortfall > cap ? cap : shortfall;
    if (wrapAmount > 0n) {
      await this.wrapNative(wrapAmount);
    }
  }
}
