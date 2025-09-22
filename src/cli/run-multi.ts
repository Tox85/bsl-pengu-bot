#!/usr/bin/env node

import { Command } from 'commander';
import { logger } from '../core/logger.js';
import { MultiWalletOrchestrator } from '../orchestrator/multi-wallet-orchestrator.js';
import { cfg } from '../config/env.js';
import { validateConfig } from '../config/validator.js';

const program = new Command();

program
  .name('run-multi')
  .description('Exécuter la séquence complète pour plusieurs wallets')
  .option('--dry-run', 'Simuler l\'exécution sans l\'effectuer')
  .option('--from <index>', 'Index de départ', '0')
  .option('--to <index>', 'Index de fin', '10')
  .option('--batch-size <size>', 'Taille des batches pour l\'exécution', '5')
  .option('--sequential', 'Exécuter les wallets séquentiellement (par défaut: parallèle)')
  .option('--max-concurrent <count>', 'Nombre maximum de wallets en parallèle', '5')
  .option('--bridge-amount <amount>', 'Montant à bridger par wallet', '1')
  .option('--swap-amount <amount>', 'Montant à swapper par wallet', '5')
  .option('--lp-range <percent>', 'Range de LP en pourcentage', '5')
  .option('--collect-after <minutes>', 'Attendre X minutes avant de collecter', '10')
  .option('--auto-gas-topup', 'Activer le top-up automatique de gas')
  .option('--auto-token-topup', 'Activer le top-up automatique de tokens')
  .action(async (options) => {
    try {
      // Validation de la configuration
      if (!validateConfig(cfg)) {
        process.exit(1);
      }

      // Vérifier les prérequis
      if (!cfg.MNEMONIC) {
        logger.error('MNEMONIC requis');
        process.exit(1);
      }

      if (!cfg.BYBIT_API_KEY || !cfg.BYBIT_API_SECRET) {
        logger.error('Clés API Bybit requises');
        process.exit(1);
      }

      if (!cfg.HUB_WALLET_PRIVATE_KEY) {
        logger.error('HUB_WALLET_PRIVATE_KEY requis');
        process.exit(1);
      }

      // Paramètres de la plage
      const fromIndex = parseInt(options.from);
      const toIndex = parseInt(options.to);
      const walletCount = toIndex - fromIndex + 1;

      if (isNaN(fromIndex) || isNaN(toIndex) || fromIndex < 0 || toIndex < fromIndex) {
        logger.error('Paramètres de plage invalides');
        process.exit(1);
      }

      logger.info({
        fromIndex,
        toIndex,
        walletCount,
        message: 'Plage de wallets configurée'
      });

      // Configuration de l'orchestrateur multi-wallet
      const multiWalletConfig = {
        distributionConfig: {
          bybit: {
            apiKey: cfg.BYBIT_API_KEY,
            apiSecret: cfg.BYBIT_API_SECRET,
            sandbox: cfg.BYBIT_SANDBOX,
            testnet: cfg.BYBIT_TESTNET,
          },
          hubWalletPrivateKey: cfg.HUB_WALLET_PRIVATE_KEY,
          tokens: {
            usdc: {
              amountPerWallet: cfg.DISTRIBUTION_USDC_PER_WALLET,
              totalAmount: cfg.DISTRIBUTION_USDC_PER_WALLET * walletCount,
            },
            eth: {
              amountPerWallet: cfg.DISTRIBUTION_ETH_PER_WALLET,
              totalAmount: cfg.DISTRIBUTION_ETH_PER_WALLET * walletCount,
            },
          },
          walletCount,
          randomizeAmounts: cfg.DISTRIBUTION_RANDOMIZE_AMOUNTS,
          minAmountVariation: cfg.DISTRIBUTION_VARIATION_PERCENT / 100,
          chainId: 2741, // Abstract
          batchSize: parseInt(options.batchSize),
        },
        walletCount,
        mnemonic: cfg.MNEMONIC,
        sequential: options.sequential,
        maxConcurrentWallets: parseInt(options.maxConcurrent),
        defiParams: {
          bridgeAmount: options.bridgeAmount,
          bridgeToken: 'USDC' as const,
          swapAmount: options.swapAmount,
          swapPair: 'PENGU/USDC' as const,
          lpRangePercent: parseInt(options.lpRange),
          collectAfterMinutes: parseInt(options.collectAfter),
          dryRun: options.dryRun,
          autoGasTopUp: options.autoGasTopup || false,
          minNativeOnDest: '0.001',
          gasTopUpTarget: '0.01',
          routerOverride: undefined,
          npmOverride: undefined,
          factoryOverride: undefined,
          autoTokenTopUp: options.autoTokenTopup || false,
          tokenTopUpSafetyBps: 100,
          tokenTopUpMin: '1',
          tokenTopUpSourceChainId: 8453,
          tokenTopUpMaxWaitSec: 300,
        },
      };

      logger.info({
        walletCount,
        sequential: options.sequential,
        maxConcurrent: options.maxConcurrent,
        batchSize: options.batchSize,
        message: 'Configuration de l\'orchestrateur multi-wallet'
      });

      if (options.dryRun) {
        logger.info({
          message: 'DRY-RUN: Simulation de l\'exécution multi-wallet'
        });

        // Créer l'orchestrateur pour la simulation
        const orchestrator = new MultiWalletOrchestrator(multiWalletConfig);

        // Simuler la création des wallets
        logger.info({
          walletCount,
          fromIndex,
          toIndex,
          message: 'Simulation: Création des wallets'
        });

        // Simuler la distribution
        logger.info({
          totalUsdc: cfg.DISTRIBUTION_USDC_PER_WALLET * walletCount,
          totalEth: cfg.DISTRIBUTION_ETH_PER_WALLET * walletCount,
          message: 'Simulation: Distribution des fonds depuis le Hub'
        });

        // Simuler l'exécution des wallets
        logger.info({
          executionMode: options.sequential ? 'séquentiel' : 'parallèle',
          batchSize: options.batchSize,
          maxConcurrent: options.maxConcurrent,
          message: 'Simulation: Exécution des séquences DeFi'
        });

        // Afficher le plan d'exécution
        console.log('\n=== PLAN D\'EXÉCUTION ===');
        console.log(`Mode: ${options.sequential ? 'Séquentiel' : 'Parallèle'}`);
        console.log(`Wallets: ${fromIndex} à ${toIndex} (${walletCount} wallets)`);
        console.log(`Batch size: ${options.batchSize}`);
        console.log(`Max concurrent: ${options.maxConcurrent}`);
        
        console.log('\nSéquence par wallet:');
        console.log('1. Bridge USDC Arbitrum → Abstract');
        console.log('2. Swap USDC → PENGU');
        console.log('3. Créer position LP PENGU/USDC');
        console.log(`4. Collecter les fees après ${options.collectAfter} minutes`);

        logger.info({
          message: 'DRY-RUN terminé - aucune transaction effectuée'
        });
      } else {
        // Exécuter la séquence réelle
        logger.info({
          message: 'Initiation de l\'exécution multi-wallet réelle'
        });

        const orchestrator = new MultiWalletOrchestrator(multiWalletConfig);
        
        const result = await orchestrator.execute();

        if (result.success) {
          logger.info({
            totalWallets: result.totalWallets,
            successfulWallets: result.successfulWallets,
            failedWallets: result.failedWallets,
            totalFeesCollected: result.totalFeesCollected,
            totalGasUsed: result.totalGasUsed,
            executionTime: result.executionTime,
            message: 'Exécution multi-wallet effectuée avec succès'
          });

          // Afficher un résumé détaillé
          console.log('\n=== RÉSUMÉ DE L\'EXÉCUTION ===');
          console.log(`Wallets traités: ${result.totalWallets}`);
          console.log(`Succès: ${result.successfulWallets}`);
          console.log(`Échecs: ${result.failedWallets}`);
          console.log(`Fees collectés: ${JSON.stringify(result.totalFeesCollected)}`);
          console.log(`Gas utilisé: ${result.totalGasUsed}`);
          console.log(`Temps d'exécution: ${result.executionTime}ms`);

          if (result.walletResults && result.walletResults.length > 0) {
            console.log('\n=== RÉSULTATS PAR WALLET ===');
            result.walletResults.forEach((walletResult, index) => {
              console.log(`\nWallet ${fromIndex + index}:`);
              console.log(`  Adresse: ${walletResult.walletAddress}`);
              console.log(`  Succès: ${walletResult.success}`);
              console.log(`  Étape finale: ${walletResult.finalStep}`);
              
              if (walletResult.bridgeTxHash) {
                console.log(`  Bridge TX: ${walletResult.bridgeTxHash}`);
              }
              
              if (walletResult.swapTxHash) {
                console.log(`  Swap TX: ${walletResult.swapTxHash}`);
              }
              
              if (walletResult.lpTokenId) {
                console.log(`  LP Token ID: ${walletResult.lpTokenId}`);
              }
              
              if (walletResult.collectTxHash) {
                console.log(`  Collect TX: ${walletResult.collectTxHash}`);
              }
              
              if (walletResult.feesCollected) {
                console.log(`  Fees collectés: ${JSON.stringify(walletResult.feesCollected)}`);
              }
              
              if (walletResult.error) {
                console.log(`  Erreur: ${walletResult.error}`);
              }
            });
          }

          if (result.errors && result.errors.length > 0) {
            console.log('\n=== ERREURS GLOBALES ===');
            result.errors.forEach((error, index) => {
              console.log(`${index + 1}. ${error}`);
            });
          }
        } else {
          logger.error({
            error: result.error,
            message: 'Erreur lors de l\'exécution multi-wallet'
          });
          process.exit(1);
        }
      }

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        message: 'Erreur lors de l\'exécution multi-wallet'
      });
      process.exit(1);
    }
  });

program.parse();
