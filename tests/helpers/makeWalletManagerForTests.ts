import { WalletManager } from '../../src/core/wallet-manager.js';

export function makeWalletManagerForTests() {
  const provider = (globalThis as any).__TEST_HELPERS__.makeProviderMock();
  return new WalletManager({ getProvider: () => provider });
}

