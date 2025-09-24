import axios from 'axios';
import { JsonRpcProvider, Wallet } from 'ethers';
import { NETWORKS, TOKENS, env } from './config.js';
import type { BridgeQuote, ExecutionResult } from './types.js';
import { applySlippageBps } from './utils.js';
import { logger } from './logger.js';

const JUMPER_BASE_URL = 'https://api.jumper.exchange/v1';

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
      fromToken: TOKENS.eth.address,
      toToken: TOKENS.eth.address,
      amount: amountWei.toString(),
      slippage: env.BRIDGE_SLIPPAGE_BPS / 100,
      integratorId: 'bsl-pengu-bot',
    } as const;

    const { data } = await axios.get(`${JUMPER_BASE_URL}/quote`, { params });
    const route = data?.routes?.[0];
    if (!route) {
      throw new Error('No bridge route available from Jumper');
    }

    const tx = route.transactionRequest;
    const minAmountOut = applySlippageBps(BigInt(route.estimate.toAmountMin ?? route.estimate.toAmount), env.BRIDGE_SLIPPAGE_BPS);

    const quote: BridgeQuote = {
      fromChainId: NETWORKS.base.chainId,
      toChainId: NETWORKS.abstract.chainId,
      fromToken: TOKENS.eth.address,
      toToken: TOKENS.eth.address,
      amountWei,
      minAmountOutWei: minAmountOut,
      routeId: route.routeId,
      txData: tx.data,
      txTarget: tx.to,
      gasEstimate: BigInt(route.estimate.gasCosts?.[0]?.estimate ?? 0),
    };
    logger.info({ routeId: quote.routeId }, 'Bridge quote received');
    return quote;
  }

  async executeBridge(quote: BridgeQuote): Promise<ExecutionResult<void>> {
    try {
      const tx = await this.signer.sendTransaction({
        to: quote.txTarget,
        data: quote.txData,
        value: quote.amountWei,
      });
      logger.info({ txHash: tx.hash, routeId: quote.routeId }, 'Bridge transaction submitted');
      await tx.wait();
      return { success: true, txHash: tx.hash };
    } catch (error) {
      logger.error({ err: error }, 'Bridge transaction failed');
      return { success: false, error: error as Error };
    }
  }
}
