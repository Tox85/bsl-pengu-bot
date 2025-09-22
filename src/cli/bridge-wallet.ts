#!/usr/bin/env node

import { Command } from 'commander';
import { logger } from '../core/logger.js';
import { WalletManager } from '../core/wallet-manager.js';
import { BridgeService } from '../bridge/index.js';
import { cfg } from '../config/env.js';
import { validateConfig } from '../config/validator.js';

const program = new Command();

program
  .name('bridge-wallet')
  .description('Exécuter le bridge pour un wallet spécifique')
  .option('--wallet <wallet>', 'Index du wallet ou adresse (requis)')
  .option('--dry-run', 'Simuler le bridge sans l\'exécuter')
  .option('--amount <amount>', 'Montant à bridger', '1')
  .option('--token <token>', 'Token à bridger', 'USDC')
  .option('--from-chain <chain>', 'Chaîne source', 'ARBITRUM')
  .option('--to-chain <chain>', 'Chaîne destination', 'ABSTRACT')
  .option('--auto-topup', 'Activer le top-up automatique de gas')
  .action(async (options) => {
    try {
      // Validation de la configuration
      if (!validateConfig(cfg)) {
        process.exit(1);
      }

      if (!options.wallet) {
        logger.error('Option --wallet requise (index ou adresse)');
        process.exit(1);
      }

      // Vérifier les prérequis
      if (!cfg.MNEMONIC) {
        logger.error('MNEMONIC requis');
        process.exit(1);
      }

      // Créer le WalletManager
      const walletManager = new WalletManager();
      
      // Déterminer le wallet cible
      let targetWallet;
      let walletAddress: string;
      
      if (options.wallet.startsWith('0x')) {
        // C'est une adresse
        walletAddress = options.wallet;
        let wallets = walletManager.getWallets();
        if (wallets.length === 0) {
          // Créer les wallets si nécessaire
          walletManager.createMultipleWallets(cfg.MNEMONIC, cfg.WALLET_COUNT, 0);
          wallets = walletManager.getWallets(); // Recharger les wallets après création
        }
        targetWallet = wallets.find(w => w.address.toLowerCase() === walletAddress.toLowerCase());
        if (!targetWallet) {
          logger.error(`Wallet avec l'adresse ${walletAddress} non trouvé`);
          process.exit(1);
        }
      } else {
        // C'est un index
        const walletIndex = parseInt(options.wallet);
        if (isNaN(walletIndex) || walletIndex < 0) {
          logger.error('Index de wallet invalide');
          process.exit(1);
        }

        let wallets = walletManager.getWallets();
        if (wallets.length === 0) {
          // Créer les wallets si nécessaire
          walletManager.createMultipleWallets(cfg.MNEMONIC, cfg.WALLET_COUNT, 0);
          wallets = walletManager.getWallets(); // Recharger les wallets après création
        }

        targetWallet = wallets[walletIndex];
        if (!targetWallet) {
          logger.error(`Wallet à l'index ${walletIndex} non trouvé`);
          process.exit(1);
        }
        walletAddress = targetWallet.address;
      }

      logger.info({
        walletAddress,
        walletIndex: targetWallet.index,
        message: 'Wallet cible identifié'
      });

      // Configuration du bridge
      const bridgeParams = {
        privateKey: targetWallet.wallet.privateKey,
        bridgeAmount: options.amount,
        bridgeToken: options.token,
        dryRun: options.dryRun,
        autoGasTopUp: options.autoTopup || false,
        minNativeOnDest: '0.001',
        gasTopUpTarget: '0.01',
      };

      logger.info({
        ...bridgeParams,
        fromChain: options.fromChain,
        toChain: options.toChain,
        message: 'Paramètres du bridge'
      });

      if (options.dryRun) {
        logger.info({
          message: 'DRY-RUN: Simulation du bridge'
        });

        // En mode dry-run, simuler la réponse au lieu de faire un appel API réel
        logger.info({
          message: 'DRY-RUN: Route de bridge simulée',
          fromChain: options.fromChain,
          toChain: options.toChain,
          fromToken: options.token,
          amount: options.amount,
          walletAddress,
          walletIndex: targetWallet.index
        });

        // Simuler les détails de la route
        console.log('\n=== DÉTAILS DE LA ROUTE (SIMULÉ) ===');
        console.log(`Route ID: dry-run-route-${Date.now()}`);
        console.log(`Montant source: ${options.amount} ${options.token}`);
        console.log(`Montant destination: ${options.amount} ${options.token}`);
        console.log(`Coût gas estimé: 0.001 ETH`);
        console.log(`Durée estimée: 5-10 minutes`);
        console.log('\nÉtapes simulées:');
        console.log('1. Bridge - Li.Fi');

        logger.info({
          message: 'DRY-RUN terminé - aucun bridge effectué'
        });
      } else {
        // Effectuer le bridge réel
        logger.info({
          message: 'Initiation du bridge réel'
        });

        const bridgeService = new BridgeService();
        
        const route = await bridgeService.getBridgeRoute({
          fromChainId: options.fromChain === 'ARBITRUM' ? 42161 : 1,
          toChainId: options.toChain === 'ABSTRACT' ? 2741 : 8453,
          fromTokenAddress: options.token === 'USDC' ? '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' : '0x0000000000000000000000000000000000000000',
          toTokenAddress: options.token === 'USDC' ? '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' : '0x0000000000000000000000000000000000000000',
          amount: options.amount,
          fromAddress: walletAddress,
          toAddress: walletAddress,
          slippage: 0.005,
        });

        const result = await bridgeService.executeRoute({
          route,
          privateKey: targetWallet.wallet.privateKey,
          options: {
            dryRun: false,
            autoGasTopUp: options.autoTopup || false,
            minNativeOnDest: '0.001',
            gasTopUpTarget: '0.01',
          }
        });

        if (result.success) {
          logger.info({
            txHash: result.txHash,
            fromChain: options.fromChain,
            toChain: options.toChain,
            amount: options.amount,
            token: options.token,
            message: 'Bridge effectué avec succès'
          });

          if (result.txHash) {
            const explorerUrl = options.toChain === 'ABSTRACT' ? 
              `https://explorer.abstract.xyz/tx/${result.txHash}` :
              `https://arbiscan.io/tx/${result.txHash}`;
            
            logger.info({
              txHash: result.txHash,
              explorerUrl,
              message: 'Hash de transaction disponible'
            });
          }
        } else {
          logger.error({
            error: result.error,
            message: 'Erreur lors du bridge'
          });
          process.exit(1);
        }
      }

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        message: 'Erreur lors du bridge du wallet'
      });
      process.exit(1);
    }
  });

program.parse();
