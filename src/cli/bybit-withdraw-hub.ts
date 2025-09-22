#!/usr/bin/env node

import { Command } from 'commander';
import { logger } from '../core/logger.js';
import { BybitAdapter } from '../cex/bybit-adapter.js';
import { cfg } from '../config/env.js';
import { validateConfig } from '../config/validator.js';

const program = new Command();

program
  .name('bybit-withdraw-hub')
  .description('Retirer des fonds depuis Bybit vers le wallet Hub')
  .option('--dry-run', 'Simuler le retrait sans l\'exécuter')
  .option('--poll', 'Attendre la complétion du retrait')
  .option('--token <token>', 'Token à retirer (USDC, ETH)', 'USDC')
  .option('--amount <amount>', 'Montant à retirer')
  .option('--network <network>', 'Réseau de destination', 'ARBITRUM')
  .option('--hub-address <address>', 'Adresse du wallet Hub')
  .option('--timeout <timeout>', 'Timeout pour le polling en ms', '300000')
  .option('--interval <interval>', 'Intervalle de polling en ms', '10000')
  .action(async (options) => {
    try {
      // Validation de la configuration
      if (!validateConfig(cfg)) {
        process.exit(1);
      }

      // Vérifier les prérequis
      if (!cfg.BYBIT_API_KEY || !cfg.BYBIT_API_SECRET) {
        logger.error('Clés API Bybit requises');
        process.exit(1);
      }

      if (!options.hubAddress && !cfg.HUB_WALLET_PRIVATE_KEY) {
        logger.error('Adresse Hub requise (--hub-address ou HUB_WALLET_PRIVATE_KEY)');
        process.exit(1);
      }

      // Initialiser l'adaptateur Bybit
      const bybitAdapter = new BybitAdapter({
        apiKey: cfg.BYBIT_API_KEY,
        apiSecret: cfg.BYBIT_API_SECRET,
        sandbox: cfg.BYBIT_SANDBOX,
        testnet: cfg.BYBIT_TESTNET,
      });

      // Déterminer l'adresse Hub
      const hubAddress = options.hubAddress || 
        (cfg.HUB_WALLET_PRIVATE_KEY ? 
          new (await import('ethers')).Wallet(cfg.HUB_WALLET_PRIVATE_KEY).address : 
          null);

      if (!hubAddress) {
        logger.error('Impossible de déterminer l\'adresse Hub');
        process.exit(1);
      }

      // Déterminer le montant
      let amount: number;
      if (options.amount) {
        amount = parseFloat(options.amount);
      } else {
        // Utiliser les montants par défaut de la configuration
        if (options.token === 'USDC') {
          const minAmount = cfg.WITHDRAW_USDC_MIN;
          const maxAmount = cfg.WITHDRAW_USDC_MAX;
          amount = Math.random() * (maxAmount - minAmount) + minAmount;
        } else if (options.token === 'ETH') {
          const minAmount = cfg.WITHDRAW_ETH_MIN;
          const maxAmount = cfg.WITHDRAW_ETH_MAX;
          amount = Math.random() * (maxAmount - minAmount) + minAmount;
        } else {
          logger.error(`Token non supporté: ${options.token}`);
          process.exit(1);
        }
      }

      const withdrawParams = {
        token: options.token,
        amount,
        address: hubAddress,
        network: options.network,
        awaitCompletion: options.poll,
        pollingTimeoutMs: parseInt(options.timeout),
        pollingIntervalMs: parseInt(options.interval),
        dryRun: options.dryRun,
      };

      logger.info({
        ...withdrawParams,
        message: 'Paramètres de retrait'
      });

      if (options.dryRun) {
        logger.info({
          ...withdrawParams,
          message: 'DRY-RUN: Retrait simulé'
        });
        
        // En mode dry-run, simuler la vérification du solde
        logger.info({
          token: options.token,
          availableBalance: 1000, // Simulé
          requestedAmount: amount,
          sufficientBalance: true, // Simulé
          message: 'DRY-RUN: Vérification du solde simulée'
        });

        // En mode dry-run, simuler la vérification de la whitelist
        logger.info({
          hubAddress,
          token: options.token,
          isWhitelisted: true, // Simulé
          message: 'DRY-RUN: Vérification de la whitelist simulée'
        });

        // En mode dry-run, on assume que l'adresse est whitelistée
        logger.info({
          hubAddress,
          token: options.token,
          message: 'DRY-RUN: Adresse considérée comme whitelistée'
        });

        logger.info({
          message: 'DRY-RUN terminé - aucun retrait effectué'
        });
      } else {
        // Effectuer le retrait réel
        logger.info({
          message: 'Initiation du retrait réel'
        });

        const result = await bybitAdapter.withdrawToWallet(withdrawParams);

        logger.info({
          withdrawalId: result.withdrawalId,
          status: result.status,
          amount: result.amount,
          token: result.token,
          address: result.address,
          txHash: result.txHash,
          timestamp: result.timestamp,
          message: 'Retrait effectué avec succès'
        });

        if (result.txHash) {
          logger.info({
            txHash: result.txHash,
            explorerUrl: `https://arbiscan.io/tx/${result.txHash}`,
            message: 'Hash de transaction disponible'
          });
        }
      }

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        message: 'Erreur lors du retrait Bybit'
      });
      process.exit(1);
    }
  });

program.parse();
