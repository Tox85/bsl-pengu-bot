import { BotError } from '../errors/BotError.js';

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitter?: boolean;
  backoffMultiplier?: number;
  onRetry?: (attempt: number, error: Error) => void;
}

export interface RetryResult<T> {
  result: T;
  attempts: number;
  totalDelayMs: number;
}

export class RetryError extends Error {
  constructor(
    public lastError: Error,
    public attempts: number,
    public totalDelayMs: number,
    message?: string
  ) {
    super(message ?? `Failed after ${attempts} attempts`);
    this.name = 'RetryError';
  }
}

/**
 * Retry function with exponential backoff and jitter
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<RetryResult<T>> {
  const {
    maxRetries = 3,
    baseDelayMs = 1000,
    maxDelayMs = 30000,
    jitter = true,
    backoffMultiplier = 2,
    onRetry
  } = options;

  let lastError: Error;
  let totalDelayMs = 0;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();
      return {
        result,
        attempts: attempt,
        totalDelayMs
      };
    } catch (error) {
      lastError = error as Error;

      // Don't retry on fatal errors
      if (error instanceof BotError && error.isFatal()) {
        throw error;
      }

      // Don't retry on last attempt
      if (attempt === maxRetries) {
        break;
      }

      // Calculate delay with exponential backoff
      const delayMs = Math.min(
        baseDelayMs * Math.pow(backoffMultiplier, attempt - 1),
        maxDelayMs
      );

      // Add jitter to prevent thundering herd
      const jitterMs = jitter ? Math.random() * delayMs * 0.1 : 0;
      const finalDelayMs = delayMs + jitterMs;

      totalDelayMs += finalDelayMs;

      // Call retry callback
      if (onRetry) {
        onRetry(attempt, lastError);
      }

      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, finalDelayMs));
    }
  }

  throw new RetryError(lastError!, maxRetries, totalDelayMs);
}

/**
 * Specialized retry for API calls
 */
export async function retryApi<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<RetryResult<T>> {
  return retry(fn, {
    maxRetries: 5,
    baseDelayMs: 500,
    maxDelayMs: 10000,
    ...options
  });
}

/**
 * Specialized retry for blockchain transactions
 */
export async function retryTransaction<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<RetryResult<T>> {
  return retry(fn, {
    maxRetries: 3,
    baseDelayMs: 2000,
    maxDelayMs: 30000,
    ...options
  });
}

/**
 * Specialized retry for polling operations
 */
export async function retryPolling<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<RetryResult<T>> {
  return retry(fn, {
    maxRetries: 10,
    baseDelayMs: 1000,
    maxDelayMs: 5000,
    ...options
  });
}

/**
 * Wrapper to add retry to any async function
 */
export function withRetry<T extends any[], R>(
  fn: (...args: T) => Promise<R>,
  options: RetryOptions = {}
) {
  return async (...args: T): Promise<R> => {
    const result = await retry(() => fn(...args), options);
    return result.result;
  };
}

/**
 * Wrapper specifically for RPC calls
 */
export function withRetryRpc<T extends any[], R>(
  fn: (...args: T) => Promise<R>,
  options: RetryOptions = {}
) {
  return withRetry(fn, {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 10000,
    ...options
  });
}

/**
 * Wrapper specifically for transaction calls
 */
export function withRetryTransaction<T extends any[], R>(
  fn: (...args: T) => Promise<R>,
  options: RetryOptions = {}
) {
  return withRetry(fn, {
    maxRetries: 2,
    baseDelayMs: 2000,
    maxDelayMs: 30000,
    ...options
  });
}

