/**
 * Types pour les échanges centralisés (CEX)
 */

/**
 * Configuration pour un échange
 */
export interface ExchangeConfig {
  apiKey: string;
  apiSecret: string;
  sandbox?: boolean;
  testnet?: boolean;
}

/**
 * Résultat d'un retrait
 */
export interface WithdrawalResult {
  success: boolean;
  withdrawalId?: string;
  amount: number;
  token: string;
  address: string;
  txHash?: string;
  status?: string;
  error?: string;
}

/**
 * Information de balance
 */
export interface BalanceInfo {
  token: string;
  available: number;
  total: number;
  frozen?: number;
}

/**
 * Statut d'un retrait
 */
export interface WithdrawalStatus {
  withdrawalId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  amount: number;
  token: string;
  address: string;
  txHash?: string;
  error?: string;
}

/**
 * Paramètres de retrait
 */
export interface WithdrawalParams {
  token: string;
  amount: number;
  address: string;
  network?: string;
  tag?: string;
  awaitCompletion?: boolean;
  pollingTimeoutMs?: number;
  pollingIntervalMs?: number;
  dryRun?: boolean;
}

/**
 * Interface commune pour les adaptateurs d'échange
 */
export interface ExchangeAdapter {
  /**
   * Obtenir le solde d'un token
   */
  getBalance(token: string): Promise<BalanceInfo>;

  /**
   * Effectuer un retrait
   */
  withdraw(params: WithdrawalParams): Promise<WithdrawalResult>;

  /**
   * Effectuer un retrait avec polling automatique
   */
  withdrawToWallet(params: WithdrawalParams): Promise<WithdrawalResult>;

  /**
   * Vérifier le statut d'un retrait
   */
  getWithdrawalStatus(withdrawalId: string): Promise<WithdrawalStatus>;

  /**
   * Attendre la complétion d'un retrait
   */
  waitForWithdrawalCompletion(withdrawalId: string, maxWaitTimeMs?: number, checkIntervalMs?: number): Promise<WithdrawalStatus>;

  /**
   * Ajouter une adresse à la whitelist
   */
  addToWhitelist(address: string, token: string, network?: string): Promise<boolean>;

  /**
   * Vérifier si une adresse est whitelistée
   */
  isWhitelisted(address: string, token: string): Promise<boolean>;

  /**
   * Obtenir les frais de retrait
   */
  getWithdrawalFees(token: string): Promise<number>;

  /**
   * Obtenir le minimum de retrait
   */
  getWithdrawalMinimum(token: string): Promise<number>;
}

/**
 * Erreurs spécifiques aux échanges
 */
export class ExchangeError extends Error {
  constructor(
    message: string,
    public code?: string,
    public exchange?: string
  ) {
    super(message);
    this.name = 'ExchangeError';
  }
}

/**
 * Erreur de solde insuffisant
 */
export class InsufficientBalanceError extends ExchangeError {
  constructor(token: string, available: number, required: number) {
    super(
      `Solde insuffisant pour ${token}. Disponible: ${available}, Requis: ${required}`,
      'INSUFFICIENT_BALANCE'
    );
    this.name = 'InsufficientBalanceError';
  }
}

/**
 * Erreur d'adresse non whitelistée
 */
export class AddressNotWhitelistedError extends ExchangeError {
  constructor(address: string, token: string) {
    super(
      `Adresse ${address} non whitelistée pour ${token}. Ajoutez-la à la whitelist avant de retirer.`,
      'ADDRESS_NOT_WHITELISTED'
    );
    this.name = 'AddressNotWhitelistedError';
  }
}

/**
 * Erreur de montant minimum
 */
export class MinimumAmountError extends ExchangeError {
  constructor(token: string, amount: number, minimum: number) {
    super(
      `Montant ${amount} trop faible pour ${token}. Minimum: ${minimum}`,
      'MINIMUM_AMOUNT'
    );
    this.name = 'MinimumAmountError';
  }
}
