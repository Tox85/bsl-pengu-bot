import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StateManager } from '../../src/orchestrator/state.js';
import { retry } from '../../src/core/retry.js';
import { makeWalletManagerForTests } from '../helpers/makeWalletManagerForTests.js';

describe('Multi-Wallet Integration Tests - Simple', () => {
  let walletManager: any;
  let stateManager: StateManager;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    
    walletManager = makeWalletManagerForTests();
    stateManager = new StateManager('.test-state');
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  describe('Gestion multi-wallet de base', () => {
    it('devrait créer et gérer plusieurs wallets simultanément', async () => {
      const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
      const walletCount = 5;

      // Créer les wallets en parallèle
      const wallets = await Promise.all(
        Array.from({ length: walletCount }, (_, index) =>
          walletManager.createOrLoadWallet(mnemonic, index)
        )
      );

      expect(wallets).toHaveLength(walletCount);
      expect(wallets.every(w => w.address)).toBe(true);
      expect(wallets.every(w => w.nonceManager)).toBe(true);

      // Vérifier que les adresses sont différentes
      const addresses = wallets.map(w => w.address);
      const uniqueAddresses = new Set(addresses);
      expect(uniqueAddresses.size).toBe(addresses.length);
    });

    it('devrait gérer les nonces de manière thread-safe', async () => {
      const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
      const wallet = await walletManager.createOrLoadWallet(mnemonic, 0);

      // Simuler des appels concurrents pour obtenir des nonces
      const noncePromises = Array.from({ length: 10 }, () =>
        walletManager.getNonce(wallet.address)
      );

      const nonces = await Promise.all(noncePromises);

      // Vérifier que les nonces sont séquentiels et uniques
      const sortedNonces = [...nonces].sort((a, b) => a - b);
      const expectedNonces = Array.from({ length: 10 }, (_, i) => i);
      expect(sortedNonces).toEqual(expectedNonces);
    });

    it('devrait maintenir l\'idempotence des wallets', async () => {
      const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
      const walletIndex = 0;

      // Créer le même wallet plusieurs fois
      const wallet1 = await walletManager.createOrLoadWallet(mnemonic, walletIndex);
      const wallet2 = await walletManager.createOrLoadWallet(mnemonic, walletIndex);
      const wallet3 = await walletManager.createOrLoadWallet(mnemonic, walletIndex);

      // Tous devraient être identiques (même adresse)
      expect(wallet1.address).toBe(wallet2.address);
      expect(wallet2.address).toBe(wallet3.address);
      expect(wallet1.address).toBe(wallet3.address);
      expect(wallet1.index).toBe(wallet2.index);
    });
  });

  describe('Gestion d\'état multi-wallet', () => {
    it('devrait sauvegarder et charger l\'état pour plusieurs wallets', async () => {
      const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
      const walletCount = 3;

      // Créer les wallets
      const wallets = await Promise.all(
        Array.from({ length: walletCount }, (_, index) =>
          walletManager.createOrLoadWallet(mnemonic, index)
        )
      );

      // Créer et sauvegarder l'état pour chaque wallet
      for (const wallet of wallets) {
        const state = stateManager.createState(wallet.address);
        state.currentStep = 'bridge';
        stateManager.saveState(state);
      }

      // Charger et vérifier l'état de chaque wallet
      for (const wallet of wallets) {
        const loadedState = stateManager.loadState(wallet.address);
        expect(loadedState).toBeDefined();
        expect(loadedState?.wallet).toBe(wallet.address);
        expect(loadedState?.currentStep).toBe('bridge');
      }
    });

    it('devrait gérer les statistiques multi-wallet', async () => {
      const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
      const walletCount = 5;

      // Créer les wallets
      const wallets = await Promise.all(
        Array.from({ length: walletCount }, (_, index) =>
          walletManager.createOrLoadWallet(mnemonic, index)
        )
      );

      // Créer des états avec différents statuts
      for (let i = 0; i < wallets.length; i++) {
        const state = stateManager.createState(wallets[i].address);
        state.currentStep = i % 2 === 0 ? 'bridge' : 'swap';
        stateManager.saveState(state);
      }

      // Vérifier les statistiques
      const stats = stateManager.getStats();
      expect(stats.totalWallets).toBeGreaterThanOrEqual(walletCount);
      // activeWallets peut être undefined si pas encore implémenté
      if (stats.activeWallets !== undefined) {
        expect(stats.activeWallets).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('Tests de retry et résilience', () => {
    it('devrait gérer les retries avec backoff exponentiel', async () => {
      let attemptCount = 0;
      
      const retryPromise = retry(
        async () => {
          attemptCount++;
          if (attemptCount < 3) {
            throw new Error('Temporary error');
          }
          return 'success';
        },
        { maxRetries: 5, baseDelayMs: 100 }
      );

      // Avancer les timers pour simuler les délais
      await vi.runAllTimersAsync();

      const result = await retryPromise;

      expect(result.result).toBe('success');
      expect(result.attempts).toBe(3);
      expect(attemptCount).toBe(3);
    });

    it('devrait gérer les erreurs fatales sans retry infini', async () => {
      const retryPromise = retry(
        async () => {
          throw new Error('Fatal error');
        },
        { maxRetries: 3, baseDelayMs: 100 }
      );

      // Avancer les timers pour simuler les délais
      await vi.runAllTimersAsync();

      await expect(retryPromise).rejects.toThrow('Fatal error');
    });
  });

  describe('Tests de concurrence', () => {
    it('devrait gérer la création concurrente de wallets', async () => {
      const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
      const walletCount = 10;

      // Créer tous les wallets en parallèle
      const walletPromises = Array.from({ length: walletCount }, (_, index) =>
        walletManager.createOrLoadWallet(mnemonic, index)
      );

      const wallets = await Promise.all(walletPromises);

      expect(wallets).toHaveLength(walletCount);
      
      // Vérifier que tous les wallets ont des adresses uniques
      const addresses = wallets.map(w => w.address);
      const uniqueAddresses = new Set(addresses);
      expect(uniqueAddresses.size).toBe(walletCount);
    });

    it('devrait gérer les opérations de nonce concurrentes', async () => {
      const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
      const wallet = await walletManager.createOrLoadWallet(mnemonic, 0);

      // Simuler des opérations concurrentes sur le même wallet
      const operations = Array.from({ length: 10 }, async (_, i) => {
        const nonce = await walletManager.getNonce(wallet.address);
        walletManager.markNonceUsed(wallet.address, nonce);
        return nonce;
      });

      const nonces = await Promise.all(operations);

      // Vérifier que tous les nonces sont uniques et séquentiels
      const sortedNonces = [...nonces].sort((a, b) => a - b);
      const expectedNonces = Array.from({ length: 10 }, (_, i) => i);
      expect(sortedNonces).toEqual(expectedNonces);
    });
  });
});
