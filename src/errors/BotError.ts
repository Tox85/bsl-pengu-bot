export type BotErrorCode = 
  | 'RATE_LIMIT'
  | 'INSUFFICIENT_FUNDS'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'REVERT'
  | 'UNKNOWN'
  | 'WALLET_NOT_FOUND'
  | 'CONFIG_MISSING'
  | 'INVALID_PARAMS'
  | 'BRIDGE_TIMEOUT'
  | 'SWAP_NO_POOL'
  | 'COLLECT_REVERT';

export class BotError extends Error {
  constructor(
    public code: BotErrorCode, 
    message?: string, 
    public meta?: any
  ) { 
    super(message ?? code); 
    this.name = 'BotError';
  }

  // Factory methods for common error types
  static rateLimit(message?: string, meta?: any): BotError {
    return new BotError('RATE_LIMIT', message, meta);
  }

  static insufficientFunds(message?: string, meta?: any): BotError {
    return new BotError('INSUFFICIENT_FUNDS', message, meta);
  }

  static timeout(message?: string, meta?: any): BotError {
    return new BotError('TIMEOUT', message, meta);
  }

  static network(message?: string, meta?: any): BotError {
    return new BotError('NETWORK', message, meta);
  }

  static revert(message?: string, meta?: any): BotError {
    return new BotError('REVERT', message, meta);
  }

  static walletNotFound(message?: string, meta?: any): BotError {
    return new BotError('WALLET_NOT_FOUND', message, meta);
  }

  static configMissing(message?: string, meta?: any): BotError {
    return new BotError('CONFIG_MISSING', message, meta);
  }

  static invalidParams(message?: string, meta?: any): BotError {
    return new BotError('INVALID_PARAMS', message, meta);
  }

  static bridgeTimeout(message?: string, meta?: any): BotError {
    return new BotError('BRIDGE_TIMEOUT', message, meta);
  }

  static swapNoPool(message?: string, meta?: any): BotError {
    return new BotError('SWAP_NO_POOL', message, meta);
  }

  static collectRevert(message?: string, meta?: any): BotError {
    return new BotError('COLLECT_REVERT', message, meta);
  }

  // Helper to check if error is retryable
  isRetryable(): boolean {
    return ['RATE_LIMIT', 'TIMEOUT', 'NETWORK'].includes(this.code);
  }

  // Helper to check if error is fatal
  isFatal(): boolean {
    return ['INSUFFICIENT_FUNDS', 'WALLET_NOT_FOUND', 'CONFIG_MISSING', 'INVALID_PARAMS'].includes(this.code);
  }
}

// Helper function to convert legacy error responses to BotError
export function assertOrThrow<T>(
  result: { success: boolean; data?: T; error?: string },
  errorCode: BotErrorCode = 'UNKNOWN',
  context?: any
): T {
  if (result.success && result.data !== undefined) {
    return result.data;
  }
  
  throw new BotError(errorCode, result.error, context);
}

