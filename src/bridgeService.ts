import axios from 'axios';
import { Contract, JsonRpcProvider, Wallet } from 'ethers';
import type { TransactionRequest } from 'ethers';
import { NETWORKS, TOKENS, env } from './config.js';
import type { BridgeQuote, ExecutionResult } from './types.js';
import { applySlippageBps } from './utils.js';
import { logger } from './logger.js';

const LIFI_BASE_URL = 'https://li.quest/v1';
const LIFI_NATIVE_TOKEN = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const JUMPER_BASE_URL = 'https://api.jumper.exchange/v1';
const ERC20_ABI = ['function balanceOf(address owner) view returns (uint256)'];
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 5 * 60_000;

export class BridgeService {
  private readonly provider: JsonRpcProvider;
  private readonly destinationProvider: JsonRpcProvider;
  private readonly signer: Wallet;
  private readonly destinationTokenCache = new Map<string, Contract>();

  constructor(privateKey: string) {
    this.provider = new JsonRpcProvider(NETWORKS.base.rpcUrl, NETWORKS.base.chainId);
    this.destinationProvider = new JsonRpcProvider(
      NETWORKS.abstract.rpcUrl,
      NETWORKS.abstract.chainId,
    );
    this.signer = new Wallet(privateKey, this.provider);
  }

  async fetchQuote(amountWei: bigint): Promise<BridgeQuote> {
    try {
      return await this.fetchLifiQuote(amountWei);
    } catch (error) {
      logger.warn({ err: error }, 'LiFi quote failed, attempting Jumper fallback');
    }
    const fallback = await this.fetchJumperQuote(amountWei);
    logger.info({ routeId: fallback.routeId }, 'Jumper bridge quote received');
    return fallback;
  }

  private async fetchLifiQuote(amountWei: bigint): Promise<BridgeQuote> {
    const params = {
      fromChain: NETWORKS.base.chainId,
      toChain: NETWORKS.abstract.chainId,
      fromToken: LIFI_NATIVE_TOKEN,
      toToken: LIFI_NATIVE_TOKEN,
      fromAmount: amountWei.toString(),
      slippage: env.BRIDGE_SLIPPAGE_BPS / 100,
      fromAddress: this.signer.address,
      toAddress: this.signer.address,
      integrator: 'bsl-pengu-bot',
    } as const;

    const { data } = await axios.get(`${LIFI_BASE_URL}/quote`, { params });

    if (!data?.transactionRequest) {
      throw new Error('LiFi quote did not include transaction request');
    }

    const minAmountRaw = data?.estimate?.toAmountMin ?? data?.estimate?.toAmount;
    if (!minAmountRaw) {
      throw new Error('LiFi quote missing minimum amount estimate');
    }

    const minAmountOut = applySlippageBps(BigInt(minAmountRaw), env.BRIDGE_SLIPPAGE_BPS);
    const gasEstimate = (data?.estimate?.gasCosts ?? []).reduce<bigint>((total, cost) => {
      try {
        return total + BigInt(cost?.estimate ?? 0);
      } catch (error) {
        logger.warn({ err: error }, 'Failed to parse LiFi gas cost entry');
        return total;
      }
    }, 0n);

    const tx = data.transactionRequest;
    const txValueWei = typeof tx.value === 'string' ? BigInt(tx.value) : undefined;
    const gasLimit = typeof tx.gasLimit === 'string' ? BigInt(tx.gasLimit) : undefined;
    const gasPriceWei = typeof tx.gasPrice === 'string' ? BigInt(tx.gasPrice) : undefined;

    const quote: BridgeQuote = {
      fromChainId: NETWORKS.base.chainId,
      toChainId: NETWORKS.abstract.chainId,
      fromToken: data?.action?.fromToken?.address ?? LIFI_NATIVE_TOKEN,
      toToken: data?.action?.toToken?.address ?? LIFI_NATIVE_TOKEN,
      amountWei,
      minAmountOutWei: minAmountOut,
      routeId: data?.id ?? 'lifi-route',
      txData: tx.data,
      txTarget: tx.to,
      gasEstimate,
      txValueWei,
      gasLimit,
      gasPriceWei,
    };
    logger.info({ routeId: quote.routeId, tool: data?.tool }, 'LiFi bridge quote received');
    return quote;
  }

  private async fetchJumperQuote(amountWei: bigint): Promise<BridgeQuote> {
    const params = {
      fromChain: NETWORKS.base.chainId,
      toChain: NETWORKS.abstract.chainId,
      fromToken: TOKENS.eth.address,
      toToken: TOKENS.eth.address,
      amount: amountWei.toString(),
      slippage: env.BRIDGE_SLIPPAGE_BPS / 100,
      integratorId: 'bsl-pengu-bot',
    } as const;

    const { data } = await axios.get(`${JUMPER_BASE_URL}/quote`, { params });
    const route = data?.routes?.[0];
    if (!route?.transactionRequest) {
      throw new Error('No bridge route available from Jumper');
    }

    const minAmountRaw = route.estimate?.toAmountMin ?? route.estimate?.toAmount;
    if (!minAmountRaw) {
      throw new Error('Jumper quote missing minimum amount estimate');
    }

    const minAmountOut = applySlippageBps(BigInt(minAmountRaw), env.BRIDGE_SLIPPAGE_BPS);
    const gasEstimate = (route.estimate?.gasCosts ?? []).reduce<bigint>((total, cost) => {
      try {
        return total + BigInt(cost?.estimate ?? 0);
      } catch (error) {
        logger.warn({ err: error }, 'Failed to parse Jumper gas cost entry');
        return total;
      }
    }, 0n);

    const tx = route.transactionRequest;
    const txValueWei = typeof tx.value === 'string' ? BigInt(tx.value) : undefined;
    const gasLimit = typeof tx.gasLimit === 'string' ? BigInt(tx.gasLimit) : undefined;
    const gasPriceWei = typeof tx.gasPrice === 'string' ? BigInt(tx.gasPrice) : undefined;

    return {
      fromChainId: NETWORKS.base.chainId,
      toChainId: NETWORKS.abstract.chainId,
      fromToken: TOKENS.eth.address,
      toToken: TOKENS.eth.address,
      amountWei,
      minAmountOutWei: minAmountOut,
      routeId: route.routeId ?? 'jumper-route',
      txData: tx.data,
      txTarget: tx.to,
      gasEstimate,
      txValueWei,
      gasLimit,
      gasPriceWei,
    } satisfies BridgeQuote;
  }

  async executeBridge(quote: BridgeQuote): Promise<ExecutionResult<void>> {
    try {
      const value = quote.txValueWei ?? quote.amountWei;
      const txRequest: TransactionRequest = {
        to: quote.txTarget,
        data: quote.txData,
        value,
      };
      if (quote.gasLimit) {
        txRequest.gasLimit = quote.gasLimit;
      }
      if (quote.gasPriceWei) {
        txRequest.gasPrice = quote.gasPriceWei;
      }

      const tx = await this.signer.sendTransaction(txRequest);
      logger.info({ txHash: tx.hash, routeId: quote.routeId }, 'Bridge transaction submitted');
      await tx.wait();
      return { success: true, txHash: tx.hash };
    } catch (error) {
      logger.error({ err: error }, 'Bridge transaction failed');
      return { success: false, error: error as Error };
    }
  }

  async getDestinationTokenBalance(tokenAddress: string): Promise<bigint> {
    if (!tokenAddress || tokenAddress.toLowerCase() === LIFI_NATIVE_TOKEN.toLowerCase()) {
      return this.destinationProvider.getBalance(this.signer.address);
    }

    const address = tokenAddress.toLowerCase();
    let contract = this.destinationTokenCache.get(address);
    if (!contract) {
      contract = new Contract(tokenAddress, ERC20_ABI, this.destinationProvider);
      this.destinationTokenCache.set(address, contract);
    }
    const balance = await contract.balanceOf(this.signer.address);
    return balance.toBigInt();
  }

  async waitForDestinationFunds(
    tokenAddress: string,
    startingBalance: bigint,
    minimumIncreaseWei: bigint,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  ): Promise<boolean> {
    if (minimumIncreaseWei <= 0n) return true;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const current = await this.getDestinationTokenBalance(tokenAddress);
      if (current >= startingBalance + minimumIncreaseWei) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
    return false;
  }

  estimateTotalCost(quote: BridgeQuote, fallbackGasPrice: bigint): bigint {
    const valueWei = quote.txValueWei ?? quote.amountWei;
    const gasLimit = quote.gasLimit ?? quote.gasEstimate ?? 0n;
    const gasPrice = quote.gasPriceWei ?? fallbackGasPrice;
    const gasCost = gasLimit > 0n ? gasLimit * gasPrice : 0n;
    return valueWei + gasCost;
  }
}
