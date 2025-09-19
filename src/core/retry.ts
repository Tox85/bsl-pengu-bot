import { logger } from './logger.js';
import { cfg } from '../config/env.js';

// Interface pour les options de retry
export interface RetryOptions {
  maxRetries?: number;
  delayMs?: number;
  backoffMultiplier?: number;
  maxDelayMs?: number;
}

// Configuration par défaut
const defaultRetryOptions: Required<RetryOptions> = {
  maxRetries: cfg.MAX_RETRIES,
  delayMs: cfg.RETRY_DELAY_MS,
  backoffMultiplier: 2,
  maxDelayMs: 30000, // 30 secondes max
};

// Fonction utilitaire pour attendre
const sleep = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

// Fonction utilitaire pour calculer le délai avec backoff exponentiel
const calculateDelay = (
  attempt: number,
  baseDelay: number,
  multiplier: number,
  maxDelay: number
): number => {
  const delay = baseDelay * Math.pow(multiplier, attempt - 1);
  return Math.min(delay, maxDelay);
};

// Fonction de retry générique
export const withRetry = async <T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> => {
  const config = { ...defaultRetryOptions, ...options };
  let lastError: unknown;

  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    try {
      const result = await operation();
      
      if (attempt > 1) {
        logger.info({
          attempt,
          maxRetries: config.maxRetries,
          message: 'Opération réussie après retry'
        });
      }
      
      return result;
    } catch (error) {
      lastError = error;
      
      logger.warn({
        attempt,
        maxRetries: config.maxRetries,
        error: error instanceof Error ? error.message : 'Unknown error',
        message: 'Tentative échouée, retry en cours'
      });

      // Si c'est la dernière tentative, on ne fait pas de pause
      if (attempt === config.maxRetries) {
        break;
      }

      // Calculer le délai avec backoff exponentiel
      const delay = calculateDelay(
        attempt,
        config.delayMs,
        config.backoffMultiplier,
        config.maxDelayMs
      );

      logger.debug({
        attempt,
        delay,
        message: 'Attente avant retry'
      });

      await sleep(delay);
    }
  }

  // Si on arrive ici, toutes les tentatives ont échoué
  logger.error({
    maxRetries: config.maxRetries,
    error: lastError instanceof Error ? lastError.message : 'Unknown error',
    message: 'Toutes les tentatives de retry ont échoué'
  });

  throw lastError;
};

// Fonction de retry spécialisée pour les transactions
export const withRetryTransaction = async <T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> => {
  return withRetry(operation, {
    ...options,
    maxRetries: options.maxRetries || 5, // Plus de retries pour les transactions
    delayMs: options.delayMs || 2000, // Délai plus long pour les transactions
  });
};

// Fonction de retry spécialisée pour les appels RPC
export const withRetryRpc = async <T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> => {
  return withRetry(operation, {
    ...options,
    maxRetries: options.maxRetries || 3,
    delayMs: options.delayMs || 1000,
  });
};
