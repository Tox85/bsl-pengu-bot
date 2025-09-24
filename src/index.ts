#!/usr/bin/env node
import { Command } from 'commander';
import { logger } from './logger.js';
import { StrategyRunner } from './strategy.js';

const program = new Command();

program
  .name('bsl-pengu-bot')
  .description('Bridge → Swap → LP strategy orchestrator for Abstract Pengu')
  .version('2.0.0');

program
  .command('cycle')
  .description('Execute one full strategy cycle (withdraw → distribute → bridge → swap → LP)')
  .action(async () => {
    try {
      const runner = new StrategyRunner();
      const report = await runner.executeCycle();
      logger.info({ report }, 'Strategy cycle completed');
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
      logger.info({ balances }, 'Current strategy balances');
    } catch (error) {
      logger.error({ err: error }, 'Unable to fetch balances');
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv).catch((error) => {
  logger.error({ err: error }, 'Unexpected CLI failure');
  process.exit(1);
});
