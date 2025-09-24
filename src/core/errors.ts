/**
 * Codes d'erreur standardisés pour le bot
 */
export const ERROR_CODES = {
  // Erreurs de réseau
  NETWORK: 'NETWORK',
  RATE_LIMIT: 'RATE_LIMIT',
  TIMEOUT: 'TIMEOUT',
  
  // Erreurs de fonds
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  
  // Erreurs de bridge
  BRIDGE_TIMEOUT: 'BRIDGE_TIMEOUT',
  BRIDGE_FAILED: 'BRIDGE_FAILED',
  BRIDGE_ROUTE_NOT_FOUND: 'BRIDGE_ROUTE_NOT_FOUND',
  
  // Erreurs de swap
  SWAP_NO_POOL: 'SWAP_NO_POOL',
  SWAP_SLIPPAGE_TOO_HIGH: 'SWAP_SLIPPAGE_TOO_HIGH',
  SWAP_FAILED: 'SWAP_FAILED',
  
  // Erreurs de LP
  LP_CREATE_FAILED: 'LP_CREATE_FAILED',
  LP_COLLECT_FAILED: 'LP_COLLECT_FAILED',
  LP_POSITION_NOT_FOUND: 'LP_POSITION_NOT_FOUND',
  
  // Erreurs de wallet
  WALLET_NOT_FOUND: 'WALLET_NOT_FOUND',
  WALLET_INVALID_KEY: 'WALLET_INVALID_KEY',
  WALLET_NONCE_COLLISION: 'WALLET_NONCE_COLLISION',
  
  // Erreurs de configuration
  CONFIG_MISSING: 'CONFIG_MISSING',
  CONFIG_INVALID: 'CONFIG_INVALID',
  
  // Erreurs de CEX
  CEX_WITHDRAW_FAILED: 'CEX_WITHDRAW_FAILED',
  CEX_INSUFFICIENT_BALANCE: 'CEX_INSUFFICIENT_BALANCE',
  CEX_ADDRESS_NOT_WHITELISTED: 'CEX_ADDRESS_NOT_WHITELISTED',
  CEX_MINIMUM_AMOUNT: 'CEX_MINIMUM_AMOUNT',
  
  // Erreurs de distribution
  DISTRIBUTION_FAILED: 'DISTRIBUTION_FAILED',
  DISTRIBUTION_INSUFFICIENT_FUNDS: 'DISTRIBUTION_INSUFFICIENT_FUNDS',
  
  // Erreurs de reprise
  RESUME_INVALID_STATE: 'RESUME_INVALID_STATE',
  RESUME_STATE_CORRUPTED: 'RESUME_STATE_CORRUPTED',
} as const;

export type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES];

/**
 * Classe d'erreur personnalisée avec code
 */
export class BotError extends Error {
  public readonly code: ErrorCode;
  public readonly context?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, context?: Record<string, unknown>) {
    super(message);
    this.name = 'BotError';
    this.code = code;
    this.context = context;
  }

  /**
   * Créer une erreur de réseau
   */
  static network(message: string, context?: Record<string, unknown>): BotError {
    return new BotError(ERROR_CODES.NETWORK, message, context);
  }

  /**
   * Créer une erreur de rate limit
   */
  static rateLimit(message: string, context?: Record<string, unknown>): BotError {
    return new BotError(ERROR_CODES.RATE_LIMIT, message, context);
  }

  /**
   * Créer une erreur de timeout
   */
  static timeout(message: string, context?: Record<string, unknown>): BotError {
    return new BotError(ERROR_CODES.TIMEOUT, message, context);
  }

  /**
   * Créer une erreur de fonds insuffisants
   */
  static insufficientFunds(message: string, context?: Record<string, unknown>): BotError {
    return new BotError(ERROR_CODES.INSUFFICIENT_FUNDS, message, context);
  }

  /**
   * Créer une erreur de bridge
   */
  static bridgeTimeout(message: string, context?: Record<string, unknown>): BotError {
    return new BotError(ERROR_CODES.BRIDGE_TIMEOUT, message, context);
  }

  /**
   * Créer une erreur de swap
   */
  static swapNoPool(message: string, context?: Record<string, unknown>): BotError {
    return new BotError(ERROR_CODES.SWAP_NO_POOL, message, context);
  }

  /**
   * Créer une erreur de collect
   */
  static collectRevert(message: string, context?: Record<string, unknown>): BotError {
    return new BotError(ERROR_CODES.LP_COLLECT_FAILED, message, context);
  }

  /**
   * Créer une erreur de wallet
   */
  static walletNotFound(message: string, context?: Record<string, unknown>): BotError {
    return new BotError(ERROR_CODES.WALLET_NOT_FOUND, message, context);
  }

  /**
   * Créer une erreur de configuration
   */
  static configMissing(message: string, context?: Record<string, unknown>): BotError {
    return new BotError(ERROR_CODES.CONFIG_MISSING, message, context);
  }

  /**
   * Créer une erreur de CEX
   */
  static cexWithdrawFailed(message: string, context?: Record<string, unknown>): BotError {
    return new BotError(ERROR_CODES.CEX_WITHDRAW_FAILED, message, context);
  }

  /**
   * Vérifier si l'erreur est de type BotError
   */
  static isBotError(error: unknown): error is BotError {
    return error instanceof BotError;
  }

  /**
   * Obtenir le code d'erreur d'une erreur quelconque
   */
  static getErrorCode(error: unknown): ErrorCode | null {
    if (BotError.isBotError(error)) {
      return error.code;
    }
    return null;
  }

  /**
   * Vérifier si l'erreur est récupérable (peut être retry)
   */
  isRetryable(): boolean {
    const retryableCodes = [
      ERROR_CODES.NETWORK,
      ERROR_CODES.RATE_LIMIT,
      ERROR_CODES.TIMEOUT,
      ERROR_CODES.BRIDGE_TIMEOUT,
    ];
    return retryableCodes.includes(this.code as any);
  }

  /**
   * Vérifier si l'erreur est fatale (ne peut pas être retry)
   */
  isFatal(): boolean {
    const fatalCodes = [
      ERROR_CODES.INSUFFICIENT_FUNDS,
      ERROR_CODES.SWAP_NO_POOL,
      ERROR_CODES.WALLET_NOT_FOUND,
      ERROR_CODES.CONFIG_MISSING,
      ERROR_CODES.CEX_ADDRESS_NOT_WHITELISTED,
    ];
    return fatalCodes.includes(this.code as any);
  }
}
