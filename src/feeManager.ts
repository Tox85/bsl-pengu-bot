import type { BalanceBreakdown, FeeSnapshot } from './types.js';
import { STRATEGY_CONSTANTS, TOKENS } from './config.js';
import { logger } from './logger.js';
import { SwapService } from './swapService.js';

const scalePercent = (value: bigint, percent: number): bigint => {
  const bps = BigInt(Math.round(percent * 100));
  return (value * bps) / 10000n;
};

export class FeeManager {
  constructor(private readonly swapService: SwapService) {}

  async recycleFees(fees: FeeSnapshot): Promise<BalanceBreakdown> {
    const penguToSwap = scalePercent(fees.accruedPengu, STRATEGY_CONSTANTS.penguToEthSafetySwapPercent * 100);
    let swappedEth = 0n;
    if (penguToSwap > 0n) {
      const quote = await this.swapService.fetchQuote(TOKENS.pengu.address, TOKENS.eth.address, penguToSwap);
      const result = await this.swapService.executeSwap(quote);
      if (!result.success) {
        logger.warn({ error: result.error }, 'Failed to swap PENGU fees to ETH');
      } else {
        swappedEth = quote.minAmountOutWei;
      }
    }

    const reinvestEth = scalePercent(fees.accruedEth + swappedEth, STRATEGY_CONSTANTS.feeReinvestPercent * 100);
    const reinvestPengu = scalePercent(fees.accruedPengu - penguToSwap, STRATEGY_CONSTANTS.feeReinvestPercent * 100);
    logger.info({ reinvestEth, reinvestPengu }, 'Fees recycled for compounding');
    return { ethWei: reinvestEth, penguWei: reinvestPengu };
  }
}
