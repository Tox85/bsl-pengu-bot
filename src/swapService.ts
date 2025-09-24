import axios from 'axios';
import { Contract, JsonRpcProvider, Wallet } from 'ethers';
import { NETWORKS, TOKENS, env, STRATEGY_CONSTANTS } from './config.js';
import type { BalanceBreakdown, ExecutionResult, SwapQuote } from './types.js';
import { applySlippageBps, calculateAllocation } from './utils.js';
import { logger } from './logger.js';

const JUMPER_BASE_URL = 'https://api.jumper.exchange/v1';
const ERC20_ABI = ['function balanceOf(address owner) view returns (uint256)'];
const WETH_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function deposit() payable',
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
    logger.info({ amountWei: amountWei.toString() }, 'Wrapped native ETH into WETH');
  }

  async ensureWethBalance(targetWei: bigint, maxWrapFromNative?: bigint) {
    const current = (await this.weth.balanceOf(this.signer.address)).toBigInt();
    if (current >= targetWei) return;
    const shortfall = targetWei - current;
    const cap = typeof maxWrapFromNative === 'bigint' ? maxWrapFromNative : shortfall;
    const wrapAmount = shortfall > cap ? cap : shortfall;
    if (wrapAmount > 0n) {
      await this.wrapNative(wrapAmount);
    }
  }
}
