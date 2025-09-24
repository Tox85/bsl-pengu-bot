import { getProvider } from './core/rpc.js';
import { WalletManager, WalletDeps } from './core/wallet-manager.js';

// Dépendances pour la production
export const walletDeps: WalletDeps = {
  getProvider,
};

// Instance de WalletManager pour la production
export const walletManager = new WalletManager(walletDeps);

