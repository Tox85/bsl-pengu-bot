import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);

describe('CLI Simple Tests', () => {
  const projectRoot = path.resolve(__dirname, '../..');

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

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Commandes CLI de base', () => {
    it('devrait afficher l\'aide du CLI principal', async () => {
      const { stdout, stderr } = await execAsync(
        `node dist/cli/run.js --help`
      );

      expect(stderr).toBe('');
      expect(stdout).toContain('Usage: run [options] [command]');
      expect(stdout).toContain('CLI pour l\'orchestrateur principal');
    }, 10000);

    it('devrait afficher l\'aide de la commande full', async () => {
      const { stdout, stderr } = await execAsync(
        `node dist/cli/run.js full --help`
      );

      expect(stderr).toBe('');
      expect(stdout).toContain('Usage: run full [options]');
      expect(stdout).toContain('Exécuter le flow complet');
    }, 10000);

    it('devrait afficher l\'aide de la commande multi-wallet', async () => {
      const { stdout, stderr } = await execAsync(
        `node dist/cli/run-multi.js --help`
      );

      expect(stderr).toBe('');
      expect(stdout).toContain('Usage: run-multi [options]');
      expect(stdout).toContain('Exécuter la séquence complète pour plusieurs wallets');
    }, 10000);

    it('devrait afficher l\'aide de la commande bybit', async () => {
      const { stdout, stderr } = await execAsync(
        `node dist/cli/bybit-withdraw-hub.js --help`
      );

      expect(stderr).toBe('');
      expect(stdout).toContain('Usage: bybit-withdraw-hub [options]');
    }, 10000);

    it('devrait afficher l\'aide de la commande distribute', async () => {
      const { stdout, stderr } = await execAsync(
        `node dist/cli/distribute-from-hub.js --help`
      );

      expect(stderr).toBe('');
      expect(stdout).toContain('Usage: distribute-from-hub [options]');
    }, 10000);

    it('devrait afficher l\'aide de la commande bridge', async () => {
      const { stdout, stderr } = await execAsync(
        `node dist/cli/bridge-wallet.js --help`
      );

      expect(stderr).toBe('');
      expect(stdout).toContain('Usage: bridge-wallet [options]');
    }, 10000);
  });

  describe('Tests de validation', () => {
    it('devrait valider les montants négatifs', async () => {
      try {
        await execAsync(
          `node dist/cli/run.js full --dry-run --privateKey 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef --bridgeAmount -1`
        );
        expect.fail('Devrait avoir échoué');
      } catch (error: any) {
        expect(error.stderr).toContain('error:');
      }
    }, 10000);

    it('devrait valider les tokens non supportés', async () => {
      try {
        await execAsync(
          `node dist/cli/run.js full --dry-run --privateKey 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef --bridgeToken INVALID`
        );
        expect.fail('Devrait avoir échoué');
      } catch (error: any) {
        expect(error.stderr).toContain('error:');
      }
    }, 10000);
  });

  describe('Gestion des erreurs', () => {
    it('devrait gérer les erreurs de configuration manquante', async () => {
      // Supprimer les variables d'environnement
      delete process.env.MNEMONIC;

      try {
        await execAsync(
          `node dist/cli/run.js full --dry-run --privateKey 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef`
        );
        expect.fail('Devrait avoir échoué');
      } catch (error: any) {
        expect(error.stderr).toContain('error:');
      }
    }, 10000);
  });
});
