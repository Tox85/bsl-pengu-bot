#!/usr/bin/env node

import { Command } from 'commander';
import { logger } from '../core/logger.js';
import { WalletManager } from '../core/wallet-manager.js';
import { OrchestratorService } from '../orchestrator/run.js';
import { cfg } from '../config/env.js';
import { validateConfig } from '../config/validator.js';

const program = new Command();

program
  .name('run-wallet')
  .description('Exécuter la séquence complète (bridge → swap → LP → collect) pour un wallet spécifique')
  .option('--wallet <wallet>', 'Index du wallet ou adresse (requis)')
  .option('--dry-run', 'Simuler la séquence sans l\'exécuter')
  .option('--skip-bridge', 'Ignorer l\'étape de bridge')
  .option('--skip-collect', 'Ignorer l\'étape de collect')
  .option('--collect-after <minutes>', 'Attendre X minutes avant de collecter', '10')
  .option('--bridge-amount <amount>', 'Montant à bridger', '1')
  .option('--swap-amount <amount>', 'Montant à swapper', '5')
  .option('--lp-range <percent>', 'Range de LP en pourcentage', '5')
  .option('--auto-gas-topup', 'Activer le top-up automatique de gas')
  .option('--auto-token-topup', 'Activer le top-up automatique de tokens')
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
        const wallets = walletManager.getWallets();
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

      // Configuration de la séquence DeFi
      const defiParams = {
        privateKey: targetWallet.wallet.privateKey,
        bridgeAmount: options.bridgeAmount,
        bridgeToken: 'USDC',
        swapAmount: options.swapAmount,
        swapPair: 'PENGU/USDC',
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
      };

      logger.info({
        ...defiParams,
        skipBridge: options.skipBridge,
        skipCollect: options.skipCollect,
        message: 'Paramètres de la séquence DeFi'
      });

      if (options.dryRun) {
        logger.info({
          message: 'DRY-RUN: Simulation de la séquence complète'
        });

        // Simuler les étapes
        if (!options.skipBridge) {
          logger.info({
            step: 'bridge',
            fromChain: 'ARBITRUM',
            toChain: 'ABSTRACT',
            amount: options.bridgeAmount,
            token: 'USDC',
            message: 'Étape 1: Bridge simulé'
          });
        }

        logger.info({
          step: 'swap',
          amount: options.swapAmount,
          pair: 'PENGU/USDC',
          message: 'Étape 2: Swap simulé'
        });

        logger.info({
          step: 'lp',
          rangePercent: options.lpRange,
          message: 'Étape 3: Position LP simulée'
        });

        if (!options.skipCollect) {
          logger.info({
            step: 'collect',
            waitMinutes: options.collectAfter,
            message: 'Étape 4: Collect simulé'
          });
        }

        logger.info({
          message: 'DRY-RUN terminé - aucune transaction effectuée'
        });
      } else {
        // Exécuter la séquence réelle
        logger.info({
          message: 'Initiation de la séquence DeFi réelle'
        });

        const orchestrator = new OrchestratorService();
        
        const result = await orchestrator.run(defiParams);

        if (result.success) {
          logger.info({
            walletAddress,
            finalStep: result.finalState?.step,
            bridgeTxHash: result.finalState?.bridgeResult?.txHash,
            swapTxHash: result.finalState?.swapResult?.txHash,
            lpTokenId: result.finalState?.lpResult?.tokenId,
            collectTxHash: result.finalState?.collectResult?.txHash,
            feesCollected: result.finalState?.collectResult?.feesCollected,
            message: 'Séquence DeFi effectuée avec succès'
          });

          // Afficher un résumé
          console.log('\n=== RÉSUMÉ DE LA SÉQUENCE ===');
          console.log(`Wallet: ${walletAddress}`);
          console.log(`Étape finale: ${result.finalState?.step}`);
          
          if (result.finalState?.bridgeResult?.txHash) {
            console.log(`Bridge TX: ${result.finalState.bridgeResult.txHash}`);
          }
          
          if (result.finalState?.swapResult?.txHash) {
            console.log(`Swap TX: ${result.finalState.swapResult.txHash}`);
          }
          
          if (result.finalState?.lpResult?.tokenId) {
            console.log(`LP Token ID: ${result.finalState.lpResult.tokenId}`);
          }
          
          if (result.finalState?.collectResult?.txHash) {
            console.log(`Collect TX: ${result.finalState.collectResult.txHash}`);
          }
          
          if (result.finalState?.collectResult?.feesCollected) {
            console.log(`Fees collectés: ${JSON.stringify(result.finalState.collectResult.feesCollected)}`);
          }

          // Afficher les liens des explorateurs
          if (result.finalState?.bridgeResult?.txHash) {
            console.log(`\nExplorer Arbitrum: https://arbiscan.io/tx/${result.finalState.bridgeResult.txHash}`);
          }
          
          if (result.finalState?.swapResult?.txHash || result.finalState?.lpResult?.tokenId || result.finalState?.collectResult?.txHash) {
            const txHash = result.finalState?.swapResult?.txHash || result.finalState?.lpResult?.tokenId || result.finalState?.collectResult?.txHash;
            if (txHash) {
              console.log(`Explorer Abstract: https://explorer.abstract.xyz/tx/${txHash}`);
            }
          }
        } else {
          logger.error({
            error: result.error,
            finalStep: result.finalState?.step,
            message: 'Erreur lors de la séquence DeFi'
          });
          process.exit(1);
        }
      }

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        message: 'Erreur lors de l\'exécution du wallet'
      });
      process.exit(1);
    }
  });

program.parse();
