#!/usr/bin/env node

import { Command } from 'commander';
import { logger } from '../core/logger.js';
import { HubDistributor } from '../cex/hub-distributor.js';
import { WalletManager } from '../core/wallet-manager.js';
import { cfg, CONSTANTS } from '../config/env.js';
import { validateConfig } from '../config/validator.js';

const program = new Command();

program
  .name('distribute-from-hub')
  .description('Distribuer des fonds depuis le wallet Hub vers les wallets dérivés')
  .option('--dry-run', 'Simuler la distribution sans l\'exécuter')
  .option('--batch-size <size>', 'Taille des batches pour la distribution', '10')
  .option('--usdc-amount <amount>', 'Montant USDC par wallet')
  .option('--eth-amount <amount>', 'Montant ETH par wallet')
  .option('--randomize', 'Randomiser les montants de distribution')
  .option('--variation <percent>', 'Pourcentage de variation des montants', '10')
  .action(async (options) => {
    try {
      // Validation de la configuration
      if (!validateConfig(cfg)) {
        process.exit(1);
      }

      // Vérifier les prérequis
      if (!cfg.HUB_WALLET_PRIVATE_KEY) {
        logger.error('HUB_WALLET_PRIVATE_KEY requis');
        process.exit(1);
      }

      if (!cfg.MNEMONIC) {
        logger.error('MNEMONIC requis pour créer les wallets');
        process.exit(1);
      }

      // Créer le WalletManager
      const walletManager = new WalletManager();
      
      // Créer les wallets depuis le mnémonique
      const wallets = walletManager.createMultipleWallets(
        cfg.MNEMONIC,
        cfg.WALLET_COUNT,
        0 // Commencer à l'index 0
      );

      logger.info({
        walletCount: wallets.length,
        message: 'Wallets créés depuis le mnémonique'
      });

      // Configuration de distribution
      const distributionConfig = {
        bybit: {
          apiKey: cfg.BYBIT_API_KEY || '',
          apiSecret: cfg.BYBIT_API_SECRET || '',
          sandbox: cfg.BYBIT_SANDBOX,
          testnet: cfg.BYBIT_TESTNET,
        },
        hubWalletPrivateKey: cfg.HUB_WALLET_PRIVATE_KEY,
        tokens: {
          usdc: {
            amountPerWallet: options.usdcAmount ? 
              parseFloat(options.usdcAmount) : 
              cfg.DISTRIBUTION_USDC_PER_WALLET,
            totalAmount: (options.usdcAmount ? 
              parseFloat(options.usdcAmount) : 
              cfg.DISTRIBUTION_USDC_PER_WALLET) * wallets.length,
          },
          eth: {
            amountPerWallet: options.ethAmount ? 
              parseFloat(options.ethAmount) : 
              cfg.DISTRIBUTION_ETH_PER_WALLET,
            totalAmount: (options.ethAmount ? 
              parseFloat(options.ethAmount) : 
              cfg.DISTRIBUTION_ETH_PER_WALLET) * wallets.length,
          },
        },
        walletCount: wallets.length,
        randomizeAmounts: options.randomize || cfg.DISTRIBUTION_RANDOMIZE_AMOUNTS,
        minAmountVariation: options.variation ? 
          parseFloat(options.variation) / 100 : 
          cfg.DISTRIBUTION_VARIATION_PERCENT / 100,
        chainId: CONSTANTS.CHAIN_IDS.ARBITRUM,
        batchSize: parseInt(options.batchSize),
      };

      // Créer le HubDistributor
      const hubDistributor = new HubDistributor(distributionConfig);

      if (options.dryRun) {
        logger.info({
          message: 'DRY-RUN: Simulation de la distribution'
        });

        // Obtenir les diagnostics
        const diagnostics = await hubDistributor.getDiagnostics();
        
        logger.info({
          diagnostics,
          message: 'Diagnostics du Hub'
        });

        // Calculer la répartition
        const dryRunResult = await hubDistributor.dryRunDistribution(wallets);
        
        logger.info({
          totalUsdc: dryRunResult.totalUsdc,
          totalEth: dryRunResult.totalEth,
          walletCount: dryRunResult.allocations.length,
          message: 'Calcul de la répartition'
        });

        // Afficher le tableau des allocations
        console.log('\n=== TABLEAU DES ALLOCATIONS ===');
        console.log('Wallet Address'.padEnd(42) + 'USDC'.padEnd(10) + 'ETH');
        console.log('-'.repeat(65));
        
        dryRunResult.allocations.forEach((allocation, index) => {
          console.log(
            allocation.walletAddress.padEnd(42) + 
            allocation.usdcAmount.toFixed(2).padEnd(10) + 
            allocation.ethAmount.toFixed(6)
          );
        });

        console.log('-'.repeat(65));
        console.log(
          'TOTAL'.padEnd(42) + 
          dryRunResult.totalUsdc.toFixed(2).padEnd(10) + 
          dryRunResult.totalEth.toFixed(6)
        );

        logger.info({
          message: 'DRY-RUN terminé - aucune distribution effectuée'
        });
      } else {
        // Effectuer la distribution réelle
        logger.info({
          message: 'Initiation de la distribution réelle'
        });

        const result = await hubDistributor.executeFullDistribution();

        if (result.success) {
          logger.info({
            totalWallets: result.totalWallets,
            totalDistributed: result.totalDistributed,
            transactionCount: result.distributionResults.length,
            message: 'Distribution effectuée avec succès'
          });

          // Afficher un résumé des transactions
          const usdcTransactions = result.distributionResults.filter(r => r.token === 'USDC');
          const ethTransactions = result.distributionResults.filter(r => r.token === 'ETH');

          logger.info({
            usdcTransactions: usdcTransactions.length,
            ethTransactions: ethTransactions.length,
            message: 'Résumé des transactions'
          });

          // Afficher quelques exemples de transactions
          if (result.distributionResults.length > 0) {
            console.log('\n=== EXEMPLES DE TRANSACTIONS ===');
            result.distributionResults.slice(0, 5).forEach((tx, index) => {
              console.log(`${index + 1}. ${tx.walletAddress} - ${tx.amount} ${tx.token} - ${tx.txHash}`);
            });
            if (result.distributionResults.length > 5) {
              console.log(`... et ${result.distributionResults.length - 5} autres transactions`);
            }
          }
        } else {
          logger.error({
            error: result.error,
            message: 'Erreur lors de la distribution'
          });
          process.exit(1);
        }
      }

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        message: 'Erreur lors de la distribution depuis le Hub'
      });
      process.exit(1);
    }
  });

program.parse();
