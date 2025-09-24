#!/usr/bin/env node
import { Command } from 'commander';
import { logger } from './logger.js';
import { StrategyRunner } from './strategy.js';
import { fromWei, toWei, weiFromGwei, scaleByPercent } from './utils.js';
import { env, STRATEGY_CONSTANTS } from './config.js';

const program = new Command();

program
  .name('bsl-pengu-bot')
  .description('Bridge → Swap → LP strategy orchestrator for Abstract Pengu')
  .version('2.0.0');

program
  .command('cycle')
  .description('Execute one full strategy cycle (withdraw → distribute → bridge → swap → LP)')
  .option('--dry-run', 'Simulate the cycle without executing real transactions')
  .action(async (options) => {
    try {
      if (options.dryRun) {
        // Dry run without creating StrategyRunner instance
        await executeDryRun();
        logger.info('Dry run cycle completed - no real transactions executed');
      } else {
        const runner = new StrategyRunner();
        await runner.executeCycle();
        const summary = runner.getLatestSummary();
        if (summary) {
          logger.info({ summary }, 'Strategy cycle completed');
        } else {
          logger.info('Strategy cycle completed');
        }
      }
    } catch (error) {
      logger.error({ err: error }, 'Strategy cycle failed');
      process.exitCode = 1;
    }
  });

program
  .command('balances')
  .description('Display strategy wallet balances on Abstract')
  .action(async () => {
    try {
      const runner = new StrategyRunner();
      const balances = await runner.getStrategyBalances();
      const readable = {
        totalEth: fromWei(balances.ethWei),
        pengu: fromWei(balances.penguWei),
        nativeEth: fromWei(balances.nativeEthWei),
        weth: fromWei(balances.wethWei),
      };
      logger.info({ balances: readable }, 'Current strategy balances');
    } catch (error) {
      logger.error({ err: error }, 'Unable to fetch balances');
      process.exitCode = 1;
    }
  });

async function executeDryRun(): Promise<void> {
  const withdrawAmountWei = toWei(env.HUB_WITHDRAW_AMOUNT);
  const gasPrice = weiFromGwei(env.GAS_PRICE_GWEI);

  logger.info('Starting DRY RUN strategy cycle (no real transactions)');

  // Simulate funding
  const fundingSource = env.BASE_FUNDING_PRIVATE_KEY ? 'BASE' : 'NONE';
  
  logger.info(`[DRY RUN] Funding source: ${fundingSource}`);
  logger.info(`[DRY RUN] Requested amount: ${fromWei(withdrawAmountWei)} ETH`);

  // Simulate distribution (without creating real wallets)
  const hubBalance = withdrawAmountWei; // Simulate full funding
  const satelliteCount = 99;
  const avgPerWallet = hubBalance / BigInt(satelliteCount);
  const fundedWallets = satelliteCount;
  const totalDistributed = hubBalance;

  logger.info(`[DRY RUN] Distribution: ${fundedWallets} wallets, ${fromWei(totalDistributed)} ETH total`);
  logger.info(`[DRY RUN] Average per wallet: ${fromWei(avgPerWallet)} ETH`);

  // Simulate bridge
  const strategyAllocation = avgPerWallet; // First satellite gets average amount
  if (strategyAllocation > 0n) {
    logger.info(`[DRY RUN] Bridge: ${fromWei(strategyAllocation)} ETH Base → Abstract`);
  } else {
    logger.warn('[DRY RUN] No funds allocated to strategy wallet');
  }

  // Simulate swap
  if (strategyAllocation > 0n) {
    const halfEth = strategyAllocation / 2n;
    logger.info(`[DRY RUN] Swap: ${fromWei(halfEth)} ETH → PENGU`);
    logger.info(`[DRY RUN] Final balances: ${fromWei(halfEth)} ETH + ${fromWei(halfEth)} PENGU`);
  }

  // Simulate LP
  if (strategyAllocation > 0n) {
    const halfEth = strategyAllocation / 2n;
    const utilization = scaleByPercent(halfEth, STRATEGY_CONSTANTS.liquidityUtilizationPercent);
    logger.info(`[DRY RUN] LP Position: ${fromWei(utilization)} ETH + ${fromWei(utilization)} PENGU`);
    logger.info(`[DRY RUN] Pool: PENGU/WETH on Uniswap V2`);
  }

  // Simulate fee collection
  logger.info('[DRY RUN] Fee collection: Triggered when fees > 3× gas cost');
  logger.info('[DRY RUN] Fee recycling: 30% PENGU → ETH, 60% reinvested');

  logger.info('[DRY RUN] Cycle simulation completed successfully!');
}

program.parseAsync(process.argv).catch((error) => {
  logger.error({ err: error }, 'Unexpected CLI failure');
  process.exit(1);
});
