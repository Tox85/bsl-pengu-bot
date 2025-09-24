import axios from 'axios';
import { JsonRpcProvider, Wallet } from 'ethers';
import type { TransactionRequest } from 'ethers';
import { NETWORKS, env } from './config.js';
import type { BridgeQuote, ExecutionResult } from './types.js';
import { applySlippageBps } from './utils.js';
import { logger } from './logger.js';

const LIFI_BASE_URL = 'https://li.quest/v1';
const LIFI_NATIVE_TOKEN = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

export class BridgeService {
  private readonly provider: JsonRpcProvider;
  private readonly signer: Wallet;

  constructor(privateKey: string) {
    this.provider = new JsonRpcProvider(NETWORKS.base.rpcUrl, NETWORKS.base.chainId);
    this.signer = new Wallet(privateKey, this.provider);
  }

  async fetchQuote(amountWei: bigint): Promise<BridgeQuote> {
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

  async executeBridge(quote: BridgeQuote): Promise<ExecutionResult<void>> {
    try {
      const txRequest: TransactionRequest = {
        to: quote.txTarget,
        data: quote.txData,
        value: quote.txValueWei ?? quote.amountWei,
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
}
