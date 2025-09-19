import pino from 'pino';
import { cfg } from '../config/env.js';

// Configuration du logger avec pino
export const logger = pino({
  level: cfg.LOG_LEVEL,
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  },
});

// Logger spécialisé pour les transactions
export const txLogger = logger.child({ module: 'transaction' });

// Logger spécialisé pour les erreurs
export const errorLogger = logger.child({ module: 'error' });

// Logger spécialisé pour les métriques
export const metricsLogger = logger.child({ module: 'metrics' });

// Fonction utilitaire pour logger les erreurs avec contexte
export const logError = (error: unknown, context: Record<string, unknown> = {}) => {
  errorLogger.error({
    error: error instanceof Error ? {
      message: error.message,
      stack: error.stack,
      name: error.name,
    } : error,
    ...context,
  });
};

// Fonction utilitaire pour logger les métriques
export const logMetrics = (metrics: Record<string, unknown>) => {
  metricsLogger.info(metrics);
};
