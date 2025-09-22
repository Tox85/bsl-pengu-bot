#!/usr/bin/env node

import { Command } from 'commander';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const program = new Command();

program
  .name('multi-wallet-cli')
  .description('Interface CLI pour les opérations multi-wallet')
  .version('1.0.0');

// Commande pour retirer depuis Bybit vers le Hub
program
  .command('bybit-withdraw-hub')
  .description('Retirer des fonds depuis Bybit vers le wallet Hub')
  .option('--dry-run', 'Simuler le retrait sans l\'exécuter')
  .option('--poll', 'Attendre la complétion du retrait')
  .option('--token <token>', 'Token à retirer (USDC, ETH)', 'USDC')
  .option('--amount <amount>', 'Montant à retirer')
  .option('--network <network>', 'Réseau de destination', 'ARBITRUM')
  .option('--hub-address <address>', 'Adresse du wallet Hub')
  .option('--timeout <timeout>', 'Timeout pour le polling en ms', '300000')
  .option('--interval <interval>', 'Intervalle de polling en ms', '10000')
  .action((options) => {
    import(pathToFileURL(path.join(__dirname, '../dist/cli/bybit-withdraw-hub.js')).href);
  });

// Commande pour distribuer depuis le Hub
program
  .command('distribute-from-hub')
  .description('Distribuer des fonds depuis le wallet Hub vers les wallets dérivés')
  .option('--dry-run', 'Simuler la distribution sans l\'exécuter')
  .option('--batch-size <size>', 'Taille des batches pour la distribution', '10')
  .option('--usdc-amount <amount>', 'Montant USDC par wallet')
  .option('--eth-amount <amount>', 'Montant ETH par wallet')
  .option('--randomize', 'Randomiser les montants de distribution')
  .option('--variation <percent>', 'Pourcentage de variation des montants', '10')
  .action((options) => {
    import(pathToFileURL(path.join(__dirname, '../dist/cli/distribute-from-hub.js')).href);
  });

// Commande pour bridger un wallet spécifique
program
  .command('bridge-wallet')
  .description('Exécuter le bridge pour un wallet spécifique')
  .option('--wallet <wallet>', 'Index du wallet ou adresse (requis)')
  .option('--dry-run', 'Simuler le bridge sans l\'exécuter')
  .option('--amount <amount>', 'Montant à bridger', '1')
  .option('--token <token>', 'Token à bridger', 'USDC')
  .option('--from-chain <chain>', 'Chaîne source', 'ARBITRUM')
  .option('--to-chain <chain>', 'Chaîne destination', 'ABSTRACT')
  .option('--auto-topup', 'Activer le top-up automatique de gas')
  .action((options) => {
    import(pathToFileURL(path.join(__dirname, '../dist/cli/bridge-wallet.js')).href);
  });

// Commande pour exécuter la séquence complète pour un wallet
program
  .command('run-wallet')
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
  .action((options) => {
    import(pathToFileURL(path.join(__dirname, '../dist/cli/run-wallet.js')).href);
  });

// Commande pour exécuter la séquence sur plusieurs wallets
program
  .command('run-multi')
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
  .action((options) => {
    import(pathToFileURL(path.join(__dirname, '../dist/cli/run-multi.js')).href);
  });

// Commande pour afficher le statut
program
  .command('status')
  .description('Afficher le statut des wallets et du système')
  .option('--wallet <wallet>', 'Afficher le statut d\'un wallet spécifique (index ou adresse)')
  .option('--format <format>', 'Format de sortie (json, table)', 'table')
  .option('--chains <chains>', 'Chaînes à vérifier (ARBITRUM,ABSTRACT)', 'ARBITRUM,ABSTRACT')
  .action((options) => {
    import(pathToFileURL(path.join(__dirname, '../dist/cli/status.js')).href);
  });

// Commande pour réinitialiser un wallet
program
  .command('reset-wallet')
  .description('Réinitialiser le statut d\'un wallet')
  .option('--wallet <wallet>', 'Index du wallet ou adresse (requis)')
  .option('--reset-nonce', 'Réinitialiser le nonce du wallet')
  .option('--confirm', 'Confirmer la réinitialisation sans demander')
  .action((options) => {
    import(pathToFileURL(path.join(__dirname, '../dist/cli/reset-wallet.js')).href);
  });

// Commande pour générer des rapports
program
  .command('generate-report')
  .description('Générer un rapport d\'exécution')
  .option('--run-id <id>', 'ID de la run à analyser (par défaut: la plus récente)')
  .option('--format <format>', 'Format du rapport (text, json, html)', 'text')
  .option('--output <file>', 'Fichier de sortie (optionnel)')
  .option('--artifacts-dir <dir>', 'Répertoire des artifacts', 'artifacts')
  .action((options) => {
    import(pathToFileURL(path.join(__dirname, '../dist/cli/generate-report.js')).href);
  });

// Commande d'aide pour les exemples
program
  .command('examples')
  .description('Afficher des exemples d\'utilisation')
  .action(() => {
    console.log(`
=== EXEMPLES D'UTILISATION ===

1. Retrait depuis Bybit vers le Hub:
   node scripts/cli-multi-wallet.js bybit-withdraw-hub --dry-run --token USDC --amount 50
   node scripts/cli-multi-wallet.js bybit-withdraw-hub --token USDC --amount 50 --poll

2. Distribution depuis le Hub vers les wallets:
   node scripts/cli-multi-wallet.js distribute-from-hub --dry-run --batch-size 5
   node scripts/cli-multi-wallet.js distribute-from-hub --usdc-amount 10 --eth-amount 0.005

3. Bridge d'un wallet spécifique:
   node scripts/cli-multi-wallet.js bridge-wallet --wallet 0 --dry-run --amount 1
   node scripts/cli-multi-wallet.js bridge-wallet --wallet 0x123... --amount 1

4. Séquence complète pour un wallet:
   node scripts/cli-multi-wallet.js run-wallet --wallet 0 --dry-run
   node scripts/cli-multi-wallet.js run-wallet --wallet 0 --skip-bridge --collect-after 5

5. Séquence complète pour plusieurs wallets:
   node scripts/cli-multi-wallet.js run-multi --dry-run --from 0 --to 10
   node scripts/cli-multi-wallet.js run-multi --from 0 --to 5 --batch-size 3 --sequential

6. Statut du système:
   node scripts/cli-multi-wallet.js status
   node scripts/cli-multi-wallet.js status --wallet 0 --format json

7. Réinitialisation d'un wallet:
   node scripts/cli-multi-wallet.js reset-wallet --wallet 0 --confirm

=== WORKFLOW COMPLET ===

1. Configuration initiale:
   - Configurer les variables d'environnement dans .env
   - Whitelister l'adresse Hub sur Bybit

2. Retrait depuis Bybit:
   node scripts/cli-multi-wallet.js bybit-withdraw-hub --token USDC --amount 1000 --poll

3. Distribution vers les wallets:
   node scripts/cli-multi-wallet.js distribute-from-hub --batch-size 10

4. Exécution des séquences DeFi:
   node scripts/cli-multi-wallet.js run-multi --from 0 --to 99 --batch-size 10

5. Vérification du statut:
   node scripts/cli-multi-wallet.js status --format table
`);
  });

program.parse();
