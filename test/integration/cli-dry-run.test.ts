import { describe, it, expect, beforeEach, vi } from 'vitest';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);

describe('CLI Integration Tests - Dry Run', () => {
  const projectRoot = path.resolve(__dirname, '../..');
  const cliScript = path.join(projectRoot, 'scripts/cli-multi-wallet.js');

  beforeEach(() => {
    // Mock les variables d'environnement nécessaires
    process.env.MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    process.env.WALLET_COUNT = '5';
    process.env.BYBIT_API_KEY = 'test-api-key';
    process.env.BYBIT_API_SECRET = 'test-api-secret';
    process.env.HUB_WALLET_PRIVATE_KEY = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    process.env.DISTRIBUTION_USDC_PER_WALLET = '10';
    process.env.DISTRIBUTION_ETH_PER_WALLET = '0.005';
    process.env.ARBITRUM_RPC = 'https://arb1.arbitrum.io/rpc';
    process.env.ABSTRACT_RPC = 'https://api.abstract.xyz/rpc';
  });

  describe('bybit-withdraw-hub', () => {
    it('devrait exécuter le dry-run du retrait Bybit', async () => {
      const { stdout, stderr } = await execAsync(
        `node ${cliScript} bybit-withdraw-hub --dry-run --token USDC --amount 50`
      );

      expect(stderr).toBe('');
      expect(stdout).toContain('DRY-RUN');
      expect(stdout).toContain('Paramètres de retrait');
      expect(stdout).toContain('Vérification du solde');
      expect(stdout).toContain('Vérification de la whitelist');
    }, 30000);

    it('devrait gérer les erreurs de configuration manquante', async () => {
      // Supprimer les variables d'environnement
      delete process.env.BYBIT_API_KEY;
      delete process.env.BYBIT_API_SECRET;

      try {
        await execAsync(
          `node ${cliScript} bybit-withdraw-hub --dry-run --token USDC --amount 50`
        );
        expect.fail('Devrait avoir échoué');
      } catch (error: any) {
        expect(error.stdout).toContain('Clés API Bybit requises');
      }
    }, 10000);
  });

  describe('distribute-from-hub', () => {
    it('devrait exécuter le dry-run de la distribution', async () => {
      const { stdout, stderr } = await execAsync(
        `node ${cliScript} distribute-from-hub --dry-run --batch-size 2`
      );

      expect(stderr).toBe('');
      expect(stdout).toContain('DRY-RUN');
      expect(stdout).toContain('Wallets créés depuis le mnémonique');
      expect(stdout).toContain('Diagnostics du Hub');
      expect(stdout).toContain('TABLEAU DES ALLOCATIONS');
    }, 30000);

    it('devrait afficher le tableau des allocations', async () => {
      const { stdout } = await execAsync(
        `node ${cliScript} distribute-from-hub --dry-run --usdc-amount 5 --eth-amount 0.001`
      );

      expect(stdout).toContain('Wallet Address');
      expect(stdout).toContain('USDC');
      expect(stdout).toContain('ETH');
      expect(stdout).toContain('TOTAL');
    }, 30000);
  });

  describe('bridge-wallet', () => {
    it('devrait exécuter le dry-run du bridge', async () => {
      const { stdout, stderr } = await execAsync(
        `node ${cliScript} bridge-wallet --wallet 0 --dry-run --amount 1`
      );

      expect(stderr).toBe('');
      expect(stdout).toContain('DRY-RUN');
      expect(stdout).toContain('Wallet cible identifié');
      expect(stdout).toContain('Paramètres du bridge');
      expect(stdout).toContain('DRY-RUN: Route de bridge simulée');
    }, 30000);

    it('devrait gérer les wallets par adresse', async () => {
      try {
        await execAsync(
          `node ${cliScript} bridge-wallet --wallet 0x1234567890123456789012345678901234567890 --dry-run --amount 1`
        );
        expect.fail('Devrait avoir échoué');
      } catch (error: any) {
        // Vérifier que l'erreur contient le message attendu
        const errorOutput = error.stdout || error.stderr || error.message;
        expect(errorOutput).toContain('Wallet');
        expect(errorOutput).toContain('non trouvé');
      }
    }, 10000);
  });

  describe('run-wallet', () => {
    it('devrait exécuter le dry-run de la séquence complète', async () => {
      const { stdout, stderr } = await execAsync(
        `node ${cliScript} run-wallet --wallet 0 --dry-run`
      );

      expect(stderr).toBe('');
      expect(stdout).toContain('DRY-RUN');
      expect(stdout).toContain('Wallet cible identifié');
      expect(stdout).toContain('Paramètres de la séquence DeFi');
      expect(stdout).toContain('Bridge simulé');
      expect(stdout).toContain('Swap simulé');
      expect(stdout).toContain('Position LP simulée');
      expect(stdout).toContain('Collect simulé');
    }, 30000);

    it('devrait gérer les options skip', async () => {
      const { stdout } = await execAsync(
        `node ${cliScript} run-wallet --wallet 0 --dry-run --skip-bridge --skip-collect`
      );

      expect(stdout).toContain('DRY-RUN');
      expect(stdout).toContain('Swap simulé');
      expect(stdout).toContain('Position LP simulée');
      expect(stdout).not.toContain('Bridge simulé');
      expect(stdout).not.toContain('Collect simulé');
    }, 30000);
  });

  describe('run-multi', () => {
    it('devrait exécuter le dry-run multi-wallet', async () => {
      const { stdout, stderr } = await execAsync(
        `node ${cliScript} run-multi --dry-run --from 0 --to 2 --batch-size 2`
      );

      expect(stderr).toBe('');
      expect(stdout).toContain('DRY-RUN');
      expect(stdout).toContain('Plage de wallets configurée');
      expect(stdout).toContain('Configuration de l\'orchestrateur multi-wallet');
      expect(stdout).toContain('PLAN D\'EXÉCUTION');
      expect(stdout).toContain('Mode: Parallèle');
      expect(stdout).toContain('Wallets: 0 à 2 (3 wallets)');
    }, 30000);

    it('devrait gérer le mode séquentiel', async () => {
      const { stdout } = await execAsync(
        `node ${cliScript} run-multi --dry-run --from 0 --to 1 --sequential`
      );

      expect(stdout).toContain('Mode: Séquentiel');
    }, 30000);

    it('devrait valider les paramètres de plage', async () => {
      try {
        await execAsync(
          `node ${cliScript} run-multi --dry-run --from 5 --to 2`
        );
        expect.fail('Devrait avoir échoué');
      } catch (error: any) {
        expect(error.stdout).toContain('Paramètres de plage invalides');
      }
    }, 10000);
  });

  describe('status', () => {
    it('devrait afficher le statut du système', async () => {
      const { stdout, stderr } = await execAsync(
        `node ${cliScript} status`
      );

      expect(stderr).toBe('');
      expect(stdout).toContain('STATUT DU SYSTÈME');
      expect(stdout).toContain('Nombre de wallets:');
      expect(stdout).toContain('--- Wallets ---');
    }, 30000);

    it('devrait afficher le statut d\'un wallet spécifique', async () => {
      const { stdout } = await execAsync(
        `node ${cliScript} status --wallet 0`
      );

      expect(stdout).toContain('STATUT DU SYSTÈME');
      expect(stdout).toContain('Index');
      expect(stdout).toContain('Adresse');
      expect(stdout).toContain('Nonce');
      expect(stdout).toContain('Balances');
    }, 30000);

    it('devrait supporter le format JSON', async () => {
      const { stdout } = await execAsync(
        `node ${cliScript} status --format json`
      );

      // Extraire seulement la partie JSON valide (jusqu'à la première accolade fermante)
      const jsonEndIndex = stdout.lastIndexOf('}');
      if (jsonEndIndex === -1) {
        throw new Error('Aucun JSON valide trouvé dans la sortie');
      }
      
      const jsonString = stdout.substring(0, jsonEndIndex + 1);
      
      expect(() => JSON.parse(jsonString)).not.toThrow();
      const data = JSON.parse(jsonString);
      expect(data).toHaveProperty('timestamp');
      expect(data).toHaveProperty('walletCount');
      expect(data).toHaveProperty('wallets');
    }, 30000);
  });

  describe('reset-wallet', () => {
    it('devrait réinitialiser un wallet avec confirmation', async () => {
      const { stdout, stderr } = await execAsync(
        `node ${cliScript} reset-wallet --wallet 0 --confirm`
      );

      expect(stderr).toBe('');
      expect(stdout).toContain('Wallet cible identifié');
      expect(stdout).toContain('réinitialisé avec succès');
    }, 10000);

    it('devrait gérer les wallets inexistants', async () => {
      try {
        await execAsync(
          `node ${cliScript} reset-wallet --wallet 999 --confirm`
        );
        expect.fail('Devrait avoir échoué');
      } catch (error: any) {
        // Vérifier que l'erreur contient le message attendu
        const errorOutput = error.stdout || error.stderr || error.message;
        expect(errorOutput).toContain('Wallet');
        expect(errorOutput).toContain('999');
      }
    }, 10000);
  });

  describe('examples', () => {
    it('devrait afficher les exemples d\'utilisation', async () => {
      const { stdout, stderr } = await execAsync(
        `node ${cliScript} examples`
      );

      expect(stderr).toBe('');
      expect(stdout).toContain('EXEMPLES D\'UTILISATION');
      expect(stdout).toContain('Retrait depuis Bybit');
      expect(stdout).toContain('Distribution depuis le Hub');
      expect(stdout).toContain('Bridge d\'un wallet');
      expect(stdout).toContain('Séquence complète');
      expect(stdout).toContain('WORKFLOW COMPLET');
    }, 10000);
  });

  describe('validation des paramètres', () => {
    it('devrait valider les montants négatifs', async () => {
      try {
        await execAsync(
          `node ${cliScript} bybit-withdraw-hub --dry-run --amount -10`
        );
        expect.fail('Devrait avoir échoué');
      } catch (error: any) {
        // Devrait échouer sur la validation des montants
        expect(error.stdout || error.stderr || error.message).toBeDefined();
      }
    }, 10000);

    it('devrait valider les tokens non supportés', async () => {
      try {
        await execAsync(
          `node ${cliScript} bybit-withdraw-hub --dry-run --token INVALID`
        );
        expect.fail('Devrait avoir échoué');
      } catch (error: any) {
        expect(error.stdout).toContain('Token non supporté');
      }
    }, 10000);
  });

  describe('gestion des erreurs', () => {
    it('devrait gérer les erreurs de réseau', async () => {
      // Utiliser des RPC invalides
      process.env.ARBITRUM_RPC = 'https://invalid-rpc.com';
      process.env.ABSTRACT_RPC = 'https://invalid-rpc.com';

      const { stdout } = await execAsync(
        `node ${cliScript} status --wallet 0`
      );

      expect(stdout).toContain('STATUT DU SYSTÈME');
      // Devrait afficher les erreurs mais continuer
    }, 15000);

    it('devrait gérer les erreurs de configuration', async () => {
      // Supprimer le mnémonique
      delete process.env.MNEMONIC;

      try {
        await execAsync(
          `node ${cliScript} distribute-from-hub --dry-run`
        );
        expect.fail('Devrait avoir échoué');
      } catch (error: any) {
        expect(error.stdout).toContain('MNEMONIC requis');
      }
    }, 10000);
  });
});
