#!/usr/bin/env node

// Charger les variables d'environnement en premier
import dotenv from 'dotenv';
dotenv.config();

import { Command } from 'commander';
import { ethers } from 'ethers';
import { orchestratorService, OrchestratorService } from '../orchestrator/index.js';
import { CONSTANTS } from '../config/env.js';
import { logger } from '../core/logger.js';
import { parseAmount, formatAmount } from '../core/math.js';
import { toBool, buildContext } from '../core/context.js';
import { createSigner } from '../core/rpc.js';
import { asLowerHexAddress } from '../core/normalizer.js';
import { liquidityPositionService } from '../lp/index.js';
import { tokenService } from '../services/token.js';
import { stateManager } from '../orchestrator/state.js';

const program = new Command();

program
  .name('run')
  .description('CLI pour l\'orchestrateur principal (Bridge → Swap → LP → Collect)')
  .version('1.0.0');

program
  .command('full')
  .description('Exécuter le flow complet')
  .option('--privateKey <key>', 'Clé privée du wallet (par défaut: depuis .env)')
  .requiredOption('--bridgeAmount <amount>', 'Montant à bridger')
  .requiredOption('--bridgeToken <token>', 'Token de bridge (ETH|USDC)')
  .requiredOption('--swapAmount <amount>', 'Montant à swapper')
  .requiredOption('--swapPair <pair>', 'Paire de swap (PENGU/ETH|PENGU/USDC)')
  .requiredOption('--lpRange <percent>', 'Range LP en pourcentage')
  .requiredOption('--collectAfter <minutes>', 'Minutes avant collecte des frais')
  .option('--collectAfterBlocks <blocks>', 'Attendre X blocs avant collect (alternative à minutes)', '0')
  .option('--dry-run [value]', 'Mode simulation (pas de transaction réelle)', 'true')
  .option('--fresh', 'Démarrer avec un état propre (ignore .state)', false)
  .option('--autoGasTopUp [value]', 'Auto top-up du gas natif sur Abstract', 'true')
  .option('--minNativeOnDest <wei>', 'Montant minimum gas natif sur destination (wei)')
  .option('--gasTopUpTarget <wei>', 'Montant cible pour le top-up gas (wei)')
  .option('--swapEngine <engine>', 'Moteur de swap (v3|lifi|auto)', 'v3')
  .option('--router <address>', 'Adresse du router V3 (override)')
  .option('--npm <address>', 'Adresse du NonfungiblePositionManager (override)')
  .option('--factory <address>', 'Adresse de la factory (override)')
  .option('--debug-events', 'Afficher les logs d\'events détaillés', false)
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
          await fs.promises.rm('.state', { recursive: true, force: true });
          logger.info({ message: 'État nettoyé (--fresh)' });
        } catch (error) {
          // Ignorer si le dossier n'existe pas
        }
      }

      // Utiliser la clé privée du .env si pas fournie en paramètre
      const privateKey = options.privateKey || process.env.PRIVATE_KEY;
      if (!privateKey) {
        throw new Error('Clé privée requise: fournissez --privateKey ou définissez PRIVATE_KEY dans .env');
      }

      // Les options CLI ont priorité sur les constantes
      const params = {
        privateKey,
        bridgeAmount: options.bridgeAmount,
        bridgeToken: options.bridgeToken as 'ETH' | 'USDC',
        swapAmount: options.swapAmount,
        swapPair: options.swapPair as 'PENGU/ETH' | 'PENGU/USDC',
        lpRangePercent: options.lpRange,
        collectAfterMinutes: parseInt(options.collectAfter),
        dryRun: toBool(options.dryRun),
        // Passer les options de gas directement
        autoGasTopUp: toBool(options.autoGasTopUp),
        minNativeOnDest: options.minNativeOnDest,
        gasTopUpTarget: options.gasTopUpTarget,
        swapEngine: options.swapEngine,
        routerOverride: options.router,
        npmOverride: options.npm,
        factoryOverride: options.factory,
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
        // Vérifier si c'est un succès (collect_skipped, collect_executed, collect_done)
        const SUCCESS_STEPS = new Set(['collect_executed', 'collect_skipped', 'collect_done']);
        const isSuccess = SUCCESS_STEPS.has(result.state.currentStep);
        
        if (isSuccess) {
          console.log('\n🎉 Flow complet exécuté avec succès!');
          console.log(`  Étape finale: ${result.state.currentStep}`);
        } else {
          console.log('\n❌ Flow échoué:');
          console.log(`  Erreur: ${result.error || 'Inconnue'}`);
          console.log(`  Étape: ${result.state.currentStep}`);
          process.exit(1);
        }
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
  .option('--privateKey <key>', 'Clé privée du wallet (par défaut: depuis .env)')
  .action(async (options) => {
    try {
      logger.info({
        message: 'Vérification du statut de l\'orchestrateur'
      });

      // Utiliser la clé privée du .env si pas fournie en paramètre
      const privateKey = options.privateKey || process.env.PRIVATE_KEY;
      if (!privateKey) {
        throw new Error('Clé privée requise: fournissez --privateKey ou définissez PRIVATE_KEY dans .env');
      }

      // Obtenir l'adresse du wallet
      const { createSigner } = await import('../core/rpc.js');
      const signer = await createSigner(privateKey, CONSTANTS.CHAIN_IDS.ABSTRACT);
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
      const signer = await createSigner(options.privateKey, CONSTANTS.CHAIN_IDS.ABSTRACT);
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
  .command('collect')
  .description('Collecter les frais d\'une position LP')
  .option('--privateKey <key>', 'Clé privée du wallet (par défaut: depuis .env)')
  .option('--tokenId <id>', 'Token ID de la position (si non fourni, lit depuis .state)')
  .action(async (options) => {
    try {
      logger.info({
        message: 'Collecte des frais LP'
      });

      // Utiliser la clé privée du .env si pas fournie en paramètre
      const privateKey = options.privateKey || process.env.PRIVATE_KEY;
      if (!privateKey) {
        throw new Error('Clé privée requise: fournissez --privateKey ou définissez PRIVATE_KEY dans .env');
      }

      // Obtenir l'adresse du wallet
      const { createSigner } = await import('../core/rpc.js');
      const signer = await createSigner(privateKey, CONSTANTS.CHAIN_IDS.ABSTRACT);
      const wallet = await signer.getAddress();

      // Obtenir le tokenId
      let tokenId: bigint;
      if (options.tokenId) {
        tokenId = BigInt(options.tokenId);
      } else {
        // Lire depuis l'état
        const state = stateManager.loadState(wallet);
        if (!state || !state.positionResult?.tokenId) {
          console.log('\n❌ Aucune position LP trouvée dans l\'état. Utilisez --tokenId pour spécifier manuellement.');
          return;
        }
        tokenId = state.positionResult.tokenId;
      }

      // Préparer les paramètres de collecte
      const collectParams = {
        tokenId,
        recipient: wallet,
        amount0Max: ethers.MaxUint256,
        amount1Max: ethers.MaxUint256,
      };

      // Collecter les frais
      const result = await liquidityPositionService.collectFees(collectParams, privateKey, {
        dryRun: false,
      });

      if (result.success) {
        console.log('\n✅ Frais collectés avec succès!');
        console.log(`  TX Hash: ${result.txHash}`);
        console.log(`  Montant0: ${result.amount0?.toString() || '0'}`);
        console.log(`  Montant1: ${result.amount1?.toString() || '0'}`);
      } else {
        console.log('\n❌ Échec de la collecte des frais:');
        console.log(`  Erreur: ${result.error}`);
        process.exit(1);
      }

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : 'Unknown error',
        message: 'Erreur lors de la collecte des frais'
      });
      process.exit(1);
    }
  });

program
  .command('unwrap-weth')
  .description('Unwrap WETH vers ETH natif')
  .option('--privateKey <key>', 'Clé privée du wallet (par défaut: depuis .env)')
  .requiredOption('--amount <amount>', 'Montant WETH à unwrap (en ETH)')
  .action(async (options) => {
    try {
      logger.info({
        amount: options.amount,
        message: 'Unwrap WETH vers ETH natif'
      });

      // Utiliser la clé privée du .env si pas fournie en paramètre
      const privateKey = options.privateKey || process.env.PRIVATE_KEY;
      if (!privateKey) {
        throw new Error('Clé privée requise: fournissez --privateKey ou définissez PRIVATE_KEY dans .env');
      }

      const result = await tokenService.unwrapWETH(options.amount, privateKey, {
        dryRun: false,
      });

      if (result.success) {
        console.log('\n✅ WETH unwrap exécuté avec succès!');
        console.log(`  TX Hash: ${result.txHash}`);
        console.log(`  Montant: ${options.amount} WETH → ETH`);
      } else {
        console.log('\n❌ Échec de l\'unwrap WETH:');
        console.log(`  Erreur: ${result.error}`);
        process.exit(1);
      }

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : 'Unknown error',
        message: 'Erreur lors de l\'unwrap WETH'
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

// Commande swap-only
program
  .command('swap-only')
  .description('Exécuter uniquement l\'étape de swap')
  .option('--swapAmount <amount>', 'Montant à swapper', '0.001')
  .option('--swapPair <pair>', 'Paire de tokens (PENGU/USDC)', 'PENGU/USDC')
  .option('--swapEngine <engine>', 'Moteur de swap (v3|lifi|auto)', 'v3')
  .option('--autoGasTopUp <enabled>', 'Auto top-up gas', 'false')
  .option('--dry-run <enabled>', 'Mode simulation', 'false')
  .option('--debug-events', 'Afficher les logs d\'events détaillés', false)
  .action(async (options) => {
    try {
      // Vérifier que la clé privée existe
      const privateKey = process.env.PRIVATE_KEY || '0x1234567890123456789012345678901234567890123456789012345678901234';
      if (!privateKey.startsWith('0x') || privateKey.length !== 66) {
        throw new Error('PRIVATE_KEY invalide: doit commencer par 0x et faire 66 caractères');
      }

      const context = buildContext({
        dryRun: toBool(options.dryRun),
        autoGasTopUp: toBool(options.autoGasTopUp),
        fresh: false,
        swapEngine: options.swapEngine,
        routerOverride: undefined,
        npmOverride: undefined,
        factoryOverride: undefined,
        privateKey: privateKey,
      });

      const orchestrator = new OrchestratorService();
      
      // Créer un état initial
      const signer = await createSigner(privateKey, CONSTANTS.CHAIN_IDS.ABSTRACT);
      const walletAddress = await signer.getAddress();
      const initialState = {
        wallet: asLowerHexAddress(walletAddress),
        currentStep: 'swap_pending' as const,
        bridgeResult: null,
        swapResult: null,
        positionResult: null,
        collectResult: null,
        metrics: {
          startTime: Date.now(),
          endTime: 0,
          totalDuration: 0,
          feesCollected: { token0: '0', token1: '0' }
        }
      };

      // Exécuter uniquement le swap
      const result = await orchestrator.executeSwapStep(initialState, {
        wallet: walletAddress,
        swapAmount: options.swapAmount,
        swapPair: options.swapPair,
        swapEngine: options.swapEngine,
        privateKey: privateKey,
        bridgeAmount: 0,
        bridgeToken: 'USDC',
        lpRangePercent: 5,
        collectAfterMinutes: 0,
        autoGasTopUp: toBool(options.autoGasTopUp),
        fresh: false,
        gasTopUpTarget: 100000000000000,
        routerOverride: undefined,
        npmOverride: undefined,
        factoryOverride: undefined,
      }, context);

      console.log('\n✅ Swap exécuté avec succès!');
      console.log(`  TX Hash: ${result.swapResult?.txHash}`);
      console.log(`  Montant: ${result.swapResult?.amountIn} → ${result.swapResult?.amountOut}`);

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : 'Unknown error',
        message: 'Erreur lors du swap'
      });
      process.exit(1);
    }
  });

// Commande lp-only
program
  .command('lp-only')
  .description('Exécuter uniquement l\'étape de création de position LP')
  .option('--lpRange <percent>', 'Range de liquidité en pourcentage', '5')
  .option('--swapPair <pair>', 'Paire de tokens (PENGU/USDC)', 'PENGU/USDC')
  .option('--dry-run <enabled>', 'Mode simulation', 'false')
  .option('--debug-events', 'Afficher les logs d\'events détaillés', false)
  .action(async (options) => {
    try {
      // Vérifier que la clé privée existe
      const privateKey = process.env.PRIVATE_KEY || '0x1234567890123456789012345678901234567890123456789012345678901234';
      if (!privateKey.startsWith('0x') || privateKey.length !== 66) {
        throw new Error('PRIVATE_KEY invalide: doit commencer par 0x et faire 66 caractères');
      }

      const context = buildContext({
        dryRun: toBool(options.dryRun),
        autoGasTopUp: false,
        fresh: false,
        swapEngine: 'v3',
        routerOverride: undefined,
        npmOverride: undefined,
        factoryOverride: undefined,
        privateKey: privateKey,
      });

      const orchestrator = new OrchestratorService();
      
      // Créer un état initial
      const signer = await createSigner(privateKey, CONSTANTS.CHAIN_IDS.ABSTRACT);
      const walletAddress = await signer.getAddress();
      const initialState = {
        wallet: asLowerHexAddress(walletAddress),
        currentStep: 'lp_pending' as const,
        bridgeResult: null,
        swapResult: null,
        positionResult: null,
        collectResult: null,
        metrics: {
          startTime: Date.now(),
          endTime: 0,
          totalDuration: 0,
          feesCollected: { token0: '0', token1: '0' }
        }
      };

      // Exécuter uniquement la création LP
      const result = await orchestrator.executeLpStep(initialState, {
        wallet: walletAddress,
        lpRangePercent: options.lpRange,
        swapPair: options.swapPair,
        privateKey: privateKey,
        bridgeAmount: 0,
        bridgeToken: 'USDC',
        swapAmount: 0.001,
        swapEngine: 'v3',
        collectAfterMinutes: 0,
        autoGasTopUp: false,
        fresh: false,
        gasTopUpTarget: 100000000000000,
        routerOverride: undefined,
        npmOverride: undefined,
        factoryOverride: undefined,
      }, context, process.env.PRIVATE_KEY!);

      console.log('\n✅ Position LP créée avec succès!');
      console.log(`  TX Hash: ${result.positionResult?.txHash}`);
      console.log(`  Token ID: ${result.positionResult?.tokenId}`);

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : 'Unknown error',
        message: 'Erreur lors de la création LP'
      });
      process.exit(1);
    }
  });

// Commande collect-only
program
  .command('collect-only')
  .description('Exécuter uniquement l\'étape de collecte des frais')
  .requiredOption('--tokenId <id>', 'ID de la position LP')
              .option('--recipient <address>', 'Adresse destinataire (défaut: wallet)')
              .option('--max', 'Utiliser MAX_UINT128 par défaut', true)
  .option('--debug-events', 'Afficher les logs d\'events détaillés', false)
  .option('--dry-run <enabled>', 'Mode simulation', 'false')
  .action(async (options) => {
    try {
      // Vérifier que la clé privée existe
      const privateKey = process.env.PRIVATE_KEY || '0x1234567890123456789012345678901234567890123456789012345678901234';
      if (!privateKey.startsWith('0x') || privateKey.length !== 66) {
        throw new Error('PRIVATE_KEY invalide: doit commencer par 0x et faire 66 caractères');
      }

      // Construire les paramètres correctement
      const walletAddress = (await createSigner(privateKey, CONSTANTS.CHAIN_IDS.ABSTRACT)).getAddress();
      const recipient = options.recipient || walletAddress;
      const limits = options.max 
        ? { amount0Max: 340282366920938463463374607431768211455n, amount1Max: 340282366920938463463374607431768211455n }
        : { amount0Max: 1000000000000000000n, amount1Max: 1000000000000000000n };

      // Exécuter directement la collecte
      const result = await liquidityPositionService.collectFees({
        tokenId: BigInt(options.tokenId),
        recipient: recipient,
        amount0Max: limits.amount0Max,
        amount1Max: limits.amount1Max,
      }, privateKey, {
        dryRun: toBool(options.dryRun),
      });

      console.log('\n✅ Collecte des frais exécutée!');
      console.log(`  Status: ${result.status}`);
      console.log(`  Executed: ${result.executed}`);
      console.log(`  Montant0: ${result.amount0.toString()}`);
      console.log(`  Montant1: ${result.amount1.toString()}`);
      if (result.txHash) {
        console.log(`  TX Hash: ${result.txHash}`);
      }

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : 'Unknown error',
        message: 'Erreur lors de la collecte'
      });
      process.exit(1);
    }
  });

// Parser les arguments de la ligne de commande
program.parse();
