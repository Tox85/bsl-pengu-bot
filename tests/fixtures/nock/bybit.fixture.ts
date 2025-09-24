import nock from 'nock';

/**
 * Fixtures HTTP pour les tests Bybit
 */
export class BybitFixtures {
  private baseUrl = 'https://api.bybit.com';

  /**
   * Mock retrait réussi
   */
  mockWithdrawSuccess(): void {
    nock(this.baseUrl)
      .post('/v5/asset/withdraw/create')
      .reply(200, {
        retCode: 0,
        retMsg: 'OK',
        result: {
          id: 'withdrawal-123',
          status: 'success',
          amount: '100.00000000',
          fee: '0.10000000',
          coin: 'USDC',
          address: '0x742d35Cc6634C0532925a3b8D1B2b3b4C5D6E7F8',
          txId: '0xabc123...',
          timestamp: Date.now(),
        },
      });
  }

  /**
   * Mock retrait échec - solde insuffisant
   */
  mockWithdrawInsufficientBalance(): void {
    nock(this.baseUrl)
      .post('/v5/asset/withdraw/create')
      .reply(200, {
        retCode: 10001,
        retMsg: 'Insufficient balance',
        result: null,
      });
  }

  /**
   * Mock retrait échec - montant minimum
   */
  mockWithdrawMinimumAmount(): void {
    nock(this.baseUrl)
      .post('/v5/asset/withdraw/create')
      .reply(200, {
        retCode: 10002,
        retMsg: 'Amount too small',
        result: null,
      });
  }

  /**
   * Mock retrait échec - adresse non whitelistée
   */
  mockWithdrawAddressNotWhitelisted(): void {
    nock(this.baseUrl)
      .post('/v5/asset/withdraw/create')
      .reply(200, {
        retCode: 10003,
        retMsg: 'Address not whitelisted',
        result: null,
      });
  }

  /**
   * Mock rate limit puis succès
   */
  mockWithdrawRateLimitThenSuccess(): void {
    nock(this.baseUrl)
      .post('/v5/asset/withdraw/create')
      .reply(429, {
        retCode: 10004,
        retMsg: 'Rate limit exceeded',
        result: null,
      })
      .post('/v5/asset/withdraw/create')
      .reply(200, {
        retCode: 0,
        retMsg: 'OK',
        result: {
          id: 'withdrawal-456',
          status: 'success',
          amount: '100.00000000',
          fee: '0.10000000',
          coin: 'USDC',
          address: '0x742d35Cc6634C0532925a3b8D1B2b3b4C5D6E7F8',
          txId: '0xdef456...',
          timestamp: Date.now(),
        },
      });
  }

  /**
   * Mock timeout de retrait
   */
  mockWithdrawTimeout(): void {
    nock(this.baseUrl)
      .post('/v5/asset/withdraw/create')
      .delay(30000) // 30 secondes de délai
      .reply(200, {
        retCode: 0,
        retMsg: 'OK',
        result: {
          id: 'withdrawal-timeout',
          status: 'pending',
          amount: '100.00000000',
          fee: '0.10000000',
          coin: 'USDC',
          address: '0x742d35Cc6634C0532925a3b8D1B2b3b4C5D6E7F8',
          txId: null,
          timestamp: Date.now(),
        },
      });
  }

  /**
   * Mock vérification de solde
   */
  mockGetBalance(balance: number = 1000): void {
    nock(this.baseUrl)
      .get('/v5/asset/transfer/query-account-coins-balance')
      .query({ accountType: 'UNIFIED' })
      .reply(200, {
        retCode: 0,
        retMsg: 'OK',
        result: {
          accountType: 'UNIFIED',
          balances: [
            {
              coin: 'USDC',
              walletBalance: balance.toString(),
              transferBalance: balance.toString(),
              bonus: '0',
            },
          ],
        },
      });
  }

  /**
   * Mock vérification des frais de retrait
   */
  mockGetWithdrawalFees(fee: number = 0.1): void {
    nock(this.baseUrl)
      .get('/v5/asset/coin/query-info')
      .query({ coin: 'USDC' })
      .reply(200, {
        retCode: 0,
        retMsg: 'OK',
        result: {
          rows: [
            {
              name: 'USDC',
              coin: 'USDC',
              remainAmount: '1000000.00000000',
              chains: [
                {
                  chainType: 'ETH',
                  chain: 'ETH',
                  chainDeposit: '1',
                  chainWithdraw: '1',
                  withdrawFee: fee.toString(),
                  minWithdraw: '10.00000000',
                  maxWithdraw: '100000.00000000',
                },
              ],
            },
          ],
        },
      });
  }

  /**
   * Mock vérification du statut de retrait
   */
  mockGetWithdrawalStatus(status: 'pending' | 'success' | 'failed' = 'success'): void {
    nock(this.baseUrl)
      .get('/v5/asset/withdraw/query-record')
      .query({ id: 'withdrawal-123' })
      .reply(200, {
        retCode: 0,
        retMsg: 'OK',
        result: {
          rows: [
            {
              id: 'withdrawal-123',
              status,
              amount: '100.00000000',
              fee: '0.10000000',
              coin: 'USDC',
              address: '0x742d35Cc6634C0532925a3b8D1B2b3b4C5D6E7F8',
              txId: status === 'success' ? '0xabc123...' : null,
              timestamp: Date.now(),
            },
          ],
        },
      });
  }

  /**
   * Nettoyer tous les mocks
   */
  cleanup(): void {
    nock.cleanAll();
  }

  /**
   * Vérifier que tous les mocks ont été utilisés
   */
  isDone(): boolean {
    return nock.isDone();
  }

  /**
   * Obtenir les mocks en attente
   */
  pendingMocks(): string[] {
    return nock.pendingMocks();
  }
}
