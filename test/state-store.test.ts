import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StateStore, type WalletState } from '../src/core/state-store.js';
import { promises as fs } from 'fs';
import { join } from 'path';

// Mock fs
vi.mock('fs', () => ({
  promises: {
    mkdir: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
  },
}));

describe('StateStore', () => {
  let stateStore: StateStore;
  const mockStateDir = '/tmp/test-state';
  const mockStateFile = join(mockStateDir, 'wallet-state.json');

  beforeEach(() => {
    stateStore = new StateStore(mockStateDir);
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Nettoyer après chaque test
    vi.clearAllMocks();
  });

  describe('initialize', () => {
    it('devrait créer un nouvel état si aucun fichier n\'existe', async () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'));

      await stateStore.initialize();

      expect(fs.mkdir).toHaveBeenCalledWith(mockStateDir, { recursive: true });
      expect(fs.readFile).toHaveBeenCalledWith(mockStateFile, 'utf-8');
    });

    it('devrait charger l\'état existant', async () => {
      const existingState = {
        wallets: {
          '0x123': {
            address: '0x123',
            index: 0,
            lastStep: 'bridge_completed',
            tokenIds: [],
            lastBridgeTx: '0xabc',
            lastSwapTx: null,
            lpParams: null,
            lastCollectAt: null,
            errors: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        },
        lastRunId: 'run-123',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(existingState));

      await stateStore.initialize();

      const walletState = stateStore.getWalletState('0x123');
      expect(walletState).toEqual(existingState.wallets['0x123']);
    });
  });

  describe('updateWalletState', () => {
    beforeEach(async () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      await stateStore.initialize();
    });

    it('devrait créer un nouvel état de wallet', async () => {
      const updates: Partial<WalletState> = {
        address: '0x123',
        index: 0,
        lastStep: 'bridge_completed',
        lastBridgeTx: '0xabc',
      };

      await stateStore.updateWalletState('0x123', updates);

      const walletState = stateStore.getWalletState('0x123');
      expect(walletState).toMatchObject(updates);
      expect(walletState?.createdAt).toBeDefined();
      expect(walletState?.updatedAt).toBeDefined();
    });

    it('devrait mettre à jour un état existant', async () => {
      // Créer l'état initial
      await stateStore.updateWalletState('0x123', {
        address: '0x123',
        index: 0,
        lastStep: 'bridge_completed',
        lastBridgeTx: '0xabc',
      });

      // Mettre à jour
      await stateStore.updateWalletState('0x123', {
        lastStep: 'swap_completed',
        lastSwapTx: '0xdef',
      });

      const walletState = stateStore.getWalletState('0x123');
      expect(walletState?.lastStep).toBe('swap_completed');
      expect(walletState?.lastBridgeTx).toBe('0xabc'); // Préservé
      expect(walletState?.lastSwapTx).toBe('0xdef'); // Mis à jour
    });
  });

  describe('markStepCompleted', () => {
    beforeEach(async () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      await stateStore.initialize();
    });

    it('devrait marquer une étape comme terminée avec hash de transaction', async () => {
      await stateStore.markStepCompleted('0x123', 'bridge_completed', '0xabc');

      const walletState = stateStore.getWalletState('0x123');
      expect(walletState?.lastStep).toBe('bridge_completed');
      expect(walletState?.lastBridgeTx).toBe('0xabc');
    });

    it('devrait marquer le collect comme terminé avec timestamp', async () => {
      await stateStore.markStepCompleted('0x123', 'collect_completed');

      const walletState = stateStore.getWalletState('0x123');
      expect(walletState?.lastStep).toBe('collect_completed');
      expect(walletState?.lastCollectAt).toBeDefined();
      expect(walletState?.lastCollectAt).toBeGreaterThan(0);
    });
  });

  describe('getNextStep', () => {
    beforeEach(async () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      await stateStore.initialize();
    });

    it('devrait retourner "bridge" pour un nouveau wallet', () => {
      const nextStep = stateStore.getNextStep('0x123');
      expect(nextStep).toBe('bridge');
    });

    it('devrait retourner le prochain step basé sur le dernier step', async () => {
      await stateStore.updateWalletState('0x123', {
        address: '0x123',
        index: 0,
        lastStep: 'bridge_completed',
      });

      const nextStep = stateStore.getNextStep('0x123');
      expect(nextStep).toBe('swap');

      await stateStore.updateWalletState('0x123', {
        lastStep: 'swap_completed',
      });

      const nextStep2 = stateStore.getNextStep('0x123');
      expect(nextStep2).toBe('lp');
    });

    it('devrait retourner null pour un wallet terminé', async () => {
      await stateStore.updateWalletState('0x123', {
        address: '0x123',
        index: 0,
        lastStep: 'collect_completed',
      });

      const nextStep = stateStore.getNextStep('0x123');
      expect(nextStep).toBeNull();
    });
  });

  describe('canResumeWallet', () => {
    beforeEach(async () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      await stateStore.initialize();
    });

    it('devrait retourner true pour un wallet en cours', async () => {
      await stateStore.updateWalletState('0x123', {
        address: '0x123',
        index: 0,
        lastStep: 'bridge_completed',
      });

      const canResume = stateStore.canResumeWallet('0x123');
      expect(canResume).toBe(true);
    });

    it('devrait retourner false pour un wallet terminé', async () => {
      await stateStore.updateWalletState('0x123', {
        address: '0x123',
        index: 0,
        lastStep: 'collect_completed',
      });

      const canResume = stateStore.canResumeWallet('0x123');
      expect(canResume).toBe(false);
    });
  });

  describe('getStats', () => {
    beforeEach(async () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      await stateStore.initialize();
    });

    it('devrait retourner les statistiques correctes', async () => {
      // Créer plusieurs wallets avec différents statuts
      await stateStore.updateWalletState('0x123', {
        address: '0x123',
        index: 0,
        lastStep: 'collect_completed',
        errors: [],
      });

      await stateStore.updateWalletState('0x456', {
        address: '0x456',
        index: 1,
        lastStep: 'bridge_completed',
        errors: [],
      });

      await stateStore.updateWalletState('0x789', {
        address: '0x789',
        index: 2,
        lastStep: 'swap_completed',
        errors: ['Erreur de test'],
      });

      const stats = stateStore.getStats();
      expect(stats.totalWallets).toBe(3);
      expect(stats.completedWallets).toBe(1);
      expect(stats.inProgressWallets).toBe(2);
      expect(stats.errorWallets).toBe(1);
    });
  });

  describe('resetWalletState', () => {
    beforeEach(async () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      await stateStore.initialize();
    });

    it('devrait réinitialiser l\'état d\'un wallet', async () => {
      await stateStore.updateWalletState('0x123', {
        address: '0x123',
        index: 0,
        lastStep: 'bridge_completed',
      });

      let walletState = stateStore.getWalletState('0x123');
      expect(walletState).toBeDefined();

      await stateStore.resetWalletState('0x123');

      walletState = stateStore.getWalletState('0x123');
      expect(walletState).toBeNull();
    });
  });

  describe('addWalletError', () => {
    beforeEach(async () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      await stateStore.initialize();
    });

    it('devrait ajouter une erreur à un wallet existant', async () => {
      await stateStore.updateWalletState('0x123', {
        address: '0x123',
        index: 0,
        lastStep: 'bridge_completed',
        errors: [],
      });

      await stateStore.addWalletError('0x123', 'Erreur de test');

      const walletState = stateStore.getWalletState('0x123');
      expect(walletState?.errors).toHaveLength(1);
      expect(walletState?.errors[0]).toContain('Erreur de test');
    });

    it('ne devrait rien faire pour un wallet inexistant', async () => {
      await stateStore.addWalletError('0x123', 'Erreur de test');

      const walletState = stateStore.getWalletState('0x123');
      expect(walletState).toBeNull();
    });
  });
});
