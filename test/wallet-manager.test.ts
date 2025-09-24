import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WalletManager } from '../src/core/wallet-manager.js';

// Mock ethers avec des fonctions mock simples
vi.mock('ethers', async (importOriginal) => {
  const actual = await importOriginal();
  
  const mockWallet = {
    address: '0x742d35Cc6634C0532925a3b8D1B2b3b4C5D6E7F8',
    privateKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    publicKey: '0x04bfcab58fbd8c6f5f5d3b1782e46b408e5f1e7d512975a9f03d3bd6e10c7a8f17e5b6b7bde7f73c62f0bca6ecb3efa1b9bd8e5dcd7f2571c2cb2bfa7b4b5b6c',
  };

  const mockHdNode = {
    privateKey: mockWallet.privateKey,
    publicKey: mockWallet.publicKey,
  };
  
  // Mock du constructeur Wallet
  const MockWallet = vi.fn().mockImplementation(() => mockWallet);
  
  // Ajouter les méthodes statiques
  MockWallet.fromPhrase = vi.fn(() => mockWallet);
  MockWallet.createRandom = vi.fn(() => ({
    mnemonic: { phrase: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about' },
  }));
  MockWallet.fromPrivateKey = vi.fn(() => mockWallet);
  
  return {
    ...actual,
    Wallet: MockWallet,
    HDNodeWallet: {
      fromPhrase: vi.fn(() => mockHdNode),
    },
  };
});

// Mock du module logger
vi.mock('../src/core/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock du module rpc
vi.mock('../src/core/rpc.js', () => ({
  getProvider: vi.fn(() => ({
    getTransactionCount: vi.fn(),
    getBalance: vi.fn(),
  })),
}));

// Mock simple d'ethers
const mockWallet = {
  address: '0x742d35Cc6634C0532925a3b8D1B2b3b4C5D6E7F8',
  privateKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  publicKey: '0x04bfcab58fbd8c6f5f5d3b1782e46b408e5f1e7d512975a9f03d3bd6e10c7a8f17e5b6b7bde7f73c62f0bca6ecb3efa1b9bd8e5dcd7f2571c2cb2bfa7b4b5b6c',
};

const mockProvider = {
  getTransactionCount: vi.fn(),
  getBalance: vi.fn(),
};

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

      expect(result.address).toBeDefined();
      expect(typeof result.address).toBe('string');
      expect(result.address.startsWith('0x')).toBe(true);
      expect(result.index).toBe(0);
      expect(walletManager.hasWallet(result.address)).toBe(true);
      expect(result.publicKey).toBe(mockWallet.publicKey);
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

      expect(result.address).toBeDefined();
      expect(typeof result.address).toBe('string');
      expect(result.address.startsWith('0x')).toBe(true);
      expect(result.index).toBe(5);
      expect(walletManager.hasWallet(result.address)).toBe(true);
      expect(result.publicKey).toBe(mockWallet.publicKey);
    });
  });

  describe('getNonce', () => {
    it('devrait obtenir le nonce correctement', async () => {
      mockProvider.getTransactionCount.mockResolvedValue(5);

      const walletResult = walletManager.createWalletFromMnemonic({
        mnemonic: testMnemonic,
        index: 0,
        provider: mockProvider,
      });

      const nonce = await walletManager.getNonce(walletResult.address, mockProvider);

      expect(nonce).toBe(5);
      expect(mockProvider.getTransactionCount).toHaveBeenCalledWith(walletResult.address);
    });

    it('devrait gérer les nonces concurrents', async () => {
      mockProvider.getTransactionCount.mockResolvedValue(5);

      const walletResult = walletManager.createWalletFromMnemonic({
        mnemonic: testMnemonic,
        index: 0,
        provider: mockProvider,
      });

      // Simuler des appels concurrents
      const promises = [
        walletManager.getNonce(walletResult.address, mockProvider),
        walletManager.getNonce(walletResult.address, mockProvider),
        walletManager.getNonce(walletResult.address, mockProvider),
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
      const wallet1 = walletManager.createWalletFromMnemonic({
        mnemonic: testMnemonic,
        index: 0,
        provider: mockProvider,
      });

      const wallet2 = walletManager.createWalletFromMnemonic({
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
      const walletResult = walletManager.createWalletFromMnemonic({
        mnemonic: testMnemonic,
        index: 0,
        provider: mockProvider,
      });

      expect(walletManager.hasWallet(walletResult.address)).toBe(true);

      walletManager.removeWallet(walletResult.address);

      expect(walletManager.hasWallet(walletResult.address)).toBe(false);
    });
  });

  describe('getStats', () => {
    it('devrait retourner les statistiques', () => {
      const walletResult = walletManager.createWalletFromMnemonic({
        mnemonic: testMnemonic,
        index: 0,
        provider: mockProvider,
      });

      const stats = walletManager.getStats();

      expect(stats.totalWallets).toBe(1);
      expect(stats.addresses).toHaveLength(1);
      expect(stats.publicKeys).toHaveLength(1);
      expect(stats.nonceStats).toHaveProperty(walletResult.address.toLowerCase());
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

  describe('getPublicKeyFromMnemonic', () => {
    it('devrait retourner la clé publique pour un index donné', () => {
      const publicKey = walletManager.getPublicKeyFromMnemonic(testMnemonic, 0);
      expect(publicKey).toBe(mockWallet.publicKey);
    });
  });
});
