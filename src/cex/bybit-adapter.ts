import ccxt from 'ccxt';
import { logger } from '../core/logger.js';
import {
  ExchangeAdapter,
  ExchangeConfig,
  WithdrawalResult,
  WithdrawalParams,
  WithdrawalStatus,
  BalanceInfo,
  ExchangeError,
  InsufficientBalanceError,
  AddressNotWhitelistedError,
  MinimumAmountError,
} from './types.js';
import { BYBIT_NETWORK_MAP } from '../config/validator.js';

/**
 * Adaptateur pour l'échange Bybit
 * Utilise ccxt pour communiquer avec l'API Bybit
 */
export class BybitAdapter implements ExchangeAdapter {
  private client: any;
  private config: ExchangeConfig;

  constructor(config: ExchangeConfig) {
    this.config = config;
    
    // Initialiser le client ccxt pour Bybit
    this.client = new ccxt.bybit({
      apiKey: config.apiKey,
      secret: config.apiSecret,
      sandbox: config.sandbox || false,
      testnet: config.testnet || false,
      options: {
        defaultType: 'spot', // Utiliser le trading spot par défaut
      },
    });

    logger.info({
      exchange: 'Bybit',
      sandbox: config.sandbox,
      testnet: config.testnet,
      message: 'Adaptateur Bybit initialisé'
    });
  }

  /**
   * Obtenir le paramètre réseau pour Bybit
   */
  private getNetworkParam(network: string): string {
    const networkParam = BYBIT_NETWORK_MAP[network];
    if (!networkParam) {
      throw new ExchangeError(`Réseau non supporté: ${network}. Réseaux supportés: ${Object.keys(BYBIT_NETWORK_MAP).join(', ')}`);
    }
    return networkParam;
  }

  /**
   * Obtenir le solde d'un token
   */
  async getBalance(token: string): Promise<BalanceInfo> {
    try {
      const balance = await this.client.fetchBalance();
      const tokenBalance = balance[token];
      
      if (!tokenBalance) {
        return {
          token,
          available: 0,
          total: 0,
          frozen: 0,
        };
      }

      return {
        token,
        available: tokenBalance.free || 0,
        total: tokenBalance.total || 0,
        frozen: tokenBalance.used || 0,
      };
    } catch (error) {
      logger.error({
        token,
        error: error instanceof Error ? error.message : String(error),
        message: 'Erreur lors de la récupération du solde'
      });
      throw new ExchangeError(
        `Erreur lors de la récupération du solde ${token}: ${error instanceof Error ? error.message : String(error)}`,
        'BALANCE_ERROR',
        'Bybit'
      );
    }
  }

  /**
   * Effectuer un retrait vers une adresse
   */
  async withdraw(params: WithdrawalParams): Promise<WithdrawalResult> {
    const { token, amount, address, network = 'ETH', tag, dryRun } = params;
    
    try {
      logger.info({
        token,
        amount,
        address,
        network,
        message: 'Initiation du retrait Bybit'
      });

      // En mode dry-run, simuler les vérifications
      if (dryRun) {
        logger.info({
          token,
          amount,
          address,
          network,
          message: 'DRY-RUN: Vérifications simulées'
        });
        
        // Retourner un résultat simulé
        return {
          withdrawalId: `dry-run-${Date.now()}`,
          status: 'pending',
          txHash: null,
          amount,
          token,
          address,
          network,
          timestamp: new Date().toISOString(),
        };
      }

      // Vérifier le solde disponible
      const balance = await this.getBalance(token);
      if (balance.available < amount) {
        throw new InsufficientBalanceError(token, balance.available, amount);
      }

      // Vérifier le montant minimum
      const minimum = await this.getWithdrawalMinimum(token);
      if (amount < minimum) {
        throw new MinimumAmountError(token, amount, minimum);
      }

      // Obtenir le paramètre réseau pour Bybit
      const networkParam = this.getNetworkParam(network);

      // Effectuer le retrait
      const result = await this.client.withdraw(token, amount, address, tag, {
        network: networkParam,
        chainType: 'EVM',
        // Autres paramètres spécifiques à Bybit si nécessaire
      });

      logger.info({
        withdrawalId: result.id,
        token,
        amount,
        address,
        message: 'Retrait Bybit initié avec succès'
      });

      return {
        success: true,
        withdrawalId: result.id,
        amount,
        token,
        address,
        txHash: result.txid,
        status: result.status || 'pending',
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Gestion des erreurs spécifiques
      if (errorMessage.toLowerCase().includes('whitelist') || 
          errorMessage.toLowerCase().includes('address not allowed')) {
        throw new AddressNotWhitelistedError(address, token);
      }

      if (errorMessage.toLowerCase().includes('insufficient') || 
          errorMessage.toLowerCase().includes('balance')) {
        const balance = await this.getBalance(token);
        throw new InsufficientBalanceError(token, balance.available, amount);
      }

      logger.error({
        token,
        amount,
        address,
        error: errorMessage,
        message: 'Erreur lors du retrait Bybit'
      });

      return {
        success: false,
        amount,
        token,
        address,
        error: errorMessage,
      };
    }
  }

  /**
   * Vérifier le statut d'un retrait
   */
  async getWithdrawalStatus(withdrawalId: string): Promise<WithdrawalStatus> {
    try {
      const withdrawals = await this.client.fetchWithdrawals(undefined, undefined, 100);
      
      const withdrawal = withdrawals.find((w: any) => w.id === withdrawalId);
      
      if (!withdrawal) {
        throw new ExchangeError(`Retrait ${withdrawalId} non trouvé`, 'WITHDRAWAL_NOT_FOUND', 'Bybit');
      }

      return {
        withdrawalId,
        status: this.mapStatus(withdrawal.status),
        amount: withdrawal.amount,
        token: withdrawal.currency,
        address: withdrawal.address,
        txHash: withdrawal.txid,
      };

    } catch (error) {
      logger.error({
        withdrawalId,
        error: error instanceof Error ? error.message : String(error),
        message: 'Erreur lors de la vérification du statut de retrait'
      });
      
      throw new ExchangeError(
        `Erreur lors de la vérification du statut: ${error instanceof Error ? error.message : String(error)}`,
        'STATUS_ERROR',
        'Bybit'
      );
    }
  }

  /**
   * Ajouter une adresse à la whitelist
   * Note: Cette fonctionnalité peut ne pas être disponible via l'API publique
   */
  async addToWhitelist(address: string, token: string, network: string = 'ETH'): Promise<boolean> {
    try {
      // Note: L'API publique de Bybit ne permet pas toujours d'ajouter des adresses à la whitelist
      // Cette fonction peut nécessiter une implémentation spécifique ou être gérée manuellement
      
      logger.warn({
        address,
        token,
        network,
        message: 'Ajout à la whitelist non supporté via API publique. Ajout manuel requis.'
      });

      // Pour l'instant, retourner false pour indiquer que l'ajout automatique n'est pas supporté
      return false;

      // Si l'API le supporte, implémenter ici :
      // const result = await this.client.privatePostV5AssetWithdrawCreateAddress({
      //   coin: token,
      //   chainType: network,
      //   address,
      //   // autres paramètres requis
      // });
      // return result.success;

    } catch (error) {
      logger.error({
        address,
        token,
        network,
        error: error instanceof Error ? error.message : String(error),
        message: 'Erreur lors de l\'ajout à la whitelist'
      });
      return false;
    }
  }

  /**
   * Vérifier si une adresse est whitelistée
   */
  async isWhitelisted(address: string, token: string): Promise<boolean> {
    try {
      // Récupérer la liste des adresses whitelistées
      const addresses = await this.client.fetchWithdrawalAddresses(token);
      
      return addresses.some((addr: any) => addr.address.toLowerCase() === address.toLowerCase());

    } catch (error) {
      logger.error({
        address,
        token,
        error: error instanceof Error ? error.message : String(error),
        message: 'Erreur lors de la vérification de la whitelist'
      });
      
      // En cas d'erreur, supposer que l'adresse n'est pas whitelistée
      return false;
    }
  }

  /**
   * Obtenir les frais de retrait pour un token
   */
  async getWithdrawalFees(token: string): Promise<number> {
    try {
      const currencies = await this.client.fetchCurrencies();
      const currency = currencies[token];
      
      if (!currency) {
        throw new ExchangeError(`Token ${token} non supporté`, 'TOKEN_NOT_SUPPORTED', 'Bybit');
      }

      // Les frais sont généralement dans currency.fees.withdraw
      return currency.fees?.withdraw?.cost || 0;

    } catch (error) {
      logger.error({
        token,
        error: error instanceof Error ? error.message : String(error),
        message: 'Erreur lors de la récupération des frais de retrait'
      });
      
      // Retourner des frais par défaut en cas d'erreur
      return 0.001; // Frais par défaut pour ETH
    }
  }

  /**
   * Obtenir le montant minimum de retrait
   */
  async getWithdrawalMinimum(token: string): Promise<number> {
    try {
      const currencies = await this.client.fetchCurrencies();
      const currency = currencies[token];
      
      if (!currency) {
        throw new ExchangeError(`Token ${token} non supporté`, 'TOKEN_NOT_SUPPORTED', 'Bybit');
      }

      // Le minimum est généralement dans currency.limits.withdraw.min
      return currency.limits?.withdraw?.min || 0.001;

    } catch (error) {
      logger.error({
        token,
        error: error instanceof Error ? error.message : String(error),
        message: 'Erreur lors de la récupération du minimum de retrait'
      });
      
      // Retourner un minimum par défaut en cas d'erreur
      return 0.001; // Minimum par défaut
    }
  }

  /**
   * Obtenir le solde total disponible pour distribution
   */
  async getTotalAvailableBalance(tokens: string[]): Promise<Record<string, number>> {
    const balances: Record<string, number> = {};
    
    for (const token of tokens) {
      try {
        const balance = await this.getBalance(token);
        balances[token] = balance.available;
      } catch (error) {
        logger.warn({
          token,
          error: error instanceof Error ? error.message : String(error),
          message: 'Impossible de récupérer le solde pour ce token'
        });
        balances[token] = 0;
      }
    }
    
    return balances;
  }

  /**
   * Calculer des montants aléatoires pour distribution
   */
  calculateRandomAmounts(
    totalAmount: number,
    walletCount: number,
    minPerWallet: number = 0.001,
    maxPerWallet?: number
  ): number[] {
    if (walletCount <= 0) {
      return [];
    }

    if (totalAmount < minPerWallet * walletCount) {
      throw new Error(`Montant total insuffisant. Minimum requis: ${minPerWallet * walletCount}`);
    }

    const amounts: number[] = [];
    let remainingAmount = totalAmount;
    
    // Si un seul wallet, lui donner tout
    if (walletCount === 1) {
      return [totalAmount];
    }

    // Générer des montants aléatoires pour les N-1 premiers wallets
    for (let i = 0; i < walletCount - 1; i++) {
      const maxForThisWallet = Math.min(
        remainingAmount - (walletCount - i - 1) * minPerWallet,
        maxPerWallet || remainingAmount
      );
      
      const minForThisWallet = Math.min(minPerWallet, maxForThisWallet);
      
      if (minForThisWallet >= maxForThisWallet) {
        amounts.push(minForThisWallet);
      } else {
        const randomAmount = minForThisWallet + Math.random() * (maxForThisWallet - minForThisWallet);
        amounts.push(Math.round(randomAmount * 1000000) / 1000000); // Arrondir à 6 décimales
      }
      
      remainingAmount -= amounts[i];
    }

    // Le dernier wallet reçoit le reste
    amounts.push(Math.round(remainingAmount * 1000000) / 1000000);

    logger.info({
      totalAmount,
      walletCount,
      amounts,
      message: 'Montants aléatoires calculés pour distribution'
    });

    return amounts;
  }

  /**
   * Mapper les statuts de retrait ccxt vers nos statuts
   */
  private mapStatus(ccxtStatus: string): 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' {
    const status = ccxtStatus.toLowerCase();
    
    switch (status) {
      case 'pending':
      case 'waiting':
        return 'pending';
      case 'processing':
      case 'confirming':
        return 'processing';
      case 'completed':
      case 'finished':
      case 'done':
        return 'completed';
      case 'failed':
      case 'rejected':
        return 'failed';
      case 'cancelled':
      case 'canceled':
        return 'cancelled';
      default:
        return 'pending';
    }
  }

  /**
   * Attendre qu'un retrait soit complété
   */
  async waitForWithdrawalCompletion(
    withdrawalId: string,
    maxWaitTimeMs: number = 300000, // 5 minutes par défaut
    checkIntervalMs: number = 10000  // 10 secondes par défaut
  ): Promise<WithdrawalStatus> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitTimeMs) {
      const status = await this.getWithdrawalStatus(withdrawalId);
      
      if (status.status === 'completed') {
        logger.info({
          withdrawalId,
          message: 'Retrait complété'
        });
        return status;
      }
      
      if (status.status === 'failed' || status.status === 'cancelled') {
        throw new ExchangeError(
          `Retrait ${withdrawalId} échoué avec le statut: ${status.status}`,
          'WITHDRAWAL_FAILED',
          'Bybit'
        );
      }
      
      logger.info({
        withdrawalId,
        status: status.status,
        message: 'Attente de la finalisation du retrait'
      });
      
      await new Promise(resolve => setTimeout(resolve, checkIntervalMs));
    }
    
    throw new ExchangeError(
      `Timeout d'attente pour le retrait ${withdrawalId}`,
      'WITHDRAWAL_TIMEOUT',
      'Bybit'
    );
  }

  /**
   * Méthode de retrait avec polling automatique
   */
  async withdrawToWallet(params: WithdrawalParams & {
    awaitCompletion?: boolean;
    pollingTimeoutMs?: number;
    pollingIntervalMs?: number;
  }): Promise<WithdrawalResult> {
    const { awaitCompletion = false, pollingTimeoutMs, pollingIntervalMs, ...withdrawalParams } = params;
    
    // Effectuer le retrait
    const result = await this.withdraw(withdrawalParams);
    
    // Si demandé, attendre la complétion
    if (awaitCompletion) {
      const finalStatus = await this.waitForWithdrawalCompletion(
        result.withdrawalId,
        pollingTimeoutMs || 300000,
        pollingIntervalMs || 10000
      );
      
      return {
        ...result,
        status: finalStatus.status,
        txHash: finalStatus.txHash,
      };
    }
    
    return result;
  }
}

/**
 * Factory pour créer une instance de BybitAdapter
 */
export function createBybitAdapter(config: ExchangeConfig): BybitAdapter {
  return new BybitAdapter(config);
}
