import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ObservabilityManager, type ExecutionMetrics } from '../src/core/observability.js';
import { promises as fs } from 'fs';
import { join } from 'path';

// Mock fs
vi.mock('fs', () => ({
  promises: {
    mkdir: vi.fn(),
    writeFile: vi.fn(),
    readFile: vi.fn(),
    readdir: vi.fn(),
    stat: vi.fn(),
    unlink: vi.fn(),
  },
}));

describe('ObservabilityManager', () => {
  let observability: ObservabilityManager;
  const mockArtifactsDir = '/tmp/test-artifacts';

  beforeEach(() => {
    observability = new ObservabilityManager(mockArtifactsDir);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('initialize', () => {
    it('devrait initialiser le système d\'observabilité', async () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);

      await observability.initialize();

      expect(fs.mkdir).toHaveBeenCalledWith(mockArtifactsDir, { recursive: true });
    });
  });

  describe('startExecution', () => {
    beforeEach(async () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      await observability.initialize();
    });

    it('devrait démarrer le tracking d\'une exécution', async () => {
      const runId = await observability.startExecution(10);

      expect(runId).toMatch(/^run-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-z0-9]+$/);
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining(`${runId}.json`),
        expect.any(String)
      );
    });
  });

  describe('updateWalletMetrics', () => {
    beforeEach(async () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({
        runId: observability.getCurrentRunId(),
        startTime: Date.now(),
        totalWallets: 2,
        successfulWallets: 0,
        failedWallets: 0,
        totalFeesCollected: { usdc: 0, pengu: 0, eth: 0 },
        totalGasUsed: { arbitrum: 0, abstract: 0 },
        totalTransactions: 0,
        errors: [],
        walletResults: [],
      }));
      await observability.initialize();
    });

    it('devrait mettre à jour les métriques d\'un wallet', async () => {
      await observability.updateWalletMetrics('0x123', {
        walletAddress: '0x123',
        index: 0,
        success: true,
        finalStep: 'collect_completed',
        executionTime: 1500,
        feesCollected: { usdc: 10.5, pengu: 5.2, eth: 0.001 },
      });

      expect(fs.writeFile).toHaveBeenCalled();
    });
  });

  describe('addError', () => {
    beforeEach(async () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({
        runId: observability.getCurrentRunId(),
        startTime: Date.now(),
        totalWallets: 1,
        successfulWallets: 0,
        failedWallets: 0,
        totalFeesCollected: { usdc: 0, pengu: 0, eth: 0 },
        totalGasUsed: { arbitrum: 0, abstract: 0 },
        totalTransactions: 0,
        errors: [],
        walletResults: [],
      }));
      await observability.initialize();
    });

    it('devrait ajouter une erreur', async () => {
      await observability.addError('0x123', 'bridge', 'Erreur de bridge');

      expect(fs.writeFile).toHaveBeenCalled();
    });
  });

  describe('finalizeExecution', () => {
    beforeEach(async () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({
        runId: observability.getCurrentRunId(),
        startTime: Date.now() - 5000,
        totalWallets: 2,
        successfulWallets: 0,
        failedWallets: 0,
        totalFeesCollected: { usdc: 0, pengu: 0, eth: 0 },
        totalGasUsed: { arbitrum: 0, abstract: 0 },
        totalTransactions: 0,
        errors: [],
        walletResults: [
          {
            walletAddress: '0x123',
            index: 0,
            success: true,
            finalStep: 'collect_completed',
            executionTime: 2000,
            feesCollected: { usdc: 10.5, pengu: 5.2, eth: 0.001 },
            gasUsed: { arbitrum: 100000, abstract: 150000 },
            errors: [],
          },
          {
            walletAddress: '0x456',
            index: 1,
            success: false,
            finalStep: 'bridge_failed',
            executionTime: 1000,
            errors: ['Erreur de bridge'],
          },
        ],
      }));
      await observability.initialize();
    });

    it('devrait finaliser les métriques d\'exécution', async () => {
      const metrics = await observability.finalizeExecution();

      expect(metrics.endTime).toBeDefined();
      expect(metrics.duration).toBeGreaterThan(0);
      expect(metrics.successfulWallets).toBe(1);
      expect(metrics.failedWallets).toBe(1);
      expect(metrics.totalFeesCollected.usdc).toBe(10.5);
      expect(metrics.totalGasUsed.arbitrum).toBe(100000);
      expect(metrics.totalGasUsed.abstract).toBe(150000);
    });
  });

  describe('calculatePerformanceMetrics', () => {
    it('devrait calculer les métriques de performance', () => {
      const metrics: ExecutionMetrics = {
        runId: 'test-run',
        startTime: Date.now() - 10000,
        endTime: Date.now(),
        duration: 10000,
        totalWallets: 3,
        successfulWallets: 2,
        failedWallets: 1,
        totalFeesCollected: { usdc: 20, pengu: 10, eth: 0.002 },
        totalGasUsed: { arbitrum: 200000, abstract: 300000 },
        totalTransactions: 6,
        errors: [],
        walletResults: [
          {
            walletAddress: '0x123',
            index: 0,
            success: true,
            finalStep: 'collect_completed',
            executionTime: 2000,
            feesCollected: { usdc: 10, pengu: 5, eth: 0.001 },
            gasUsed: { arbitrum: 100000, abstract: 150000 },
            errors: [],
          },
          {
            walletAddress: '0x456',
            index: 1,
            success: true,
            finalStep: 'collect_completed',
            executionTime: 1500,
            feesCollected: { usdc: 10, pengu: 5, eth: 0.001 },
            gasUsed: { arbitrum: 100000, abstract: 150000 },
            errors: [],
          },
          {
            walletAddress: '0x789',
            index: 2,
            success: false,
            finalStep: 'bridge_failed',
            executionTime: 500,
            errors: ['Erreur de bridge'],
          },
        ],
      };

      const performance = observability.calculatePerformanceMetrics(metrics);

      expect(performance.averageExecutionTime).toBe(1333.33); // (2000 + 1500 + 500) / 3
      expect(performance.medianExecutionTime).toBe(1500); // Valeur médiane
      expect(performance.successRate).toBe(66.67); // 2/3 * 100
      expect(performance.errorRate).toBe(33.33); // 1/3 * 100
      expect(performance.slowestWallet.address).toBe('0x123');
      expect(performance.slowestWallet.executionTime).toBe(2000);
      expect(performance.fastestWallet.address).toBe('0x789');
      expect(performance.fastestWallet.executionTime).toBe(500);
      expect(performance.gasEfficiency.totalGasUsed).toBe(500000);
    });
  });

  describe('generateReport', () => {
    it('devrait générer un rapport détaillé', async () => {
      const metrics: ExecutionMetrics = {
        runId: 'test-run',
        startTime: Date.now() - 10000,
        endTime: Date.now(),
        duration: 10000,
        totalWallets: 1,
        successfulWallets: 1,
        failedWallets: 0,
        totalFeesCollected: { usdc: 10, pengu: 5, eth: 0.001 },
        totalGasUsed: { arbitrum: 100000, abstract: 150000 },
        totalTransactions: 3,
        errors: [],
        walletResults: [
          {
            walletAddress: '0x123',
            index: 0,
            success: true,
            finalStep: 'collect_completed',
            executionTime: 2000,
            feesCollected: { usdc: 10, pengu: 5, eth: 0.001 },
            gasUsed: { arbitrum: 100000, abstract: 150000 },
            errors: [],
          },
        ],
      };

      const report = await observability.generateReport(metrics);

      expect(report).toContain('RAPPORT D\'EXÉCUTION MULTI-WALLET');
      expect(report).toContain('test-run');
      expect(report).toContain('STATISTIQUES GLOBALES');
      expect(report).toContain('FEES COLLECTÉS');
      expect(report).toContain('GAS UTILISÉ');
      expect(report).toContain('PERFORMANCE');
      expect(report).toContain('RÉSULTATS PAR WALLET');
      expect(report).toContain('0x123');
    });
  });

  describe('saveReport', () => {
    beforeEach(async () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      await observability.initialize();
    });

    it('devrait sauvegarder le rapport', async () => {
      const report = 'Test report content';
      const filename = await observability.saveReport(report);

      expect(filename).toContain('-report.txt');
      expect(fs.writeFile).toHaveBeenCalledWith(filename, report);
    });
  });

  describe('listPreviousRuns', () => {
    beforeEach(async () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      await observability.initialize();
    });

    it('devrait lister les runs précédentes', async () => {
      vi.mocked(fs.readdir).mockResolvedValue([
        'run-2024-01-01T10-00-00-000Z-abc123.json',
        'run-2024-01-02T10-00-00-000Z-def456.json',
        'other-file.txt',
      ]);

      const runs = await observability.listPreviousRuns();

      expect(runs).toHaveLength(2);
      expect(runs[0]).toBe('run-2024-01-02T10-00-00-000Z-def456'); // Plus récent en premier
      expect(runs[1]).toBe('run-2024-01-01T10-00-00-000Z-abc123');
    });

    it('devrait gérer le cas où aucun fichier n\'existe', async () => {
      vi.mocked(fs.readdir).mockResolvedValue([]);

      const runs = await observability.listPreviousRuns();

      expect(runs).toHaveLength(0);
    });
  });

  describe('loadPreviousRun', () => {
    beforeEach(async () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      await observability.initialize();
    });

    it('devrait charger une run précédente', async () => {
      const mockMetrics = {
        runId: 'test-run',
        startTime: Date.now(),
        totalWallets: 1,
        successfulWallets: 1,
        failedWallets: 0,
        totalFeesCollected: { usdc: 0, pengu: 0, eth: 0 },
        totalGasUsed: { arbitrum: 0, abstract: 0 },
        totalTransactions: 0,
        errors: [],
        walletResults: [],
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockMetrics));

      const metrics = await observability.loadPreviousRun('test-run');

      expect(metrics).toEqual(mockMetrics);
    });

    it('devrait retourner null pour une run inexistante', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'));

      const metrics = await observability.loadPreviousRun('nonexistent-run');

      expect(metrics).toBeNull();
    });
  });

  describe('cleanupOldArtifacts', () => {
    beforeEach(async () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      await observability.initialize();
    });

    it('devrait nettoyer les anciens artifacts', async () => {
      const oldTime = Date.now() - (8 * 24 * 60 * 60 * 1000); // 8 jours
      const recentTime = Date.now() - (2 * 24 * 60 * 60 * 1000); // 2 jours

      vi.mocked(fs.readdir).mockResolvedValue(['old-file.json', 'recent-file.json']);
      vi.mocked(fs.stat).mockResolvedValueOnce({
        mtime: new Date(oldTime),
      } as any);
      vi.mocked(fs.stat).mockResolvedValueOnce({
        mtime: new Date(recentTime),
      } as any);
      vi.mocked(fs.unlink).mockResolvedValue(undefined);

      await observability.cleanupOldArtifacts(7); // Nettoyer les fichiers > 7 jours

      expect(fs.unlink).toHaveBeenCalledTimes(1); // Seulement le fichier ancien
    });
  });
});
