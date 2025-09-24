import axios from 'axios';
import { JsonRpcProvider, Wallet, parseUnits } from 'ethers';
import type { TransactionRequest } from 'ethers';
import { NETWORKS, env } from './config.js';
import type { BridgeQuote, ExecutionResult } from './types.js';
import { applySlippageBps } from './utils.js';
import { logger } from './logger.js';

const LIFI_BASE_URL = 'https://li.quest/v1';
const LIFI_NATIVE_TOKEN = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

// Throttling pour éviter les rate limits
let lastCall = 0;
async function throttle(ms = 400) {
  const now = Date.now();
  const wait = Math.max(0, lastCall + ms - now);
  if (wait) await new Promise(r => setTimeout(r, wait));
  lastCall = Date.now();
}

// Retry avec backoff exponentiel
async function with429Retry<T>(fn: () => Promise<T>, max = 5): Promise<T> {
  let base = 1000; // 1s
  for (let i = 1; i <= max; i++) {
    try {
      await throttle();
      return await fn();
    } catch (e: any) {
      const status = e?.response?.status;
      const isTimeout = e?.code === 'ECONNABORTED' || e?.message?.includes('timeout');
      const is429 = status === 429;

      if (!is429 && !isTimeout) throw e;
      if (i === max) throw e;

      let delay: number;
      if (is429) {
        const ra = Number(e.response?.headers?.["retry-after"]);
        const retryAfterMs = Number.isFinite(ra) ? ra * 1000 : base;
        const jitter = 200 + Math.floor(Math.random() * 600);
        delay = Math.min(15_000, retryAfterMs + jitter);

        logger.warn({
          attempt: i,
          maxRetries: max,
          delay,
          retryAfter: ra,
          message: "Rate limit Li.Fi, retry en cours"
        });
      } else {
        delay = Math.min(15_000, base * i);
        logger.warn({
          attempt: i,
          maxRetries: max,
          delay,
          message: "Timeout Li.Fi, retry en cours"
        });
      }

      await new Promise(r => setTimeout(r, delay));
      base = Math.min(base * 2, 15_000);
    }
  }
  throw new Error('Max retries exceeded');
}

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
      fromAddress: this.signer.address,
      toAddress: this.signer.address,
      slippage: env.BRIDGE_SLIPPAGE_BPS / 100,
    } as const;

    logger.info({
      ...params,
      amountWei: amountWei.toString(),
      message: "LiFi quote request"
    });

    const data = await with429Retry(async () => {
      const response = await axios.get(`${LIFI_BASE_URL}/quote`, { 
        params,
        timeout: 60_000 // 60 secondes timeout
      });
      return response.data;
    });

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
    
    logger.info({ 
      routeId: quote.routeId, 
      tool: data?.tool,
      fromAmount: amountWei.toString(),
      toAmount: minAmountRaw,
      message: 'LiFi bridge quote received'
    });
    return quote;
  }

  async executeBridge(quote: BridgeQuote): Promise<ExecutionResult<void>> {
    try {
      // Construire la transaction exactement comme LiFi l'a fournie
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

      logger.info({
        to: txRequest.to,
        dataLength: quote.txData.length,
        value: (txRequest.value ?? 0n).toString(),
        gasLimit: quote.gasLimit?.toString(),
        gasPrice: quote.gasPriceWei?.toString(),
        message: "Exécution transaction bridge Li.Fi"
      });

      // Envoyer la transaction
      const sent = await this.signer.sendTransaction(txRequest);
      logger.info({ txHash: sent.hash, routeId: quote.routeId }, 'Bridge transaction submitted');
      
      // Attendre la confirmation
      const receipt = await sent.wait();
      
      if (receipt.status !== 1) {
        throw new Error(`Bridge tx revert (hash ${receipt.hash})`);
      }

      logger.info({
        txHash: receipt.hash,
        gasUsed: receipt.gasUsed.toString(),
        message: "Transaction bridge confirmée"
      });

      return { success: true, txHash: receipt.hash };
    } catch (error) {
      logger.error({ err: error }, 'Bridge transaction failed');
      return { success: false, error: error as Error };
    }
  }

  async waitUntilReceived(txHash: string, timeoutMs = 10 * 60_000): Promise<any> {
    const started = Date.now();
    const timeout = timeoutMs;

    logger.info({
      txHash,
      message: "Attente confirmation bridge Li.Fi"
    });

    while (true) {
      try {
        const res = await with429Retry(async () => {
          const response = await axios.get(`${LIFI_BASE_URL}/status`, { 
            params: {
              txHash,
              fromChain: NETWORKS.base.chainId,
              toChain: NETWORKS.abstract.chainId
            },
            timeout: 30_000
          });
          return response.data;
        });

        const status = res?.status;
        logger.info({
          status,
          txHash,
          message: "Statut bridge Li.Fi"
        });

        if (status === "DONE" || status === "RECEIVED") {
          logger.info({
            status,
            txHash,
            message: "Bridge reçu avec succès"
          });
          return res;
        }
        
        if (Date.now() - started > timeout) {
          logger.error({
            status,
            txHash,
            timeoutMs: timeout,
            message: "Bridge status timeout"
          });
          throw new Error(`Bridge status timeout: ${status ?? "unknown"}`);
        }

        await new Promise(r => setTimeout(r, 3000));
      } catch (error) {
        if (Date.now() - started > timeout) {
          throw error;
        }
        logger.warn({ err: error, txHash }, 'Erreur lors de la vérification du statut, retry dans 5s');
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }
}
