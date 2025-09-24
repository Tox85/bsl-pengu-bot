import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WalletManager } from '../../src/core/wallet-manager.js';
import { StateManager } from '../../src/orchestrator/state.js';
import { EthersMockFactory } from '../fixtures/mocks/ethers.hub.js';

// Mock des modules externes
vi.mock('../../src/core/rpc.js', () => ({
  getProvider: vi.fn().mockReturnValue(EthersMockFactory.createProviderMock()),
}));

describe('Concurrency and Idempotence', () => {
  let walletManager: WalletManager;
  let stateManager: StateManager;
  let mockProvider: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockProvider = EthersMockFactory.createProviderMock();
    
    walletManager = new WalletManager(mockProvider);
    stateManager = new StateManager('.test-state');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('devrait maintenir l\'idempotence lors d\'exécutions simultanées du même wallet', async () => {
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const walletIndex = 0;

    // Créer le wallet
    const wallet = await walletManager.createOrLoadWallet(mnemonic, walletIndex, mockProvider);
    const walletAddress = wallet.address;

    // Simuler le flow complet
    const executeFlow = async (executionId: string) => {
      const startTime = Date.now();
      
      try {
        // Vérifier si le flow est déjà en cours ou terminé
        const existingState = stateManager.loadState(walletAddress);
        if (existingState?.currentStep === 'collect_done') {
          return {
            executionId,
            status: 'already_completed',
            duration: Date.now() - startTime,
            steps: [],
          };
        }

        if (existingState?.currentStep === 'in_progress') {
          return {
            executionId,
            status: 'already_in_progress',
            duration: Date.now() - startTime,
            steps: [],
          };
        }

        // Marquer comme en cours
        const state = stateManager.createState(walletAddress);
        stateManager.markStepCompleted(walletAddress, 'in_progress');

        // Simuler les étapes
        const steps = [];
        
        // Bridge
        await new Promise(resolve => setTimeout(resolve, 100));
        const bridgeResult = {
          hash: `0xbridge${executionId}...`,
          status: 'success',
          fromAmount: '100000000',
          toAmount: '99900000',
        };
        stateManager.saveStateAfterStep(state, 'bridge', bridgeResult);
        steps.push('bridge');

        // Swap
        await new Promise(resolve => setTimeout(resolve, 150));
        const swapResult = {
          hash: `0xswap${executionId}...`,
          status: 'success',
          fromAmount: '99900000',
          toAmount: '99500000',
        };
        stateManager.saveStateAfterStep(state, 'swap', swapResult);
        steps.push('swap');

        // LP
        await new Promise(resolve => setTimeout(resolve, 200));
        const lpResult = {
          hash: `0xlp${executionId}...`,
          status: 'success',
          tokenId: `token${executionId}`,
          amount0: '49750000',
          amount1: '49750000',
        };
        stateManager.saveStateAfterStep(state, 'lp', lpResult);
        steps.push('lp');

        // Collect
        await new Promise(resolve => setTimeout(resolve, 100));
        const collectResult = {
          hash: `0xcollect${executionId}...`,
          status: 'success',
          amount0: '1000000',
          amount1: '1000000',
        };
        stateManager.saveStateAfterStep(state, 'collect', collectResult);
        stateManager.markStepCompleted(walletAddress, 'collect_done');
        steps.push('collect');

        return {
          executionId,
          status: 'completed',
          duration: Date.now() - startTime,
          steps,
          results: {
            bridge: bridgeResult,
            swap: swapResult,
            lp: lpResult,
            collect: collectResult,
          },
        };
      } catch (error) {
        stateManager.markStepCompleted(walletAddress, 'error');
        return {
          executionId,
          status: 'failed',
          duration: Date.now() - startTime,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    };

    // Exécuter le flow simultanément 3 fois
    const executions = await Promise.all([
      executeFlow('exec1'),
      executeFlow('exec2'),
      executeFlow('exec3'),
    ]);

    // Vérifications
    expect(executions).toHaveLength(3);

    // Un seul devrait être complété, les autres devraient être idempotents
    const completedExecutions = executions.filter(e => e.status === 'completed');
    const alreadyCompletedExecutions = executions.filter(e => e.status === 'already_completed');
    const alreadyInProgressExecutions = executions.filter(e => e.status === 'already_in_progress');

    expect(completedExecutions).toHaveLength(1);
    expect(alreadyCompletedExecutions).toHaveLength(2);

    // Vérifier que l'état final est correct
    const finalState = stateManager.loadState(walletAddress);
    expect(finalState?.currentStep).toBe('collect_done');
    expect(finalState?.bridgeResult).toBeDefined();
    expect(finalState?.swapResult).toBeDefined();
    expect(finalState?.lpResult).toBeDefined();
    expect(finalState?.collectResult).toBeDefined();

    // Vérifier que les exécutions idempotentes sont plus rapides
    const completedExecution = completedExecutions[0];
    const idempotentExecutions = [...alreadyCompletedExecutions, ...alreadyInProgressExecutions];
    
    for (const idempotentExecution of idempotentExecutions) {
      expect(idempotentExecution.duration).toBeLessThan(completedExecution.duration);
    }
  });

  it('devrait gérer les nonces correctement en concurrence', async () => {
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const walletIndex = 0;

    // Créer le wallet
    const wallet = await walletManager.createOrLoadWallet(mnemonic, walletIndex, mockProvider);
    const walletAddress = wallet.address;

    // Simuler des transactions simultanées
    const executeTransaction = async (transactionId: string) => {
      const startTime = Date.now();
      
      try {
        // Obtenir un nonce
        const nonce = await walletManager.getNonce(walletAddress);
        
        // Simuler une transaction
        await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 100));
        
        // Marquer le nonce comme utilisé
        walletManager.markNonceUsed(walletAddress, nonce);
        
        return {
          transactionId,
          nonce,
          duration: Date.now() - startTime,
          status: 'success',
        };
      } catch (error) {
        return {
          transactionId,
          status: 'failed',
          duration: Date.now() - startTime,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    };

    // Exécuter 10 transactions simultanément
    const transactions = await Promise.all(
      Array.from({ length: 10 }, (_, index) => executeTransaction(`tx${index}`))
    );

    // Vérifications
    expect(transactions).toHaveLength(10);

    const successfulTransactions = transactions.filter(t => t.status === 'success');
    const failedTransactions = transactions.filter(t => t.status === 'failed');

    expect(successfulTransactions).toHaveLength(10);
    expect(failedTransactions).toHaveLength(0);

    // Vérifier que tous les nonces sont uniques
    const nonces = successfulTransactions.map(t => t.nonce);
    const uniqueNonces = new Set(nonces);
    expect(uniqueNonces.size).toBe(nonces.length);

    // Vérifier que les nonces sont séquentiels
    const sortedNonces = nonces.sort((a, b) => a - b);
    for (let i = 0; i < sortedNonces.length - 1; i++) {
      expect(sortedNonces[i + 1] - sortedNonces[i]).toBe(1);
    }
  });

  it('devrait gérer les échecs de nonce et les réutiliser', async () => {
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const walletIndex = 0;

    // Créer le wallet
    const wallet = await walletManager.createOrLoadWallet(mnemonic, walletIndex, mockProvider);
    const walletAddress = wallet.address;

    // Simuler des transactions avec échecs
    const executeTransactionWithFailure = async (transactionId: string, shouldFail: boolean) => {
      const startTime = Date.now();
      
      try {
        // Obtenir un nonce
        const nonce = await walletManager.getNonce(walletAddress);
        
        // Simuler une transaction
        await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 100));
        
        if (shouldFail) {
          // Marquer le nonce comme échoué
          walletManager.markNonceFailed(walletAddress, nonce);
          throw new Error('Transaction failed');
        }
        
        // Marquer le nonce comme utilisé
        walletManager.markNonceUsed(walletAddress, nonce);
        
        return {
          transactionId,
          nonce,
          duration: Date.now() - startTime,
          status: 'success',
        };
      } catch (error) {
        return {
          transactionId,
          status: 'failed',
          duration: Date.now() - startTime,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    };

    // Exécuter des transactions avec quelques échecs
    const transactions = await Promise.all([
      executeTransactionWithFailure('tx1', false),
      executeTransactionWithFailure('tx2', true), // Échec
      executeTransactionWithFailure('tx3', false),
      executeTransactionWithFailure('tx4', true), // Échec
      executeTransactionWithFailure('tx5', false),
    ]);

    // Vérifications
    expect(transactions).toHaveLength(5);

    const successfulTransactions = transactions.filter(t => t.status === 'success');
    const failedTransactions = transactions.filter(t => t.status === 'failed');

    expect(successfulTransactions).toHaveLength(3);
    expect(failedTransactions).toHaveLength(2);

    // Vérifier que les nonces sont corrects
    const nonces = successfulTransactions.map(t => t.nonce);
    const uniqueNonces = new Set(nonces);
    expect(uniqueNonces.size).toBe(nonces.length);

    // Vérifier que les nonces sont séquentiels
    const sortedNonces = nonces.sort((a, b) => a - b);
    for (let i = 0; i < sortedNonces.length - 1; i++) {
      expect(sortedNonces[i + 1] - sortedNonces[i]).toBe(1);
    }
  });

  it('devrait maintenir l\'isolation entre différents wallets', async () => {
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const walletCount = 3;

    // Créer les wallets
    const wallets = await Promise.all(
      Array.from({ length: walletCount }, (_, index) =>
        walletManager.createOrLoadWallet(mnemonic, index, mockProvider)
      )
    );

    // Simuler des transactions simultanées pour chaque wallet
    const executeTransactionsForWallet = async (wallet: any, walletIndex: number) => {
      const transactions = [];
      
      for (let i = 0; i < 5; i++) {
        const nonce = await walletManager.getNonce(wallet.address);
        
        // Simuler une transaction
        await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 100));
        
        walletManager.markNonceUsed(wallet.address, nonce);
        
        transactions.push({
          wallet: wallet.address,
          walletIndex,
          nonce,
          transactionId: `wallet${walletIndex}_tx${i}`,
        });
      }
      
      return transactions;
    };

    // Exécuter les transactions pour tous les wallets simultanément
    const allTransactions = await Promise.all(
      wallets.map((wallet, index) => executeTransactionsForWallet(wallet, index))
    );

    // Aplatir les résultats
    const flatTransactions = allTransactions.flat();

    // Vérifications
    expect(flatTransactions).toHaveLength(walletCount * 5);

    // Vérifier que chaque wallet a ses propres nonces séquentiels
    for (const wallet of wallets) {
      const walletTransactions = flatTransactions.filter(t => t.wallet === wallet.address);
      expect(walletTransactions).toHaveLength(5);

      const nonces = walletTransactions.map(t => t.nonce).sort((a, b) => a - b);
      for (let i = 0; i < nonces.length - 1; i++) {
        expect(nonces[i + 1] - nonces[i]).toBe(1);
      }
    }

    // Vérifier que les nonces sont différents entre les wallets
    const allNonces = flatTransactions.map(t => t.nonce);
    const uniqueNonces = new Set(allNonces);
    expect(uniqueNonces.size).toBe(allNonces.length);
  });
});
