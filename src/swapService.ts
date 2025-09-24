import axios from 'axios';
import { Contract, JsonRpcProvider, Wallet } from 'ethers';
import { NETWORKS, TOKENS, env, STRATEGY_CONSTANTS } from './config.js';
import type { BalanceBreakdown, ExecutionResult, SwapQuote } from './types.js';
import { applySlippageBps, calculateAllocation } from './utils.js';
import { logger } from './logger.js';

const JUMPER_BASE_URL = 'https://api.jumper.exchange/v1';
const ERC20_ABI = ['function balanceOf(address owner) view returns (uint256)'];

export class SwapService {
  private readonly provider: JsonRpcProvider;
  private readonly signer: Wallet;

  constructor(privateKey: string) {
    this.provider = new JsonRpcProvider(NETWORKS.abstract.rpcUrl, NETWORKS.abstract.chainId);
    this.signer = new Wallet(privateKey, this.provider);
  }

  async fetchQuote(tokenIn: string, tokenOut: string, amountWei: bigint): Promise<SwapQuote> {
    const params = {
      fromChain: NETWORKS.abstract.chainId,
      toChain: NETWORKS.abstract.chainId,
      fromToken: tokenIn,
      toToken: tokenOut,
      amount: amountWei.toString(),
      slippage: env.SWAP_SLIPPAGE_BPS / 100,
      integratorId: 'bsl-pengu-bot-swap',
    } as const;

    const { data } = await axios.get(`${JUMPER_BASE_URL}/quote`, { params });
    const route = data?.routes?.[0];
    if (!route) throw new Error('Unable to fetch swap quote from Jumper');
    const tx = route.transactionRequest;
    const minAmount = applySlippageBps(BigInt(route.estimate.toAmountMin ?? route.estimate.toAmount), env.SWAP_SLIPPAGE_BPS);
    return {
      tokenIn,
      tokenOut,
      amountInWei: amountWei,
      minAmountOutWei: minAmount,
      calldata: tx.data,
      target: tx.to,
      valueWei: BigInt(tx.value ?? 0),
    } satisfies SwapQuote;
  }

  async executeSwap(quote: SwapQuote): Promise<ExecutionResult<void>> {
    try {
      const tx = await this.signer.sendTransaction({
        to: quote.target,
        data: quote.calldata,
        value: quote.valueWei,
      });
      await tx.wait();
      logger.info({ txHash: tx.hash, tokenIn: quote.tokenIn, tokenOut: quote.tokenOut }, 'Swap executed');
      return { success: true, txHash: tx.hash };
    } catch (error) {
      logger.error({ err: error }, 'Swap failed');
      return { success: false, error: error as Error };
    }
  }

  async rebalanceToTargetMix(totalEthWei: bigint): Promise<BalanceBreakdown> {
    const targetPengu = calculateAllocation(totalEthWei, STRATEGY_CONSTANTS.penguAllocation * 100);
    const targetEth = totalEthWei - targetPengu;
    return { ethWei: targetEth, penguWei: targetPengu };
  }

  async getTokenBalances(): Promise<BalanceBreakdown> {
    const ethBalance = await this.provider.getBalance(this.signer.address);
    const pengu = new Contract(TOKENS.pengu.address, ERC20_ABI, this.provider);
    const penguBalance = await pengu.balanceOf(this.signer.address);
    return { ethWei: ethBalance, penguWei: penguBalance };
  }
}
