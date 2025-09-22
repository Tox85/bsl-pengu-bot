import { promises as fs } from 'fs';
import { join } from 'path';
import { logger } from './logger.js';

/**
 * Interface pour les métriques d'exécution
 */
export interface ExecutionMetrics {
  runId: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  totalWallets: number;
  successfulWallets: number;
  failedWallets: number;
  totalFeesCollected: {
    usdc: number;
    pengu: number;
    eth: number;
  };
  totalGasUsed: {
    arbitrum: number;
    abstract: number;
  };
  totalTransactions: number;
  errors: Array<{
    walletAddress: string;
    step: string;
    error: string;
    timestamp: number;
  }>;
  walletResults: Array<{
    walletAddress: string;
    index: number;
    success: boolean;
    finalStep: string;
    bridgeTxHash?: string;
    swapTxHash?: string;
    lpTokenId?: number;
    collectTxHash?: string;
    feesCollected?: {
      usdc: number;
      pengu: number;
      eth: number;
    };
    gasUsed?: {
      arbitrum: number;
      abstract: number;
    };
    executionTime: number;
    errors: string[];
  }>;
}

/**
 * Interface pour les métriques de performance
 */
export interface PerformanceMetrics {
  averageExecutionTime: number;
  medianExecutionTime: number;
  slowestWallet: {
    address: string;
    executionTime: number;
  };
  fastestWallet: {
    address: string;
    executionTime: number;
  };
  successRate: number;
  errorRate: number;
  gasEfficiency: {
    totalGasUsed: number;
    totalValue: number;
    efficiencyRatio: number;
  };
}

/**
 * Gestionnaire d'observabilité
 */
export class ObservabilityManager {
  private artifactsDir: string;
  private currentRunId: string;

  constructor(artifactsDir: string = 'artifacts') {
    this.artifactsDir = artifactsDir;
    this.currentRunId = this.generateRunId();
  }

  /**
   * Générer un ID unique pour la run
   */
  private generateRunId(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const random = Math.random().toString(36).substring(2, 8);
    return `run-${timestamp}-${random}`;
  }

  /**
   * Initialiser le système d'observabilité
   */
  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.artifactsDir, { recursive: true });
      
      logger.info({
        artifactsDir: this.artifactsDir,
        runId: this.currentRunId,
        message: 'Système d\'observabilité initialisé'
      });
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        message: 'Erreur lors de l\'initialisation de l\'observabilité'
      });
      throw error;
    }
  }

  /**
   * Démarrer le tracking d'une exécution
   */
  async startExecution(totalWallets: number): Promise<string> {
    const metrics: ExecutionMetrics = {
      runId: this.currentRunId,
      startTime: Date.now(),
      totalWallets,
      successfulWallets: 0,
      failedWallets: 0,
      totalFeesCollected: { usdc: 0, pengu: 0, eth: 0 },
      totalGasUsed: { arbitrum: 0, abstract: 0 },
      totalTransactions: 0,
      errors: [],
      walletResults: [],
    };

    await this.saveMetrics(metrics);
    
    logger.info({
      runId: this.currentRunId,
      totalWallets,
      message: 'Tracking d\'exécution démarré'
    });

    return this.currentRunId;
  }

  /**
   * Mettre à jour les métriques d'un wallet
   */
  async updateWalletMetrics(walletAddress: string, updates: Partial<ExecutionMetrics['walletResults'][0]>): Promise<void> {
    try {
      const metrics = await this.loadMetrics();
      
      // Trouver ou créer l'entrée du wallet
      let walletResult = metrics.walletResults.find(w => w.walletAddress === walletAddress);
      if (!walletResult) {
        walletResult = {
          walletAddress,
          index: 0,
          success: false,
          finalStep: '',
          executionTime: 0,
          errors: [],
          ...updates,
        };
        metrics.walletResults.push(walletResult);
      } else {
        Object.assign(walletResult, updates);
      }

      await this.saveMetrics(metrics);
    } catch (error) {
      logger.error({
        walletAddress,
        error: error instanceof Error ? error.message : String(error),
        message: 'Erreur lors de la mise à jour des métriques du wallet'
      });
    }
  }

  /**
   * Ajouter une erreur
   */
  async addError(walletAddress: string, step: string, error: string): Promise<void> {
    try {
      const metrics = await this.loadMetrics();
      
      metrics.errors.push({
        walletAddress,
        step,
        error,
        timestamp: Date.now(),
      });

      await this.saveMetrics(metrics);
    } catch (error) {
      logger.error({
        walletAddress,
        step,
        error,
        message: 'Erreur lors de l\'ajout d\'une erreur'
      });
    }
  }

  /**
   * Finaliser les métriques d'exécution
   */
  async finalizeExecution(): Promise<ExecutionMetrics> {
    try {
      const metrics = await this.loadMetrics();
      
      metrics.endTime = Date.now();
      metrics.duration = metrics.endTime - metrics.startTime;
      
      // Calculer les totaux
      metrics.successfulWallets = metrics.walletResults.filter(w => w.success).length;
      metrics.failedWallets = metrics.walletResults.filter(w => !w.success).length;
      
      // Calculer les totaux des fees et gas
      metrics.totalFeesCollected = { usdc: 0, pengu: 0, eth: 0 };
      metrics.totalGasUsed = { arbitrum: 0, abstract: 0 };
      
      metrics.walletResults.forEach(wallet => {
        if (wallet.feesCollected) {
          metrics.totalFeesCollected.usdc += wallet.feesCollected.usdc;
          metrics.totalFeesCollected.pengu += wallet.feesCollected.pengu;
          metrics.totalFeesCollected.eth += wallet.feesCollected.eth;
        }
        
        if (wallet.gasUsed) {
          metrics.totalGasUsed.arbitrum += wallet.gasUsed.arbitrum;
          metrics.totalGasUsed.abstract += wallet.gasUsed.abstract;
        }
      });

      await this.saveMetrics(metrics);
      
      logger.info({
        runId: this.currentRunId,
        duration: metrics.duration,
        successfulWallets: metrics.successfulWallets,
        failedWallets: metrics.failedWallets,
        message: 'Métriques d\'exécution finalisées'
      });

      return metrics;
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        message: 'Erreur lors de la finalisation des métriques'
      });
      throw error;
    }
  }

  /**
   * Calculer les métriques de performance
   */
  calculatePerformanceMetrics(metrics: ExecutionMetrics): PerformanceMetrics {
    const executionTimes = metrics.walletResults.map(w => w.executionTime).filter(t => t > 0);
    const sortedTimes = executionTimes.sort((a, b) => a - b);
    
    const averageExecutionTime = executionTimes.length > 0 ? 
      executionTimes.reduce((sum, time) => sum + time, 0) / executionTimes.length : 0;
    
    const medianExecutionTime = sortedTimes.length > 0 ? 
      sortedTimes[Math.floor(sortedTimes.length / 2)] : 0;
    
    const slowestWallet = metrics.walletResults.reduce((slowest, wallet) => {
      return wallet.executionTime > slowest.executionTime ? {
        address: wallet.walletAddress,
        executionTime: wallet.executionTime
      } : slowest;
    }, { address: '', executionTime: 0 });
    
    const fastestWallet = metrics.walletResults.reduce((fastest, wallet) => {
      return wallet.executionTime < fastest.executionTime && wallet.executionTime > 0 ? {
        address: wallet.walletAddress,
        executionTime: wallet.executionTime
      } : fastest;
    }, { address: '', executionTime: Infinity });

    const successRate = metrics.totalWallets > 0 ? 
      (metrics.successfulWallets / metrics.totalWallets) * 100 : 0;
    
    const errorRate = metrics.totalWallets > 0 ? 
      (metrics.failedWallets / metrics.totalWallets) * 100 : 0;

    const totalGasUsed = metrics.totalGasUsed.arbitrum + metrics.totalGasUsed.abstract;
    const totalValue = metrics.totalFeesCollected.usdc + 
      (metrics.totalFeesCollected.pengu * 0.1) + // Estimation de la valeur PENGU
      metrics.totalFeesCollected.eth;
    
    const gasEfficiency = totalGasUsed > 0 ? {
      totalGasUsed,
      totalValue,
      efficiencyRatio: totalValue / totalGasUsed,
    } : {
      totalGasUsed: 0,
      totalValue: 0,
      efficiencyRatio: 0,
    };

    return {
      averageExecutionTime,
      medianExecutionTime,
      slowestWallet,
      fastestWallet,
      successRate,
      errorRate,
      gasEfficiency,
    };
  }

  /**
   * Générer un rapport détaillé
   */
  async generateReport(metrics: ExecutionMetrics): Promise<string> {
    const performance = this.calculatePerformanceMetrics(metrics);
    
    const report = `
=== RAPPORT D'EXÉCUTION MULTI-WALLET ===
Run ID: ${metrics.runId}
Date: ${new Date(metrics.startTime).toISOString()}
Durée totale: ${metrics.duration ? (metrics.duration / 1000).toFixed(2) : 'N/A'}s

=== STATISTIQUES GLOBALES ===
Wallets traités: ${metrics.totalWallets}
Succès: ${metrics.successfulWallets} (${performance.successRate.toFixed(2)}%)
Échecs: ${metrics.failedWallets} (${performance.errorRate.toFixed(2)}%)
Transactions totales: ${metrics.totalTransactions}

=== FEES COLLECTÉS ===
USDC: ${metrics.totalFeesCollected.usdc.toFixed(2)}
PENGU: ${metrics.totalFeesCollected.pengu.toFixed(2)}
ETH: ${metrics.totalFeesCollected.eth.toFixed(6)}

=== GAS UTILISÉ ===
Arbitrum: ${metrics.totalGasUsed.arbitrum.toFixed(0)} gas
Abstract: ${metrics.totalGasUsed.abstract.toFixed(0)} gas
Total: ${(metrics.totalGasUsed.arbitrum + metrics.totalGasUsed.abstract).toFixed(0)} gas

=== PERFORMANCE ===
Temps d'exécution moyen: ${performance.averageExecutionTime.toFixed(2)}s
Temps d'exécution médian: ${performance.medianExecutionTime.toFixed(2)}s
Wallet le plus lent: ${performance.slowestWallet.address} (${performance.slowestWallet.executionTime.toFixed(2)}s)
Wallet le plus rapide: ${performance.fastestWallet.address} (${performance.fastestWallet.executionTime.toFixed(2)}s)

=== EFFICACITÉ GAS ===
Ratio efficacité: ${performance.gasEfficiency.efficiencyRatio.toFixed(4)}

=== ERREURS ===
${metrics.errors.length > 0 ? 
  metrics.errors.map(error => 
    `- ${error.walletAddress} (${error.step}): ${error.error}`
  ).join('\n') : 
  'Aucune erreur'
}

=== RÉSULTATS PAR WALLET ===
${metrics.walletResults.map((wallet, index) => `
${index + 1}. ${wallet.walletAddress}
   Index: ${wallet.index}
   Succès: ${wallet.success ? 'Oui' : 'Non'}
   Étape finale: ${wallet.finalStep}
   Temps d'exécution: ${wallet.executionTime.toFixed(2)}s
   ${wallet.bridgeTxHash ? `Bridge TX: ${wallet.bridgeTxHash}` : ''}
   ${wallet.swapTxHash ? `Swap TX: ${wallet.swapTxHash}` : ''}
   ${wallet.lpTokenId ? `LP Token ID: ${wallet.lpTokenId}` : ''}
   ${wallet.collectTxHash ? `Collect TX: ${wallet.collectTxHash}` : ''}
   ${wallet.feesCollected ? `Fees: ${JSON.stringify(wallet.feesCollected)}` : ''}
   ${wallet.errors.length > 0 ? `Erreurs: ${wallet.errors.join(', ')}` : ''}
`).join('')}
`;

    return report;
  }

  /**
   * Sauvegarder les métriques dans un fichier
   */
  private async saveMetrics(metrics: ExecutionMetrics): Promise<void> {
    const filename = join(this.artifactsDir, `${metrics.runId}.json`);
    await fs.writeFile(filename, JSON.stringify(metrics, null, 2));
  }

  /**
   * Charger les métriques depuis un fichier
   */
  private async loadMetrics(): Promise<ExecutionMetrics> {
    const filename = join(this.artifactsDir, `${this.currentRunId}.json`);
    const data = await fs.readFile(filename, 'utf-8');
    return JSON.parse(data);
  }

  /**
   * Sauvegarder le rapport
   */
  async saveReport(report: string): Promise<string> {
    const filename = join(this.artifactsDir, `${this.currentRunId}-report.txt`);
    await fs.writeFile(filename, report);
    
    logger.info({
      runId: this.currentRunId,
      filename,
      message: 'Rapport sauvegardé'
    });

    return filename;
  }

  /**
   * Obtenir l'ID de la run actuelle
   */
  getCurrentRunId(): string {
    return this.currentRunId;
  }

  /**
   * Lister les runs précédentes
   */
  async listPreviousRuns(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.artifactsDir);
      return files
        .filter(file => file.startsWith('run-') && file.endsWith('.json'))
        .map(file => file.replace('.json', ''))
        .sort()
        .reverse();
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        message: 'Erreur lors de la liste des runs précédentes'
      });
      return [];
    }
  }

  /**
   * Charger une run précédente
   */
  async loadPreviousRun(runId: string): Promise<ExecutionMetrics | null> {
    try {
      const filename = join(this.artifactsDir, `${runId}.json`);
      const data = await fs.readFile(filename, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      logger.error({
        runId,
        error: error instanceof Error ? error.message : String(error),
        message: 'Erreur lors du chargement de la run précédente'
      });
      return null;
    }
  }

  /**
   * Nettoyer les anciens artifacts
   */
  async cleanupOldArtifacts(maxAgeDays: number = 7): Promise<void> {
    try {
      const files = await fs.readdir(this.artifactsDir);
      const cutoffTime = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);
      
      let cleanedCount = 0;
      
      for (const file of files) {
        const filepath = join(this.artifactsDir, file);
        const stats = await fs.stat(filepath);
        
        if (stats.mtime.getTime() < cutoffTime) {
          await fs.unlink(filepath);
          cleanedCount++;
        }
      }
      
      if (cleanedCount > 0) {
        logger.info({
          cleanedCount,
          maxAgeDays,
          message: 'Anciens artifacts nettoyés'
        });
      }
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        message: 'Erreur lors du nettoyage des artifacts'
      });
    }
  }
}

/**
 * Instance globale de l'observabilité
 */
export const observability = new ObservabilityManager();
