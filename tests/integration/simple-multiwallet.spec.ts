import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { makeWalletManagerForTests } from '../helpers/makeWalletManagerForTests.js';
import { StateManager } from '../../src/orchestrator/state.js';
import { retry } from '../../src/core/retry.js';

// Plus besoin de mocker rpc.js grâce à l'injection de dépendance
// Le mock ethers global dans tests/setup.ts sera utilisé

describe('Simple Multi-Wallet Tests', () => {
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

  it('devrait créer plusieurs wallets depuis un mnémonique', async () => {
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const walletCount = 3;

    // Créer les wallets
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

  it('devrait gérer les nonces correctement', async () => {
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const wallet = await walletManager.createOrLoadWallet(mnemonic, 0);

    // Obtenir plusieurs nonces
    const nonce1 = await walletManager.getNonce(wallet.address);
    const nonce2 = await walletManager.getNonce(wallet.address);
    const nonce3 = await walletManager.getNonce(wallet.address);

    expect(nonce1).toBe(0);
    expect(nonce2).toBe(1);
    expect(nonce3).toBe(2);

    // Marquer un nonce comme utilisé
    walletManager.markNonceUsed(wallet.address, nonce1);
    
    // Le prochain nonce devrait être 3
    const nonce4 = await walletManager.getNonce(wallet.address);
    expect(nonce4).toBe(3);
  });

  it('devrait sauvegarder et charger l\'état', async () => {
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const wallet = await walletManager.createOrLoadWallet(mnemonic, 0);
    const walletAddress = wallet.address;

    // Créer un état
    const state = stateManager.createState(walletAddress);
    expect(state.wallet).toBe(walletAddress);
    expect(state.currentStep).toBe('idle');

    // Sauvegarder l'état
    stateManager.saveState(state);

    // Charger l'état
    const loadedState = stateManager.loadState(walletAddress);
    expect(loadedState).toBeDefined();
    expect(loadedState?.wallet).toBe(walletAddress);
    expect(loadedState?.currentStep).toBe('idle');
  });

  it('devrait exécuter le retry correctement', async () => {
    let attemptCount = 0;
    
    const retryPromise = retry(
      async () => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error('Temporary error');
        }
        return 'success';
      },
      { maxRetries: 3, baseDelayMs: 100 }
    );

    // Avancer les timers pour simuler les délais
    await vi.runAllTimersAsync();

    const result = await retryPromise;

    expect(result.result).toBe('success');
    expect(result.attempts).toBe(3);
    expect(attemptCount).toBe(3);
  });

  it('devrait gérer les erreurs fatales dans le retry', async () => {
    try {
      const retryPromise = retry(
        async () => {
          throw new Error('Fatal error');
        },
        { maxRetries: 2, baseDelayMs: 100 }
      );
      // Advance timers to complete retries
      await vi.runAllTimersAsync();
      await retryPromise;
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error.message).toBe('Fatal error');
    }
  });

  it('devrait maintenir l\'idempotence des wallets', async () => {
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const walletIndex = 0;

    // Créer le même wallet deux fois
    const wallet1 = await walletManager.createOrLoadWallet(mnemonic, walletIndex);
    const wallet2 = await walletManager.createOrLoadWallet(mnemonic, walletIndex);

    // Les deux devraient être identiques (même référence d'objet)
    expect(wallet1).toStrictEqual(wallet2);
    expect(wallet1.address).toBe(wallet2.address);
    expect(wallet1.index).toBe(wallet2.index);
  });
});
