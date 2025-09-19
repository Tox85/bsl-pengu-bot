#!/usr/bin/env node

import { Command } from 'commander';
import { bridgeService } from '../bridge/index.js';
import { CONSTANTS } from '../config/env.js';
import { logger } from '../core/logger.js';
import { parseAmount } from '../core/math.js';

const program = new Command();

program
  .name('bridge')
  .description('CLI pour le module Bridge (Base → Abstract)')
  .version('1.0.0');

program
  .command('route')
  .description('Obtenir une route de bridge')
  .requiredOption('--from <chain>', 'Chaîne source (base)')
  .requiredOption('--to <chain>', 'Chaîne destination (abstract)')
  .requiredOption('--toToken <token>', 'Token de destination (ETH|USDC)')
  .requiredOption('--amount <amount>', 'Montant à bridger')
  .option('--slippage <slippage>', 'Slippage en BPS', '50')
  .action(async (options) => {
    try {
      logger.info({
        from: options.from,
        to: options.to,
        toToken: options.toToken,
        amount: options.amount,
        slippage: options.slippage,
        message: 'Recherche de route de bridge'
      });

      const params = {
        fromChainId: CONSTANTS.CHAIN_IDS.BASE,
        toChainId: CONSTANTS.CHAIN_IDS.ABSTRACT,
        fromTokenAddress: CONSTANTS.NATIVE_ADDRESS, // ETH sur Base
        toTokenAddress: options.toToken === 'ETH' ? CONSTANTS.NATIVE_ADDRESS : CONSTANTS.TOKENS.USDC,
        amount: parseAmount(options.amount, 18).toString(),
        fromAddress: '0x0000000000000000000000000000000000000000', // Placeholder
        toAddress: '0x0000000000000000000000000000000000000000', // Placeholder
        slippage: parseInt(options.slippage),
      };

      const route = await bridgeService.getBridgeRoute(params);

      console.log('\n🔗 Route de bridge trouvée:');
      console.log(`  ID: ${route.id}`);
      console.log(`  De: ${route.fromToken.symbol} (${route.fromChainId})`);
      console.log(`  Vers: ${route.toToken.symbol} (${route.toChainId})`);
      console.log(`  Montant: ${route.fromAmount} ${route.fromToken.symbol}`);
      console.log(`  Reçu: ${route.toAmount} ${route.toToken.symbol}`);
      console.log(`  Outil: ${route.tool}`);
      console.log(`  Bridge: ${route.bridgeUsed}`);
      console.log(`  Étapes: ${route.steps.length}`);

      if (route.estimate.feeCosts.length > 0) {
        console.log('\n💰 Frais:');
        route.estimate.feeCosts.forEach((fee) => {
          console.log(`  ${fee.name}: ${fee.amount} ${fee.token.symbol} (${fee.amountUSD} USD)`);
        });
      }

      if (route.estimate.gasCosts.length > 0) {
        console.log('\n⛽ Gas:');
        route.estimate.gasCosts.forEach((gas) => {
          console.log(`  ${gas.type}: ${gas.amount} ${gas.token.symbol} (${gas.amountUSD} USD)`);
        });
      }

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : 'Unknown error',
        message: 'Erreur lors de la recherche de route'
      });
      process.exit(1);
    }
  });

program
  .command('execute')
  .description('Exécuter un bridge')
  .requiredOption('--privateKey <key>', 'Clé privée du wallet')
  .requiredOption('--toToken <token>', 'Token de destination (ETH|USDC)')
  .requiredOption('--amount <amount>', 'Montant à bridger')
  .option('--slippage <slippage>', 'Slippage en BPS', '50')
  .option('--dry-run', 'Mode simulation (pas de transaction réelle)', false)
  .action(async (options) => {
    try {
      logger.info({
        toToken: options.toToken,
        amount: options.amount,
        slippage: options.slippage,
        dryRun: options.dryRun,
        message: 'Exécution du bridge'
      });

      const params = {
        fromChainId: CONSTANTS.CHAIN_IDS.BASE,
        toChainId: CONSTANTS.CHAIN_IDS.ABSTRACT,
        fromTokenAddress: CONSTANTS.NATIVE_ADDRESS, // ETH sur Base
        toTokenAddress: options.toToken === 'ETH' ? CONSTANTS.NATIVE_ADDRESS : CONSTANTS.TOKENS.USDC,
        amount: parseAmount(options.amount, 18).toString(),
        fromAddress: '0x0000000000000000000000000000000000000000', // Sera remplacé par l'adresse du wallet
        toAddress: '0x0000000000000000000000000000000000000000', // Sera remplacé par l'adresse du wallet
        slippage: parseInt(options.slippage),
      };

      // Obtenir la route
      const route = await bridgeService.getBridgeRoute(params);

      // Exécuter le bridge
      const result = await bridgeService.executeRoute(route, options.privateKey, {
        dryRun: options.dryRun,
      });

      if (result.success) {
        console.log('\n✅ Bridge exécuté avec succès!');
        if (result.txHash) {
          console.log(`  TX Hash: ${result.txHash}`);
        }
        if (result.status) {
          console.log(`  Statut: ${result.status.status}`);
        }
      } else {
        console.log('\n❌ Bridge échoué:');
        console.log(`  Erreur: ${result.error}`);
        process.exit(1);
      }

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : 'Unknown error',
        message: 'Erreur lors de l\'exécution du bridge'
      });
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Vérifier le statut d\'un bridge')
  .requiredOption('--txHash <hash>', 'Hash de la transaction')
  .action(async (options) => {
    try {
      logger.info({
        txHash: options.txHash,
        message: 'Vérification du statut du bridge'
      });

      const status = await bridgeService.waitBridgeSettled(
        options.txHash,
        CONSTANTS.CHAIN_IDS.ABSTRACT
      );

      console.log('\n📊 Statut du bridge:');
      console.log(`  Statut: ${status.status}`);
      console.log(`  Bridge: ${status.bridge}`);
      console.log(`  TX Hash: ${status.txHash}`);
      console.log(`  De: ${status.fromToken.symbol} (${status.fromChainId})`);
      console.log(`  Vers: ${status.toToken.symbol} (${status.toChainId})`);
      console.log(`  Montant: ${status.fromAmount} ${status.fromToken.symbol}`);
      console.log(`  Reçu: ${status.toAmount} ${status.toToken.symbol}`);

      if (status.sendingTx) {
        console.log(`\n📤 Transaction d'envoi:`);
        console.log(`  Hash: ${status.sendingTx.hash}`);
        console.log(`  Block: ${status.sendingTx.blockNumber}`);
      }

      if (status.receivingTx) {
        console.log(`\n📥 Transaction de réception:`);
        console.log(`  Hash: ${status.receivingTx.hash}`);
        console.log(`  Block: ${status.receivingTx.blockNumber}`);
      }

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : 'Unknown error',
        message: 'Erreur lors de la vérification du statut'
      });
      process.exit(1);
    }
  });

// Parser les arguments de la ligne de commande
program.parse();
