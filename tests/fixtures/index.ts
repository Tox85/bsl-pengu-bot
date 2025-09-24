import { BybitFixtures } from './nock/bybit.fixture.js';
import { BridgeFixtures } from './nock/bridge.fixture.js';
import { EthersMockFactory } from './mocks/ethers.hub.js';

/**
 * Factory pour créer des instances de fixtures
 */
export class FixtureFactory {
  private bybitFixtures: BybitFixtures;
  private bridgeFixtures: BridgeFixtures;
  private ethersMockFactory: EthersMockFactory;

  constructor() {
    this.bybitFixtures = new BybitFixtures();
    this.bridgeFixtures = new BridgeFixtures();
    this.ethersMockFactory = new EthersMockFactory();
  }

  /**
   * Obtenir les fixtures Bybit
   */
  getBybit(): BybitFixtures {
    return this.bybitFixtures;
  }

  /**
   * Obtenir les fixtures Bridge
   */
  getBridge(): BridgeFixtures {
    return this.bridgeFixtures;
  }

  /**
   * Obtenir le factory ethers
   */
  getEthers(): EthersMockFactory {
    return this.ethersMockFactory;
  }

  /**
   * Nettoyer toutes les fixtures
   */
  cleanup(): void {
    this.bybitFixtures.cleanup();
    this.bridgeFixtures.cleanup();
  }
}

// Instance singleton
export const fixtures = new FixtureFactory();

// Fonctions de convenance pour les tests
export function setupBybitSuccess(): void {
  fixtures.getBybit().mockWithdrawSuccess();
  fixtures.getBybit().mockGetBalance(1000);
}

export function setupBybitInsufficientFunds(): void {
  fixtures.getBybit().mockWithdrawInsufficientBalance();
  fixtures.getBybit().mockGetBalance(0);
}

export function setupBybitRateLimit(): void {
  fixtures.getBybit().mockWithdrawRateLimitThenSuccess();
  fixtures.getBybit().mockGetBalance(1000);
}

export function setupBybitPending(): void {
  fixtures.getBybit().mockWithdrawSuccess();
  fixtures.getBybit().mockGetWithdrawalStatus('pending');
  fixtures.getBybit().mockGetBalance(1000);
}

export function setupBybitTimeout(): void {
  fixtures.getBybit().mockWithdrawTimeout();
  fixtures.getBybit().mockGetBalance(1000);
}

export function setupBridgeSuccess(): void {
  fixtures.getBridge().mockRouteFound();
  fixtures.getBridge().mockExecuteBridge();
  fixtures.getBridge().mockBridgeStatusSuccess();
}

export function setupBridgeTimeout(): void {
  fixtures.getBridge().mockRouteFound();
  fixtures.getBridge().mockExecuteBridge();
  fixtures.getBridge().mockBridgeTimeout();
}

export function setupBridgeFailed(): void {
  fixtures.getBridge().mockRouteFound();
  fixtures.getBridge().mockExecuteBridge();
  fixtures.getBridge().mockBridgeStatusFailed();
}

export function setupBridgeNoRoute(): void {
  fixtures.getBridge().mockRouteNotFound();
}

export function setupHubSuccess(): any {
  return fixtures.getEthers().createHubDistributorMock({
    distribute: { success: true, txHash: '0xhub123...' },
    collect: { success: true, txHash: '0xcollect123...' },
    getBalance: '1000000000000000000' // 1 ETH
  });
}

export function setupHubInsufficientFunds(): any {
  return fixtures.getEthers().createHubDistributorMock({
    distribute: { success: false, error: 'INSUFFICIENT_FUNDS' },
    collect: { success: true, txHash: '0xcollect123...' },
    getBalance: '0'
  });
}

export function setupHubCollectRevert(): any {
  return fixtures.getEthers().createHubDistributorMock({
    distribute: { success: true, txHash: '0xhub123...' },
    collect: { success: false, error: 'COLLECT_REVERT' },
    getBalance: '1000000000000000000'
  });
}

