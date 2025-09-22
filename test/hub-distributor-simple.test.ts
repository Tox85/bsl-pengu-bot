import { describe, it, expect, vi } from 'vitest';

// Mock simple d'ethers
vi.mock('ethers', async () => {
  const actual = await vi.importActual('ethers');
  const mockWallet = {
    address: '0x742d35Cc6634C0532925a3b8D1B2b3b4C5D6E7F8',
    privateKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    getBalance: vi.fn().mockResolvedValue(ethers.parseEther('1.0')),
    sendTransaction: vi.fn().mockResolvedValue({ wait: vi.fn().mockResolvedValue({}) }),
  };
  
  return {
    ...actual,
    Wallet: vi.fn().mockImplementation(() => mockWallet),
    Contract: vi.fn().mockImplementation(() => ({
      balanceOf: vi.fn().mockResolvedValue(ethers.parseUnits('1000', 6)),
      transfer: vi.fn().mockResolvedValue({ wait: vi.fn().mockResolvedValue({}) }),
    })),
    parseEther: vi.fn((value) => BigInt(value) * BigInt(10**18)),
    parseUnits: vi.fn((value, decimals) => BigInt(value) * BigInt(10**decimals)),
  };
});

// Mock du WalletManager
vi.mock('../src/core/wallet-manager.js', () => ({
  WalletManager: vi.fn().mockImplementation(() => ({
    getWallets: vi.fn().mockReturnValue([
      { address: '0x123', index: 0 },
      { address: '0x456', index: 1 },
    ]),
  })),
}));

// Mock du BybitAdapter
vi.mock('../src/cex/bybit-adapter.js', () => ({
  BybitAdapter: vi.fn().mockImplementation(() => ({
    getBalance: vi.fn().mockResolvedValue(1000),
    withdraw: vi.fn().mockResolvedValue({ success: true, withdrawalId: 'test-123' }),
  })),
}));

// Mock du module rpc
vi.mock('../src/core/rpc.js', () => ({
  getProvider: vi.fn(() => ({
    getBalance: vi.fn().mockResolvedValue(ethers.parseEther('1.0')),
  })),
}));

// Mock du module logger
vi.mock('../src/core/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import { ethers } from 'ethers';
import { HubDistributor } from '../src/cex/hub-distributor.js';

describe('HubDistributor - Tests Simples', () => {
  const config = {
    distributionConfig: {
      bybit: {
        apiKey: 'test-api-key',
        apiSecret: 'test-api-secret',
        sandbox: false,
        testnet: false,
      },
      hubWalletPrivateKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      tokens: {
        usdc: {
          amountPerWallet: 10.0,
          totalAmount: 1000.0,
        },
        eth: {
          amountPerWallet: 0.01,
          totalAmount: 0.1,
        },
      },
      walletCount: 10,
      randomizeAmounts: true,
      batchSize: 5,
      chainId: 8453,
    },
  };

  it('devrait créer une instance HubDistributor', () => {
    const distributor = new HubDistributor(config);
    expect(distributor).toBeDefined();
  });

  it('devrait calculer les montants de distribution', () => {
    const distributor = new HubDistributor(config);
    
    // Test de la méthode computeRandomParts
    const amounts = distributor.computeRandomParts(100, 5, 10);
    
    expect(amounts).toHaveLength(5);
    expect(amounts.reduce((sum, amount) => sum + amount, 0)).toBe(100);
    expect(amounts.every(amount => amount >= 10)).toBe(true);
  });

  it('devrait gérer les montants insuffisants', () => {
    const distributor = new HubDistributor(config);
    
    expect(() => {
      distributor.computeRandomParts(30, 5, 10); // 5 * 10 = 50 > 30
    }).toThrow('Impossible de répartir');
  });

  it('devrait effectuer un dry-run de distribution', async () => {
    const distributor = new HubDistributor(config);
    
    // Mock des wallets
    const wallets = [
      { address: '0x123', index: 0 },
      { address: '0x456', index: 1 },
    ];
    
    const result = await distributor.dryRunDistribution(wallets);
    
    expect(result).toBeDefined();
    expect(result.totalUsdc).toBe(1000);
    expect(result.totalEth).toBe(0.1);
    expect(result.walletCount).toBe(2);
  });
});
