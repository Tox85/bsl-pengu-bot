import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WalletManager } from '../../src/core/wallet-manager.js';
import { StateManager } from '../../src/orchestrator/state.js';
import { EthersMockFactory } from '../fixtures/mocks/ethers.hub.js';

// Mock des modules externes
vi.mock('../../src/core/rpc.js', () => ({
  getProvider: vi.fn().mockReturnValue(EthersMockFactory.createProviderMock()),
}));

describe('Resume Functionality', () => {
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

  it('devrait reprendre le flow exactement après l\'étape persistée', async () => {
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const walletIndex = 0;

    // Créer le wallet
    const wallet = await walletManager.createOrLoadWallet(mnemonic, walletIndex, mockProvider);
    const walletAddress = wallet.address;

    // Simuler un crash après l'étape swap
    const state = stateManager.createState(walletAddress);
    
    // Simuler les étapes bridge et swap terminées
    stateManager.saveStateAfterStep(state, 'bridge', {
      hash: '0xbridge123...',
      status: 'success',
      fromAmount: '100000000',
      toAmount: '99900000',
    });
    
    stateManager.saveStateAfterStep(state, 'swap', {
      hash: '0xswap123...',
      status: 'success',
      fromAmount: '99900000',
      toAmount: '99500000',
    });
    
    // Marquer swap comme terminé
    stateManager.markStepCompleted(walletAddress, 'swap');

    // Vérifier l'état avant reprise
    const stateBeforeResume = stateManager.loadState(walletAddress);
    expect(stateBeforeResume?.currentStep).toBe('swap');
    expect(stateBeforeResume?.bridgeResult).toBeDefined();
    expect(stateBeforeResume?.swapResult).toBeDefined();

    // Simuler la reprise du flow
    const resumeFlow = async () => {
      const currentState = stateManager.loadState(walletAddress);
      if (!currentState) {
        throw new Error('État non trouvé');
      }

      const steps = [];
      const results = {};

      // Vérifier si bridge est terminé
      if (currentState.currentStep === 'swap' || currentState.currentStep === 'lp' || currentState.currentStep === 'collect_done') {
        steps.push('bridge');
        results.bridge = currentState.bridgeResult;
      }

      // Vérifier si swap est terminé
      if (currentState.currentStep === 'lp' || currentState.currentStep === 'collect_done') {
        steps.push('swap');
        results.swap = currentState.swapResult;
      }

      // Continuer à partir de l'étape LP
      if (currentState.currentStep === 'swap') {
        // Simuler LP
        const lpResult = {
          hash: '0xlp123...',
          status: 'success',
          tokenId: 'token123',
          amount0: '49750000',
          amount1: '49750000',
        };
        
        stateManager.saveStateAfterStep(currentState, 'lp', lpResult);
        steps.push('lp');
        results.lp = lpResult;

        // Simuler Collect
        const collectResult = {
          hash: '0xcollect123...',
          status: 'success',
          amount0: '1000000',
          amount1: '1000000',
        };
        
        stateManager.saveStateAfterStep(currentState, 'collect', collectResult);
        stateManager.markStepCompleted(walletAddress, 'collect_done');
        steps.push('collect');
        results.collect = collectResult;
      }

      return {
        wallet: walletAddress,
        status: 'success',
        steps,
        results,
        resumed: true,
      };
    };

    const result = await resumeFlow();

    // Vérifications
    expect(result.status).toBe('success');
    expect(result.resumed).toBe(true);
    expect(result.steps).toEqual(['bridge', 'swap', 'lp', 'collect']);
    expect(result.results).toHaveProperty('bridge');
    expect(result.results).toHaveProperty('swap');
    expect(result.results).toHaveProperty('lp');
    expect(result.results).toHaveProperty('collect');

    // Vérifier que l'état final est correct
    const finalState = stateManager.loadState(walletAddress);
    expect(finalState?.currentStep).toBe('collect_done');
    expect(finalState?.bridgeResult).toBeDefined();
    expect(finalState?.swapResult).toBeDefined();
    expect(finalState?.lpResult).toBeDefined();
    expect(finalState?.collectResult).toBeDefined();
  });

  it('devrait reprendre à partir de l\'étape LP si crash après LP', async () => {
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const walletIndex = 0;

    // Créer le wallet
    const wallet = await walletManager.createOrLoadWallet(mnemonic, walletIndex, mockProvider);
    const walletAddress = wallet.address;

    // Simuler un crash après l'étape LP
    const state = stateManager.createState(walletAddress);
    
    // Simuler les étapes bridge, swap et LP terminées
    stateManager.saveStateAfterStep(state, 'bridge', {
      hash: '0xbridge123...',
      status: 'success',
    });
    
    stateManager.saveStateAfterStep(state, 'swap', {
      hash: '0xswap123...',
      status: 'success',
    });
    
    stateManager.saveStateAfterStep(state, 'lp', {
      hash: '0xlp123...',
      status: 'success',
      tokenId: 'token123',
    });
    
    // Marquer LP comme terminé
    stateManager.markStepCompleted(walletAddress, 'lp');

    // Vérifier l'état avant reprise
    const stateBeforeResume = stateManager.loadState(walletAddress);
    expect(stateBeforeResume?.currentStep).toBe('lp');

    // Simuler la reprise du flow
    const resumeFlow = async () => {
      const currentState = stateManager.loadState(walletAddress);
      if (!currentState) {
        throw new Error('État non trouvé');
      }

      const steps = [];
      const results = {};

      // Vérifier les étapes terminées
      if (currentState.bridgeResult) {
        steps.push('bridge');
        results.bridge = currentState.bridgeResult;
      }
      if (currentState.swapResult) {
        steps.push('swap');
        results.swap = currentState.swapResult;
      }
      if (currentState.lpResult) {
        steps.push('lp');
        results.lp = currentState.lpResult;
      }

      // Continuer à partir de l'étape Collect
      if (currentState.currentStep === 'lp') {
        // Simuler Collect
        const collectResult = {
          hash: '0xcollect123...',
          status: 'success',
          amount0: '1000000',
          amount1: '1000000',
        };
        
        stateManager.saveStateAfterStep(currentState, 'collect', collectResult);
        stateManager.markStepCompleted(walletAddress, 'collect_done');
        steps.push('collect');
        results.collect = collectResult;
      }

      return {
        wallet: walletAddress,
        status: 'success',
        steps,
        results,
        resumed: true,
      };
    };

    const result = await resumeFlow();

    // Vérifications
    expect(result.status).toBe('success');
    expect(result.resumed).toBe(true);
    expect(result.steps).toEqual(['bridge', 'swap', 'lp', 'collect']);
    expect(result.results).toHaveProperty('bridge');
    expect(result.results).toHaveProperty('swap');
    expect(result.results).toHaveProperty('lp');
    expect(result.results).toHaveProperty('collect');

    // Vérifier que l'état final est correct
    const finalState = stateManager.loadState(walletAddress);
    expect(finalState?.currentStep).toBe('collect_done');
  });

  it('devrait gérer le mode --fresh en réinitialisant l\'état', async () => {
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const walletIndex = 0;

    // Créer le wallet
    const wallet = await walletManager.createOrLoadWallet(mnemonic, walletIndex, mockProvider);
    const walletAddress = wallet.address;

    // Simuler un état existant
    const state = stateManager.createState(walletAddress);
    stateManager.saveStateAfterStep(state, 'bridge', {
      hash: '0xbridge123...',
      status: 'success',
    });
    stateManager.markStepCompleted(walletAddress, 'bridge');

    // Vérifier l'état existant
    const existingState = stateManager.loadState(walletAddress);
    expect(existingState?.currentStep).toBe('bridge');
    expect(existingState?.bridgeResult).toBeDefined();

    // Simuler le mode --fresh
    const freshFlow = async () => {
      // Supprimer l'état existant
      stateManager.deleteState(walletAddress);
      
      // Créer un nouvel état
      const newState = stateManager.createState(walletAddress);
      
      // Simuler le flow complet
      const bridgeResult = {
        hash: '0xbridge456...',
        status: 'success',
        fromAmount: '100000000',
        toAmount: '99900000',
      };
      
      stateManager.saveStateAfterStep(newState, 'bridge', bridgeResult);
      stateManager.markStepCompleted(walletAddress, 'bridge');

      const swapResult = {
        hash: '0xswap456...',
        status: 'success',
        fromAmount: '99900000',
        toAmount: '99500000',
      };
      
      stateManager.saveStateAfterStep(newState, 'swap', swapResult);
      stateManager.markStepCompleted(walletAddress, 'swap');

      const lpResult = {
        hash: '0xlp456...',
        status: 'success',
        tokenId: 'token456',
        amount0: '49750000',
        amount1: '49750000',
      };
      
      stateManager.saveStateAfterStep(newState, 'lp', lpResult);
      stateManager.markStepCompleted(walletAddress, 'lp');

      const collectResult = {
        hash: '0xcollect456...',
        status: 'success',
        amount0: '1000000',
        amount1: '1000000',
      };
      
      stateManager.saveStateAfterStep(newState, 'collect', collectResult);
      stateManager.markStepCompleted(walletAddress, 'collect_done');

      return {
        wallet: walletAddress,
        status: 'success',
        steps: ['bridge', 'swap', 'lp', 'collect'],
        results: {
          bridge: bridgeResult,
          swap: swapResult,
          lp: lpResult,
          collect: collectResult,
        },
        fresh: true,
      };
    };

    const result = await freshFlow();

    // Vérifications
    expect(result.status).toBe('success');
    expect(result.fresh).toBe(true);
    expect(result.steps).toEqual(['bridge', 'swap', 'lp', 'collect']);

    // Vérifier que l'état final est correct
    const finalState = stateManager.loadState(walletAddress);
    expect(finalState?.currentStep).toBe('collect_done');
    expect(finalState?.bridgeResult?.hash).toBe('0xbridge456...');
    expect(finalState?.swapResult?.hash).toBe('0xswap456...');
    expect(finalState?.lpResult?.hash).toBe('0xlp456...');
    expect(finalState?.collectResult?.hash).toBe('0xcollect456...');
  });

  it('devrait gérer les états corrompus', async () => {
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const walletIndex = 0;

    // Créer le wallet
    const wallet = await walletManager.createOrLoadWallet(mnemonic, walletIndex, mockProvider);
    const walletAddress = wallet.address;

    // Simuler un état corrompu
    const corruptedState = {
      wallet: walletAddress,
      currentStep: 'bridge',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      // Manque des champs requis
    };

    // Sauvegarder l'état corrompu
    stateManager.saveState(corruptedState as any);

    // Vérifier que l'état est corrompu
    const stateBeforeCleanup = stateManager.loadState(walletAddress);
    expect(stateBeforeCleanup).toBeDefined();

    // Nettoyer les états corrompus
    const cleanedCount = stateManager.cleanupCorruptedStates();
    expect(cleanedCount).toBe(1);

    // Vérifier que l'état corrompu a été supprimé
    const stateAfterCleanup = stateManager.loadState(walletAddress);
    expect(stateAfterCleanup).toBeNull();
  });
});
