#!/usr/bin/env node

import { Command } from 'commander';
import { swapService } from '../dex/index.js';
import { CONSTANTS } from '../config/env.js';
import { logger } from '../core/logger.js';
import { parseAmount, formatAmount } from '../core/math.js';

const program = new Command();

program
  .name('swap')
  .description('CLI pour le module Swap (Pandora/Uniswap v3)')
  .version('1.0.0');

program
  .command('quote')
  .description('Obtenir un quote pour un swap')
  .requiredOption('--tokenIn <token>', 'Token d\'entrée (ETH|USDC|PENGU)')
  .requiredOption('--tokenOut <token>', 'Token de sortie (ETH|USDC|PENGU)')
  .requiredOption('--amount <amount>', 'Montant à swapper')
  .option('--fee <fee>', 'Fee tier du pool (500|3000|10000)', '0')
  .action(async (options) => {
    try {
      logger.info({
        tokenIn: options.tokenIn,
        tokenOut: options.tokenOut,
        amount: options.amount,
        fee: options.fee,
        message: 'Calcul du quote de swap'
      });

      const tokenIn = getTokenAddress(options.tokenIn);
      const tokenOut = getTokenAddress(options.tokenOut);
      const amountIn = parseAmount(options.amount, 18);

      const quote = await swapService.getQuote({
        tokenIn,
        tokenOut,
        amountIn,
        fee: options.fee ? parseInt(options.fee) : undefined,
      });

      console.log('\n💱 Quote de swap:');
      console.log(`  Token In: ${options.tokenIn} (${tokenIn})`);
      console.log(`  Token Out: ${options.tokenOut} (${tokenOut})`);
      console.log(`  Montant In: ${formatAmount(amountIn, 18)} ${options.tokenIn}`);
      console.log(`  Montant Out: ${formatAmount(quote.amountOut, 18)} ${options.tokenOut}`);
      console.log(`  Pool: ${quote.pool.address}`);
      console.log(`  Fee: ${quote.pool.fee} (${quote.pool.fee / 100}%)`);
      console.log(`  Tick: ${quote.pool.tick}`);
      console.log(`  Liquidité: ${quote.pool.liquidity.toString()}`);
      console.log(`  Gas Estimaté: ${quote.gasEstimate.toString()}`);

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : 'Unknown error',
        message: 'Erreur lors du calcul du quote'
      });
      process.exit(1);
    }
  });

program
  .command('execute')
  .description('Exécuter un swap')
  .requiredOption('--privateKey <key>', 'Clé privée du wallet')
  .requiredOption('--tokenIn <token>', 'Token d\'entrée (ETH|USDC|PENGU)')
  .requiredOption('--tokenOut <token>', 'Token de sortie (ETH|USDC|PENGU)')
  .requiredOption('--amount <amount>', 'Montant à swapper')
  .option('--slippage <slippage>', 'Slippage en BPS', '80')
  .option('--fee <fee>', 'Fee tier du pool (500|3000|10000)', '0')
  .option('--dry-run', 'Mode simulation (pas de transaction réelle)', false)
  .action(async (options) => {
    try {
      logger.info({
        tokenIn: options.tokenIn,
        tokenOut: options.tokenOut,
        amount: options.amount,
        slippage: options.slippage,
        fee: options.fee,
        dryRun: options.dryRun,
        message: 'Exécution du swap'
      });

      const tokenIn = getTokenAddress(options.tokenIn);
      const tokenOut = getTokenAddress(options.tokenOut);
      const amountIn = parseAmount(options.amount, 18);

      const result = await swapService.executeSwap({
        tokenIn,
        tokenOut,
        amountIn,
        slippageBps: parseInt(options.slippage),
        recipient: '0x0000000000000000000000000000000000000000', // Sera remplacé par l'adresse du wallet
        fee: options.fee ? parseInt(options.fee) : undefined,
      }, options.privateKey, {
        dryRun: options.dryRun,
      });

      if (result.success) {
        console.log('\n✅ Swap exécuté avec succès!');
        console.log(`  Pool: ${result.pool.address}`);
        console.log(`  Token In: ${options.tokenIn}`);
        console.log(`  Token Out: ${options.tokenOut}`);
        console.log(`  Montant In: ${formatAmount(amountIn, 18)} ${options.tokenIn}`);
        console.log(`  Montant Out: ${formatAmount(result.amountOut, 18)} ${options.tokenOut}`);
        console.log(`  Montant Min: ${formatAmount(result.amountOutMin, 18)} ${options.tokenOut}`);
        if (result.txHash) {
          console.log(`  TX Hash: ${result.txHash}`);
        }
      } else {
        console.log('\n❌ Swap échoué:');
        console.log(`  Erreur: ${result.error}`);
        process.exit(1);
      }

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : 'Unknown error',
        message: 'Erreur lors de l\'exécution du swap'
      });
      process.exit(1);
    }
  });

program
  .command('pools')
  .description('Lister les pools disponibles')
  .requiredOption('--tokenA <token>', 'Premier token (ETH|USDC|PENGU)')
  .requiredOption('--tokenB <token>', 'Deuxième token (ETH|USDC|PENGU)')
  .action(async (options) => {
    try {
      logger.info({
        tokenA: options.tokenA,
        tokenB: options.tokenB,
        message: 'Recherche des pools disponibles'
      });

      const tokenA = getTokenAddress(options.tokenA);
      const tokenB = getTokenAddress(options.tokenB);

      const pools = await swapService.getAllPools({
        tokenA,
        tokenB,
        feeTiers: CONSTANTS.UNIV3.FEE_TIERS,
      });

      if (pools.length === 0) {
        console.log('\n❌ Aucun pool trouvé pour cette paire');
        return;
      }

      console.log('\n🏊 Pools disponibles:');
      pools.forEach((pool, index) => {
        console.log(`\n  Pool ${index + 1}:`);
        console.log(`    Adresse: ${pool.address}`);
        console.log(`    Token0: ${pool.token0}`);
        console.log(`    Token1: ${pool.token1}`);
        console.log(`    Fee: ${pool.fee} (${pool.fee / 100}%)`);
        console.log(`    Tick Spacing: ${pool.tickSpacing}`);
        console.log(`    Liquidité: ${pool.liquidity.toString()}`);
        console.log(`    Tick: ${pool.tick}`);
        console.log(`    SqrtPriceX96: ${pool.sqrtPriceX96.toString()}`);
      });

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : 'Unknown error',
        message: 'Erreur lors de la recherche des pools'
      });
      process.exit(1);
    }
  });

// Fonction utilitaire pour obtenir l'adresse d'un token
function getTokenAddress(token: string): string {
  switch (token.toUpperCase()) {
    case 'ETH':
      return CONSTANTS.NATIVE_ADDRESS;
    case 'USDC':
      return CONSTANTS.TOKENS.USDC;
    case 'PENGU':
      return CONSTANTS.TOKENS.PENGU;
    default:
      throw new Error(`Token non supporté: ${token}`);
  }
}

// Parser les arguments de la ligne de commande
program.parse();
