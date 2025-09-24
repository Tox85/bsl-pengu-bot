import ccxt from 'ccxt';
import { formatUnits } from 'ethers';
import { env } from './config.js';
import type { ExecutionResult } from './types.js';
import { logger } from './logger.js';

export class BybitClient {
  private readonly client: InstanceType<typeof ccxt.bybit>;

  constructor() {
    this.client = new ccxt.bybit({
      apiKey: env.BYBIT_API_KEY,
      secret: env.BYBIT_API_SECRET,
      enableRateLimit: true,
    });
  }

  async withdrawEthToHub(amountWei: bigint, address: string): Promise<ExecutionResult<void>> {
    try {
      const amount = formatUnits(amountWei, 18);
      const response = await this.client.withdraw('ETH', Number(amount), address, undefined, {
        chain: 'ETH',
      });
      logger.info({ response }, 'Bybit withdrawal initiated');
      return { success: true, data: undefined, txHash: response?.id };
    } catch (error) {
      logger.error({ err: error }, 'Failed to withdraw from Bybit');
      return { success: false, error: error as Error };
    }
  }

  async fetchAvailableEth(): Promise<bigint> {
    const balances = await this.client.fetchBalance({ type: 'spot' });
    const freeBalances = balances.free ?? {};
    let amount = 0;
    if (typeof freeBalances === 'object' && freeBalances !== null && 'ETH' in freeBalances) {
      const value = (freeBalances as Record<string, unknown>)['ETH'];
      if (typeof value === 'string' || typeof value === 'number') {
        amount = Number(value);
      }
    }
    logger.debug({ amount }, 'Fetched Bybit ETH balance');
    return BigInt(Math.floor(amount * 1e18));
  }
}
