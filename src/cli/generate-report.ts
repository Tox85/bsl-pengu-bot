#!/usr/bin/env node

import { Command } from 'commander';
import { logger } from '../core/logger.js';
import { ObservabilityManager } from '../core/observability.js';

const program = new Command();

program
  .name('generate-report')
  .description('Générer un rapport d\'exécution')
  .option('--run-id <id>', 'ID de la run à analyser (par défaut: la plus récente)')
  .option('--format <format>', 'Format du rapport (text, json, html)', 'text')
  .option('--output <file>', 'Fichier de sortie (optionnel)')
  .option('--artifacts-dir <dir>', 'Répertoire des artifacts', 'artifacts')
  .action(async (options) => {
    try {
      const observability = new ObservabilityManager(options.artifactsDir);
      
      // Lister les runs disponibles
      const previousRuns = await observability.listPreviousRuns();
      
      if (previousRuns.length === 0) {
        logger.error('Aucune run précédente trouvée');
        process.exit(1);
      }

      // Déterminer la run à analyser
      const runId = options.runId || previousRuns[0];
      
      logger.info({
        runId,
        availableRuns: previousRuns.length,
        message: 'Génération du rapport'
      });

      // Charger les métriques de la run
      const metrics = await observability.loadPreviousRun(runId);
      
      if (!metrics) {
        logger.error(`Run ${runId} non trouvée`);
        process.exit(1);
      }

      // Générer le rapport selon le format
      let report: string;
      
      switch (options.format) {
        case 'json':
          report = JSON.stringify(metrics, null, 2);
          break;
          
        case 'html':
          report = generateHtmlReport(metrics, observability.calculatePerformanceMetrics(metrics));
          break;
          
        case 'text':
        default:
          report = await observability.generateReport(metrics);
          break;
      }

      // Afficher ou sauvegarder le rapport
      if (options.output) {
        const fs = await import('fs');
        await fs.promises.writeFile(options.output, report);
        logger.info({
          output: options.output,
          format: options.format,
          message: 'Rapport sauvegardé'
        });
      } else {
        console.log(report);
      }

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        message: 'Erreur lors de la génération du rapport'
      });
      process.exit(1);
    }
  });

/**
 * Générer un rapport HTML
 */
function generateHtmlReport(metrics: any, performance: any): string {
  const successRate = performance.successRate;
  const errorRate = performance.errorRate;
  
  return `
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Rapport d'exécution - ${metrics.runId}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background-color: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 20px; margin-bottom: 30px; }
        .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .metric-card { background: #f8f9fa; padding: 20px; border-radius: 8px; border-left: 4px solid #007bff; }
        .metric-card h3 { margin: 0 0 10px 0; color: #333; }
        .metric-card .value { font-size: 2em; font-weight: bold; color: #007bff; }
        .metric-card .label { color: #666; font-size: 0.9em; }
        .success { border-left-color: #28a745; }
        .success .value { color: #28a745; }
        .error { border-left-color: #dc3545; }
        .error .value { color: #dc3545; }
        .warning { border-left-color: #ffc107; }
        .warning .value { color: #ffc107; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background-color: #f8f9fa; font-weight: bold; }
        tr:hover { background-color: #f5f5f5; }
        .status-success { color: #28a745; font-weight: bold; }
        .status-error { color: #dc3545; font-weight: bold; }
        .progress-bar { width: 100%; height: 20px; background-color: #e9ecef; border-radius: 10px; overflow: hidden; }
        .progress-fill { height: 100%; background-color: #28a745; transition: width 0.3s ease; }
        .chart-container { margin: 30px 0; }
        .error-list { background: #f8d7da; border: 1px solid #f5c6cb; border-radius: 4px; padding: 15px; margin: 20px 0; }
        .error-item { margin: 5px 0; padding: 5px; background: white; border-radius: 3px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Rapport d'exécution Multi-Wallet</h1>
            <p><strong>Run ID:</strong> ${metrics.runId}</p>
            <p><strong>Date:</strong> ${new Date(metrics.startTime).toLocaleString('fr-FR')}</p>
            <p><strong>Durée:</strong> ${metrics.duration ? (metrics.duration / 1000).toFixed(2) : 'N/A'}s</p>
        </div>

        <div class="metrics-grid">
            <div class="metric-card">
                <h3>Wallets traités</h3>
                <div class="value">${metrics.totalWallets}</div>
                <div class="label">Total</div>
            </div>
            
            <div class="metric-card success">
                <h3>Succès</h3>
                <div class="value">${metrics.successfulWallets}</div>
                <div class="label">${successRate.toFixed(2)}%</div>
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${successRate}%"></div>
                </div>
            </div>
            
            <div class="metric-card error">
                <h3>Échecs</h3>
                <div class="value">${metrics.failedWallets}</div>
                <div class="label">${errorRate.toFixed(2)}%</div>
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${errorRate}%; background-color: #dc3545;"></div>
                </div>
            </div>
            
            <div class="metric-card">
                <h3>Transactions</h3>
                <div class="value">${metrics.totalTransactions}</div>
                <div class="label">Total</div>
            </div>
            
            <div class="metric-card warning">
                <h3>USDC collectés</h3>
                <div class="value">${metrics.totalFeesCollected.usdc.toFixed(2)}</div>
                <div class="label">USD</div>
            </div>
            
            <div class="metric-card warning">
                <h3>PENGU collectés</h3>
                <div class="value">${metrics.totalFeesCollected.pengu.toFixed(2)}</div>
                <div class="label">Tokens</div>
            </div>
            
            <div class="metric-card">
                <h3>Gas utilisé</h3>
                <div class="value">${(metrics.totalGasUsed.arbitrum + metrics.totalGasUsed.abstract).toLocaleString()}</div>
                <div class="label">Total</div>
            </div>
            
            <div class="metric-card">
                <h3>Temps moyen</h3>
                <div class="value">${performance.averageExecutionTime.toFixed(2)}s</div>
                <div class="label">Par wallet</div>
            </div>
        </div>

        <h2>Détails des wallets</h2>
        <table>
            <thead>
                <tr>
                    <th>Index</th>
                    <th>Adresse</th>
                    <th>Statut</th>
                    <th>Étape finale</th>
                    <th>Temps (s)</th>
                    <th>Fees USDC</th>
                    <th>Fees PENGU</th>
                    <th>Gas</th>
                </tr>
            </thead>
            <tbody>
                ${metrics.walletResults.map((wallet: any, index: number) => `
                <tr>
                    <td>${wallet.index}</td>
                    <td>${wallet.walletAddress.substring(0, 10)}...</td>
                    <td class="${wallet.success ? 'status-success' : 'status-error'}">
                        ${wallet.success ? 'Succès' : 'Échec'}
                    </td>
                    <td>${wallet.finalStep}</td>
                    <td>${wallet.executionTime.toFixed(2)}</td>
                    <td>${wallet.feesCollected?.usdc?.toFixed(2) || '0.00'}</td>
                    <td>${wallet.feesCollected?.pengu?.toFixed(2) || '0.00'}</td>
                    <td>${((wallet.gasUsed?.arbitrum || 0) + (wallet.gasUsed?.abstract || 0)).toLocaleString()}</td>
                </tr>
                `).join('')}
            </tbody>
        </table>

        ${metrics.errors.length > 0 ? `
        <h2>Erreurs</h2>
        <div class="error-list">
            ${metrics.errors.map((error: any) => `
            <div class="error-item">
                <strong>${error.walletAddress}</strong> (${error.step}): ${error.error}
                <br><small>${new Date(error.timestamp).toLocaleString('fr-FR')}</small>
            </div>
            `).join('')}
        </div>
        ` : ''}

        <h2>Métriques de performance</h2>
        <div class="metrics-grid">
            <div class="metric-card">
                <h3>Temps médian</h3>
                <div class="value">${performance.medianExecutionTime.toFixed(2)}s</div>
            </div>
            
            <div class="metric-card">
                <h3>Wallet le plus lent</h3>
                <div class="value">${performance.slowestWallet.executionTime.toFixed(2)}s</div>
                <div class="label">${performance.slowestWallet.address.substring(0, 10)}...</div>
            </div>
            
            <div class="metric-card">
                <h3>Wallet le plus rapide</h3>
                <div class="value">${performance.fastestWallet.executionTime.toFixed(2)}s</div>
                <div class="label">${performance.fastestWallet.address.substring(0, 10)}...</div>
            </div>
            
            <div class="metric-card">
                <h3>Efficacité gas</h3>
                <div class="value">${performance.gasEfficiency.efficiencyRatio.toFixed(4)}</div>
                <div class="label">Ratio valeur/gas</div>
            </div>
        </div>
    </div>
</body>
</html>`;
}

program.parse();
