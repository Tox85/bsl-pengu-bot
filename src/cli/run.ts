#!/usr/bin/env node

import { Command } from 'commander';
import { orchestratorService } from '../orchestrator/index.js';
import { CONSTANTS } from '../config/env.js';
import { logger } from '../core/logger.js';
import { parseAmount, formatAmount } from '../core/math.js';

const program = new Command();

program
  .name('run')
  .description('CLI pour l\'orchestrateur principal (Bridge → Swap → LP → Collect)')
  .version('1.0.0');

program
  .command('full')
  .description('Exécuter le flow complet')
  .requiredOption('--privateKey <key>', 'Clé privée du wallet')
  .requiredOption('--bridgeAmount <amount>', 'Montant à bridger')
  .requiredOption('--bridgeToken <token>', 'Token de bridge (ETH|USDC)')
  .requiredOption('--swapAmount <amount>', 'Montant à swapper')
  .requiredOption('--swapPair <pair>', 'Paire de swap (PENGU/ETH|PENGU/USDC)')
  .requiredOption('--lpRange <percent>', 'Range LP en pourcentage')
  .requiredOption('--collectAfter <minutes>', 'Minutes avant collecte des frais')
  .option('--dry-run [value]', 'Mode simulation (pas de transaction réelle)', 'true')
  .option('--fresh', 'Démarrer avec un état propre (ignore .state)', false)
  .option('--autoGasTopUp [value]', 'Auto top-up du gas natif sur Abstract', 'true')
  .option('--minNativeOnDest <wei>', 'Montant minimum gas natif sur destination (wei)')
  .option('--gasTopUpTarget <wei>', 'Montant cible pour le top-up gas (wei)')
  .action(async (options) => {
    try {
      logger.info({
        bridgeAmount: options.bridgeAmount,
        bridgeToken: options.bridgeToken,
        swapAmount: options.swapAmount,
        swapPair: options.swapPair,
        lpRange: options.lpRange,
        collectAfter: options.collectAfter,
        dryRun: options.dryRun,
        message: 'Démarrage du flow complet'
      });

      // Nettoyer l'état si --fresh
      if (options.fresh) {
        const fs = await import('fs');
        try {
          await fs.promises.rmdir('.state', { recursive: true });
          logger.info({ message: 'État nettoyé (--fresh)' });
        } catch (error) {
          // Ignorer si le dossier n'existe pas
        }
      }

      // Les options CLI ont priorité sur les constantes

      const params = {
        privateKey: options.privateKey,
        bridgeAmount: options.bridgeAmount,
        bridgeToken: options.bridgeToken as 'ETH' | 'USDC',
        swapAmount: options.swapAmount,
        swapPair: options.swapPair as 'PENGU/ETH' | 'PENGU/USDC',
        lpRangePercent: parseFloat(options.lpRange),
        collectAfterMinutes: parseInt(options.collectAfter),
        dryRun: options.dryRun === 'false' ? 'false' : 'true',
        // Passer les options de gas directement
        autoGasTopUp: options.autoGasTopUp === 'true' || options.autoGasTopUp === true,
        minNativeOnDest: options.minNativeOnDest,
        gasTopUpTarget: options.gasTopUpTarget,
      };

      const result = await orchestratorService.run(params);

      if (result.success) {
        console.log('\n🎉 Flow complet exécuté avec succès!');
        console.log(`  Étape finale: ${result.state.currentStep}`);
        
        if (result.state.bridgeResult) {
          console.log(`\n🌉 Bridge:`);
          console.log(`  TX Hash: ${result.state.bridgeResult.txHash}`);
          console.log(`  Montant: ${result.state.bridgeResult.fromAmount} → ${result.state.bridgeResult.toAmount}`);
          console.log(`  Statut: ${result.state.bridgeResult.status}`);
        }

        if (result.state.swapResult) {
          console.log(`\n💱 Swap:`);
          console.log(`  TX Hash: ${result.state.swapResult.txHash}`);
          console.log(`  Montant: ${result.state.swapResult.amountIn} → ${result.state.swapResult.amountOut}`);
          console.log(`  Pool: ${result.state.swapResult.poolAddress}`);
        }

        if (result.state.positionResult) {
          console.log(`\n🏊 Position LP:`);
          console.log(`  TX Hash: ${result.state.positionResult.txHash}`);
          console.log(`  Token ID: ${result.state.positionResult.tokenId.toString()}`);
          console.log(`  Liquidité: ${result.state.positionResult.liquidity.toString()}`);
          console.log(`  Tick Range: ${result.state.positionResult.tickLower} - ${result.state.positionResult.tickUpper}`);
        }

        if (result.state.collectResult) {
          console.log(`\n💰 Collecte des frais:`);
          console.log(`  TX Hash: ${result.state.collectResult.txHash}`);
          console.log(`  Montant0: ${result.state.collectResult.amount0.toString()}`);
          console.log(`  Montant1: ${result.state.collectResult.amount1.toString()}`);
        }

        if (result.metrics) {
          console.log(`\n📊 Métriques:`);
          console.log(`  Durée totale: ${result.metrics.totalDuration}ms`);
          console.log(`  Frais collectés: ${result.metrics.totalFeesCollected.amount0.toString()} ${result.metrics.totalFeesCollected.token0} + ${result.metrics.totalFeesCollected.amount1.toString()} ${result.metrics.totalFeesCollected.token1}`);
        }
      } else {
        console.log('\n❌ Flow échoué:');
        console.log(`  Erreur: ${result.error}`);
        console.log(`  Étape: ${result.state.currentStep}`);
        process.exit(1);
      }

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : 'Unknown error',
        message: 'Erreur lors de l\'exécution du flow'
      });
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Vérifier le statut de l\'orchestrateur')
  .requiredOption('--privateKey <key>', 'Clé privée du wallet')
  .action(async (options) => {
    try {
      logger.info({
        message: 'Vérification du statut de l\'orchestrateur'
      });

      // Obtenir l'adresse du wallet
      const { createSigner } = await import('../core/rpc.js');
      const signer = createSigner(options.privateKey, CONSTANTS.CHAIN_IDS.ABSTRACT);
      const wallet = await signer.getAddress();

      // Charger l'état
      const { stateManager } = await import('../orchestrator/state.js');
      const state = stateManager.loadState(wallet);

      if (!state) {
        console.log('\n❌ Aucun état trouvé pour ce wallet');
        return;
      }

      console.log('\n📊 Statut de l\'orchestrateur:');
      console.log(`  Wallet: ${state.wallet}`);
      console.log(`  Étape actuelle: ${state.currentStep}`);
      console.log(`  Créé: ${new Date(state.createdAt).toISOString()}`);
      console.log(`  Mis à jour: ${new Date(state.updatedAt).toISOString()}`);

      if (state.bridgeResult) {
        console.log(`\n🌉 Bridge:`);
        console.log(`  Statut: ${state.bridgeResult.success ? '✅' : '❌'}`);
        console.log(`  TX Hash: ${state.bridgeResult.txHash}`);
        console.log(`  Montant: ${state.bridgeResult.fromAmount} → ${state.bridgeResult.toAmount}`);
        if (state.bridgeResult.error) {
          console.log(`  Erreur: ${state.bridgeResult.error}`);
        }
      }

      if (state.swapResult) {
        console.log(`\n💱 Swap:`);
        console.log(`  Statut: ${state.swapResult.success ? '✅' : '❌'}`);
        console.log(`  TX Hash: ${state.swapResult.txHash}`);
        console.log(`  Montant: ${state.swapResult.amountIn} → ${state.swapResult.amountOut}`);
        if (state.swapResult.error) {
          console.log(`  Erreur: ${state.swapResult.error}`);
        }
      }

      if (state.positionResult) {
        console.log(`\n🏊 Position LP:`);
        console.log(`  Statut: ${state.positionResult.success ? '✅' : '❌'}`);
        console.log(`  TX Hash: ${state.positionResult.txHash}`);
        console.log(`  Token ID: ${state.positionResult.tokenId.toString()}`);
        console.log(`  Liquidité: ${state.positionResult.liquidity.toString()}`);
        if (state.positionResult.error) {
          console.log(`  Erreur: ${state.positionResult.error}`);
        }
      }

      if (state.collectResult) {
        console.log(`\n💰 Collecte des frais:`);
        console.log(`  Statut: ${state.collectResult.success ? '✅' : '❌'}`);
        console.log(`  TX Hash: ${state.collectResult.txHash}`);
        console.log(`  Montant0: ${state.collectResult.amount0.toString()}`);
        console.log(`  Montant1: ${state.collectResult.amount1.toString()}`);
        if (state.collectResult.error) {
          console.log(`  Erreur: ${state.collectResult.error}`);
        }
      }

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : 'Unknown error',
        message: 'Erreur lors de la vérification du statut'
      });
      process.exit(1);
    }
  });

program
  .command('reset')
  .description('Réinitialiser l\'état de l\'orchestrateur')
  .requiredOption('--privateKey <key>', 'Clé privée du wallet')
  .option('--confirm', 'Confirmer la réinitialisation', false)
  .action(async (options) => {
    try {
      if (!options.confirm) {
        console.log('\n⚠️  Cette action va supprimer l\'état de l\'orchestrateur pour ce wallet');
        console.log('   Utilisez --confirm pour confirmer');
        return;
      }

      logger.info({
        message: 'Réinitialisation de l\'état de l\'orchestrateur'
      });

      // Obtenir l'adresse du wallet
      const { createSigner } = await import('../core/rpc.js');
      const signer = createSigner(options.privateKey, CONSTANTS.CHAIN_IDS.ABSTRACT);
      const wallet = await signer.getAddress();

      // Supprimer l'état
      const { stateManager } = await import('../orchestrator/state.js');
      stateManager.deleteState(wallet);

      console.log('\n✅ État réinitialisé avec succès!');

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : 'Unknown error',
        message: 'Erreur lors de la réinitialisation'
      });
      process.exit(1);
    }
  });

program
  .command('list')
  .description('Lister tous les états de l\'orchestrateur')
  .action(async () => {
    try {
      logger.info({
        message: 'Liste des états de l\'orchestrateur'
      });

      const { stateManager } = await import('../orchestrator/state.js');
      const states = stateManager.listStates();

      if (states.length === 0) {
        console.log('\n❌ Aucun état trouvé');
        return;
      }

      console.log('\n📋 États de l\'orchestrateur:');
      states.forEach((wallet, index) => {
        console.log(`  ${index + 1}. ${wallet}`);
      });

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : 'Unknown error',
        message: 'Erreur lors de la liste des états'
      });
      process.exit(1);
    }
  });

// Parser les arguments de la ligne de commande
program.parse();
