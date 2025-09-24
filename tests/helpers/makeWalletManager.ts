import { WalletManager, WalletDeps } from '../../src/core/wallet-manager.js';

export function makeWalletManagerForTests(mockProvider: any): WalletManager {
  const deps: WalletDeps = {
    getProvider: () => mockProvider,
  };
  return new WalletManager(deps);
}

