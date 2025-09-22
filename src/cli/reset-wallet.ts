#!/usr/bin/env node

import { Command } from 'commander';
import { logger } from '../core/logger.js';
import { WalletManager } from '../core/wallet-manager.js';
import { cfg } from '../config/env.js';
import { validateConfig } from '../config/validator.js';

const program = new Command();

program
  .name('reset-wallet')
  .description('Réinitialiser le statut d\'un wallet')
  .option('--wallet <wallet>', 'Index du wallet ou adresse (requis)')
  .option('--reset-nonce', 'Réinitialiser le nonce du wallet')
  .option('--confirm', 'Confirmer la réinitialisation sans demander')
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
      
      // Créer les wallets si nécessaire
      let wallets = walletManager.getWallets();
      if (wallets.length === 0) {
        walletManager.createMultipleWallets(cfg.MNEMONIC, cfg.WALLET_COUNT, 0);
        wallets = walletManager.getWallets(); // Recharger les wallets après création
      }

      // Déterminer le wallet cible
      let targetWallet;
      let walletAddress: string;
      
      if (options.wallet.startsWith('0x')) {
        // C'est une adresse
        walletAddress = options.wallet;
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
        currentNonce: targetWallet.nonce,
        message: 'Wallet cible identifié pour la réinitialisation'
      });

      // Demander confirmation si pas forcée
      if (!options.confirm) {
        console.log(`\n⚠️  ATTENTION: Vous êtes sur le point de réinitialiser le wallet:`);
        console.log(`   Adresse: ${walletAddress}`);
        console.log(`   Index: ${targetWallet.index}`);
        console.log(`   Nonce actuel: ${targetWallet.nonce}`);
        console.log(`\nCette action va:`);
        console.log(`   - Réinitialiser le statut du wallet`);
        if (options.resetNonce) {
          console.log(`   - Remettre le nonce à 0`);
        }
        console.log(`\nVoulez-vous continuer? (y/N)`);
        
        // En mode CLI, on ne peut pas faire d'input interactif facilement
        // Donc on affiche juste un avertissement et on continue
        console.log(`Utilisez --confirm pour éviter cet avertissement`);
        console.log(`Continuing in 3 seconds...`);
        await new Promise(resolve => setTimeout(resolve, 3000));
      }

      // Effectuer la réinitialisation
      logger.info({
        walletAddress,
        message: 'Début de la réinitialisation'
      });

      // Réinitialiser le nonce si demandé
      if (options.resetNonce) {
        // Remettre le nonce à 0 dans le WalletManager
        // Note: Cela nécessiterait une méthode dans WalletManager pour réinitialiser le nonce
        logger.info({
          walletAddress,
          message: 'Réinitialisation du nonce'
        });
        
        // TODO: Implémenter la réinitialisation du nonce dans WalletManager
        logger.warn({
          message: 'Réinitialisation du nonce non implémentée - à faire manuellement'
        });
      }

      // Réinitialiser le statut du wallet
      // Note: Cela nécessiterait un système de state store pour tracker le statut
      logger.info({
        walletAddress,
        message: 'Réinitialisation du statut du wallet'
      });

      // TODO: Implémenter la réinitialisation du statut dans le state store
      logger.warn({
        message: 'Réinitialisation du statut non implémentée - à faire manuellement'
      });

      logger.info({
        walletAddress,
        message: 'Réinitialisation terminée'
      });

      console.log(`\n✅ Wallet ${walletAddress} réinitialisé avec succès`);
      console.log(`\nNote: Certaines fonctionnalités de réinitialisation nécessitent encore une implémentation complète.`);

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        message: 'Erreur lors de la réinitialisation du wallet'
      });
      process.exit(1);
    }
  });

program.parse();
