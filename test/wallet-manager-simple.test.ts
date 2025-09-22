import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WalletManager } from '../src/core/wallet-manager.js';

// Mock simple d'ethers
const mockWallet = {
  address: '0x742d35Cc6634C0532925a3b8D1B2b3b4C5D6E7F8',
  privateKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
};

const mockProvider = {
  getTransactionCount: vi.fn(),
  getBalance: vi.fn(),
};

// Mock ethers avec des fonctions mock simples
vi.mock('ethers', () => ({
  Wallet: {
    fromPhrase: vi.fn(() => mockWallet),
    createRandom: vi.fn(() => ({
      mnemonic: { phrase: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about' },
    })),
  },
}));

describe('WalletManager', () => {
  let walletManager: WalletManager;
  const testMnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

  beforeEach(() => {
    walletManager = new WalletManager();
    vi.clearAllMocks();
  });

  describe('createWalletFromMnemonic', () => {
    it('devrait créer un wallet depuis un mnémonique', () => {
      const result = walletManager.createWalletFromMnemonic({
        mnemonic: testMnemonic,
        index: 0,
        provider: mockProvider,
      });

      expect(result.address).toBe(mockWallet.address);
      expect(result.index).toBe(0);
      expect(walletManager.hasWallet(mockWallet.address)).toBe(true);
    });

    it('devrait créer des wallets avec des index différents', () => {
      const result1 = walletManager.createWalletFromMnemonic({
        mnemonic: testMnemonic,
        index: 0,
        provider: mockProvider,
      });

      const result2 = walletManager.createWalletFromMnemonic({
        mnemonic: testMnemonic,
        index: 1,
        provider: mockProvider,
      });

      expect(result1.index).toBe(0);
      expect(result2.index).toBe(1);
    });
  });

  describe('addWallet', () => {
    it('devrait ajouter un wallet via clé privée', () => {
      const privateKey = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      const result = walletManager.addWallet(privateKey, 5);

      expect(result.address).toBe(mockWallet.address);
      expect(result.index).toBe(5);
      expect(walletManager.hasWallet(mockWallet.address)).toBe(true);
    });
  });

  describe('getNonce', () => {
    it('devrait obtenir le nonce correctement', async () => {
      mockProvider.getTransactionCount.mockResolvedValue(5);

      walletManager.createWalletFromMnemonic({
        mnemonic: testMnemonic,
        index: 0,
        provider: mockProvider,
      });

      const nonce = await walletManager.getNonce(mockWallet.address, mockProvider);

      expect(nonce).toBe(5);
      expect(mockProvider.getTransactionCount).toHaveBeenCalledWith(mockWallet.address);
    });

    it('devrait gérer les nonces concurrents', async () => {
      mockProvider.getTransactionCount.mockResolvedValue(5);

      walletManager.createWalletFromMnemonic({
        mnemonic: testMnemonic,
        index: 0,
        provider: mockProvider,
      });

      // Simuler des appels concurrents
      const promises = [
        walletManager.getNonce(mockWallet.address, mockProvider),
        walletManager.getNonce(mockWallet.address, mockProvider),
        walletManager.getNonce(mockWallet.address, mockProvider),
      ];

      const nonces = await Promise.all(promises);

      expect(nonces[0]).toBe(5);
      expect(nonces[1]).toBe(6);
      expect(nonces[2]).toBe(7);
    });
  });

  describe('createMultipleWallets', () => {
    it('devrait créer plusieurs wallets', () => {
      const wallets = walletManager.createMultipleWallets(testMnemonic, 3, 10);

      expect(wallets).toHaveLength(3);
      expect(wallets[0].index).toBe(10);
      expect(wallets[1].index).toBe(11);
      expect(wallets[2].index).toBe(12);
    });
  });

  describe('getWallets', () => {
    it('devrait retourner tous les wallets', () => {
      walletManager.createWalletFromMnemonic({
        mnemonic: testMnemonic,
        index: 0,
        provider: mockProvider,
      });

      walletManager.createWalletFromMnemonic({
        mnemonic: testMnemonic,
        index: 1,
        provider: mockProvider,
      });

      const wallets = walletManager.getWallets();

      expect(wallets).toHaveLength(2);
      expect(wallets[0].index).toBe(0);
      expect(wallets[1].index).toBe(1);
    });
  });

  describe('removeWallet', () => {
    it('devrait supprimer un wallet', () => {
      walletManager.createWalletFromMnemonic({
        mnemonic: testMnemonic,
        index: 0,
        provider: mockProvider,
      });

      expect(walletManager.hasWallet(mockWallet.address)).toBe(true);

      walletManager.removeWallet(mockWallet.address);

      expect(walletManager.hasWallet(mockWallet.address)).toBe(false);
    });
  });

  describe('getStats', () => {
    it('devrait retourner les statistiques', () => {
      walletManager.createWalletFromMnemonic({
        mnemonic: testMnemonic,
        index: 0,
        provider: mockProvider,
      });

      const stats = walletManager.getStats();

      expect(stats.totalWallets).toBe(1);
      expect(stats.walletAddresses).toHaveLength(1);
      expect(stats.nonceStats).toHaveProperty(mockWallet.address);
    });
  });

  describe('validateMnemonic', () => {
    it('devrait valider un mnémonique valide', () => {
      const isValid = WalletManager.validateMnemonic(testMnemonic);
      expect(isValid).toBe(true);
    });

    it('devrait rejeter un mnémonique invalide', () => {
      const isValid = WalletManager.validateMnemonic('invalid mnemonic');
      expect(isValid).toBe(false);
    });
  });

  describe('generateMnemonic', () => {
    it('devrait générer un mnémonique', () => {
      const mnemonic = WalletManager.generateMnemonic();
      expect(typeof mnemonic).toBe('string');
      expect(mnemonic.split(' ')).toHaveLength(12);
    });
  });
});
