import type { BalanceBreakdown, FeeSnapshot } from './types.js';
import { STRATEGY_CONSTANTS, TOKENS } from './config.js';
import { logger } from './logger.js';
import { SwapService } from './swapService.js';
import { fromWei } from './utils.js';

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
      const quoteResult = await this.swapService.fetchQuote(
        TOKENS.pengu.address,
        TOKENS.eth.address,
        penguToSwap,
      );
      if (!quoteResult.success || !quoteResult.data) {
        logger.warn(
          {
            penguToSwap: fromWei(penguToSwap),
            error: quoteResult.error?.message ?? 'Swap quote unavailable',
          },
          'Unable to obtain swap quote while recycling fees',
        );
      } else {
        const result = await this.swapService.executeSwap(quoteResult.data);
        if (!result.success) {
          logger.warn({ error: result.error }, 'Failed to swap PENGU fees to ETH');
        } else {
          swappedEth = quoteResult.data.minAmountOutWei;
        }
      }
    }

    const reinvestEth = scalePercent(fees.accruedEth + swappedEth, STRATEGY_CONSTANTS.feeReinvestPercent * 100);
    const reinvestPengu = scalePercent(fees.accruedPengu - penguToSwap, STRATEGY_CONSTANTS.feeReinvestPercent * 100);
    logger.info(
      { reinvestEth: fromWei(reinvestEth), reinvestPengu: fromWei(reinvestPengu) },
      'Fees recycled for compounding',
    );
    return {
      ethWei: reinvestEth,
      penguWei: reinvestPengu,
      nativeEthWei: 0n,
      wethWei: reinvestEth,
    };
  }
}
