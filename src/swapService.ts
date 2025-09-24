import axios from 'axios';
import { Contract, JsonRpcProvider, Wallet } from 'ethers';
import { NETWORKS, TOKENS, env, STRATEGY_CONSTANTS } from './config.js';
import type { BalanceBreakdown, ExecutionResult, SwapQuote } from './types.js';
import { applySlippageBps, calculateAllocation, fromWei } from './utils.js';
import { logger } from './logger.js';

const LIFI_BASE_URL = 'https://li.quest/v1';
const LIFI_NATIVE_TOKEN = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 value) returns (bool)',
];
const WETH_ABI = [...ERC20_ABI, 'function deposit() payable'];
const MAX_ALLOWANCE = (1n << 256n) - 1n;

export class SwapService {
  private readonly provider: JsonRpcProvider;
  private readonly signer: Wallet;
  private readonly weth: Contract;
  private readonly pengu: Contract;
  private readonly tokenContracts: Map<string, Contract>;

  constructor(privateKey: string) {
    this.provider = new JsonRpcProvider(NETWORKS.abstract.rpcUrl, NETWORKS.abstract.chainId);
    this.signer = new Wallet(privateKey, this.provider);
    this.weth = new Contract(TOKENS.eth.address, WETH_ABI, this.signer);
    this.pengu = new Contract(TOKENS.pengu.address, ERC20_ABI, this.signer);
    this.tokenContracts = new Map([
      [TOKENS.eth.address.toLowerCase(), this.weth],
      [TOKENS.pengu.address.toLowerCase(), this.pengu],
    ]);
  }

  async fetchQuote(tokenIn: string, tokenOut: string, amountWei: bigint): Promise<SwapQuote> {
    if (amountWei <= 0n) {
      throw new Error('Cannot fetch swap quote for zero amount');
    }

    const params = {
      fromChain: NETWORKS.abstract.chainId,
      toChain: NETWORKS.abstract.chainId,
      fromToken: tokenIn,
      toToken: tokenOut,
      fromAmount: amountWei.toString(),
      slippage: env.SWAP_SLIPPAGE_BPS / 100,
      integrator: 'bsl-pengu-bot',
    } as const;

    const { data } = await axios.get(`${LIFI_BASE_URL}/quote`, { params });
    const tx = data?.transactionRequest;
    if (!tx) throw new Error('Unable to fetch swap quote from LiFi');
    const minAmountRaw = data?.estimate?.toAmountMin ?? data?.estimate?.toAmount;
    if (!minAmountRaw) {
      throw new Error('LiFi swap quote missing minimum amount estimate');
    }

    const minAmount = applySlippageBps(BigInt(minAmountRaw), env.SWAP_SLIPPAGE_BPS);
    const valueWei = typeof tx.value === 'string' ? BigInt(tx.value) : BigInt(tx.value ?? 0);
    const allowanceTarget = data?.estimate?.approvalAddress ?? undefined;
    if (!tx.to || !tx.data) {
      throw new Error('LiFi swap quote missing transaction request details');
    }

    return {
      tokenIn,
      tokenOut,
      amountInWei: amountWei,
      minAmountOutWei: minAmount,
      calldata: tx.data,
      target: tx.to,
      valueWei,
      allowanceTarget,
    } satisfies SwapQuote;
  }

  async executeSwap(quote: SwapQuote): Promise<ExecutionResult<void>> {
    try {
      if (quote.allowanceTarget && quote.tokenIn.toLowerCase() !== LIFI_NATIVE_TOKEN.toLowerCase()) {
        await this.ensureAllowance(quote.tokenIn, quote.allowanceTarget, quote.amountInWei);
      }
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
    logger.info({ amountEth: fromWei(amountWei) }, 'Wrapped native ETH into WETH');
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

  private getTokenContract(address: string): Contract | null {
    return this.tokenContracts.get(address.toLowerCase()) ?? null;
  }

  private async ensureAllowance(tokenAddress: string, spender: string, amountWei: bigint) {
    if (!spender) return;
    const token = this.getTokenContract(tokenAddress);
    if (!token) return;
    const currentAllowance = (await token.allowance(this.signer.address, spender)).toBigInt();
    if (currentAllowance >= amountWei) return;
    const tx = await token.approve(spender, MAX_ALLOWANCE);
    await tx.wait();
    logger.info({ token: tokenAddress, spender, txHash: tx.hash }, 'Approved token allowance for swap');
  }
}
