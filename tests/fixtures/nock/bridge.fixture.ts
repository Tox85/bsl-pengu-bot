import nock from 'nock';

/**
 * Fixtures HTTP pour les tests de bridge (Li.Fi/Jumper)
 */
export class BridgeFixtures {
  private baseUrl = 'https://li.quest';

  /**
   * Mock route de bridge trouvée
   */
  mockRouteFound(): void {
    nock(this.baseUrl)
      .get('/v1/quote')
      .query({
        fromChain: '8453', // Base
        toChain: '11124', // Abstract
        fromToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC Base
        toToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC Abstract
        fromAmount: '100000000', // 100 USDC
        fromAddress: '0x742d35Cc6634C0532925a3b8D1B2b3b4C5D6E7F8',
        toAddress: '0x742d35Cc6634C0532925a3b8D1B2b3b4C5D6E7F8',
      })
      .reply(200, {
        id: 'route-123',
        fromChainId: 8453,
        toChainId: 11124,
        fromToken: {
          address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          symbol: 'USDC',
          decimals: 6,
        },
        toToken: {
          address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          symbol: 'USDC',
          decimals: 6,
        },
        fromAmount: '100000000',
        toAmount: '99900000', // 99.9 USDC après frais
        gasCosts: [
          {
            type: 'SEND',
            price: '20000000000',
            amount: '21000',
            gasPrice: '20000000000',
            maxFeePerGas: '20000000000',
            maxPriorityFeePerGas: '2000000000',
          },
        ],
        steps: [
          {
            id: 'step-1',
            type: 'cross',
            tool: 'jumper',
            action: {
              fromChainId: 8453,
              toChainId: 11124,
              fromToken: {
                address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
                symbol: 'USDC',
                decimals: 6,
              },
              toToken: {
                address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
                symbol: 'USDC',
                decimals: 6,
              },
              fromAmount: '100000000',
              toAmount: '99900000',
            },
            estimate: {
              fromAmount: '100000000',
              toAmount: '99900000',
              feeCosts: [
                {
                  name: 'Jumper Fee',
                  amount: '1000000', // 1 USDC
                  token: {
                    address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
                    symbol: 'USDC',
                    decimals: 6,
                  },
                },
              ],
              gasCosts: [
                {
                  type: 'SEND',
                  price: '20000000000',
                  amount: '21000',
                  gasPrice: '20000000000',
                  maxFeePerGas: '20000000000',
                  maxPriorityFeePerGas: '2000000000',
                },
              ],
            },
            toolDetails: {
              key: 'jumper',
              name: 'Jumper',
              logoURI: 'https://jumper.exchange/logo.png',
            },
          },
        ],
      });
  }

  /**
   * Mock route non trouvée
   */
  mockRouteNotFound(): void {
    nock(this.baseUrl)
      .get('/v1/quote')
      .query(true)
      .reply(200, {
        id: 'route-not-found',
        fromChainId: 8453,
        toChainId: 11124,
        fromToken: {
          address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          symbol: 'USDC',
          decimals: 6,
        },
        toToken: {
          address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          symbol: 'USDC',
          decimals: 6,
        },
        fromAmount: '100000000',
        toAmount: '0',
        gasCosts: [],
        steps: [],
      });
  }

  /**
   * Mock exécution de bridge
   */
  mockExecuteBridge(): void {
    nock(this.baseUrl)
      .post('/v1/route/execution')
      .reply(200, {
        id: 'execution-123',
        status: 'PENDING',
        fromChainId: 8453,
        toChainId: 11124,
        fromAmount: '100000000',
        toAmount: '99900000',
        steps: [
          {
            id: 'step-1',
            type: 'cross',
            tool: 'jumper',
            status: 'PENDING',
            transactionRequest: {
              to: '0x1234567890123456789012345678901234567890',
              data: '0x...',
              value: '0',
              gasLimit: '21000',
              gasPrice: '20000000000',
              maxFeePerGas: '20000000000',
              maxPriorityFeePerGas: '2000000000',
            },
          },
        ],
      });
  }

  /**
   * Mock statut de bridge en attente
   */
  mockBridgeStatusPending(): void {
    nock(this.baseUrl)
      .get('/v1/route/execution/execution-123')
      .reply(200, {
        id: 'execution-123',
        status: 'PENDING',
        fromChainId: 8453,
        toChainId: 11124,
        fromAmount: '100000000',
        toAmount: '99900000',
        steps: [
          {
            id: 'step-1',
            type: 'cross',
            tool: 'jumper',
            status: 'PENDING',
            transactionRequest: {
              to: '0x1234567890123456789012345678901234567890',
              data: '0x...',
              value: '0',
              gasLimit: '21000',
              gasPrice: '20000000000',
              maxFeePerGas: '20000000000',
              maxPriorityFeePerGas: '2000000000',
            },
          },
        ],
      });
  }

  /**
   * Mock statut de bridge réussi
   */
  mockBridgeStatusSuccess(): void {
    nock(this.baseUrl)
      .get('/v1/route/execution/execution-123')
      .reply(200, {
        id: 'execution-123',
        status: 'DONE',
        fromChainId: 8453,
        toChainId: 11124,
        fromAmount: '100000000',
        toAmount: '99900000',
        steps: [
          {
            id: 'step-1',
            type: 'cross',
            tool: 'jumper',
            status: 'DONE',
            transactionRequest: {
              to: '0x1234567890123456789012345678901234567890',
              data: '0x...',
              value: '0',
              gasLimit: '21000',
              gasPrice: '20000000000',
              maxFeePerGas: '20000000000',
              maxPriorityFeePerGas: '2000000000',
            },
            transactionHash: '0xabc123...',
            fromTransactionHash: '0xdef456...',
            toTransactionHash: '0xghi789...',
          },
        ],
      });
  }

  /**
   * Mock statut de bridge échoué
   */
  mockBridgeStatusFailed(): void {
    nock(this.baseUrl)
      .get('/v1/route/execution/execution-123')
      .reply(200, {
        id: 'execution-123',
        status: 'FAILED',
        fromChainId: 8453,
        toChainId: 11124,
        fromAmount: '100000000',
        toAmount: '0',
        steps: [
          {
            id: 'step-1',
            type: 'cross',
            tool: 'jumper',
            status: 'FAILED',
            error: 'Transaction failed',
          },
        ],
      });
  }

  /**
   * Mock timeout de bridge
   */
  mockBridgeTimeout(): void {
    nock(this.baseUrl)
      .get('/v1/route/execution/execution-123')
      .delay(30000) // 30 secondes de délai
      .reply(200, {
        id: 'execution-123',
        status: 'PENDING',
        fromChainId: 8453,
        toChainId: 11124,
        fromAmount: '100000000',
        toAmount: '99900000',
        steps: [
          {
            id: 'step-1',
            type: 'cross',
            tool: 'jumper',
            status: 'PENDING',
          },
        ],
      });
  }

  /**
   * Mock rate limit
   */
  mockRateLimit(): void {
    nock(this.baseUrl)
      .get('/v1/quote')
      .query(true)
      .reply(429, {
        error: 'Rate limit exceeded',
        message: 'Too many requests',
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
