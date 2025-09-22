import { ethers } from 'ethers';
import { logger } from '../core/logger.js';
import { getProvider } from '../core/rpc.js';
import { ERC20_MIN_ABI } from '../abis/erc20.js';
import { WalletManager, type WalletInfo } from '../core/wallet-manager.js';
import { BybitAdapter, type ExchangeConfig } from './bybit-adapter.js';
import { CONSTANTS, cfg } from '../config/env.js';

/**
 * Configuration pour la distribution Hub
 */
export interface HubDistributionConfig {
  // Configuration Bybit
  bybit: ExchangeConfig;
  
  // Adresse du wallet Hub (qui reçoit les fonds de Bybit)
  hubWalletPrivateKey: string;
  
  // Tokens à distribuer
  tokens: {
    usdc?: {
      amountPerWallet: number;
      totalAmount: number;
    };
    eth?: {
      amountPerWallet: number;
      totalAmount: number;
    };
  };
  
  // Configuration de distribution
  walletCount: number;
  randomizeAmounts?: boolean;
  minAmountVariation?: number; // Pourcentage de variation (ex: 0.1 = 10%)
  
  // Configuration réseau
  chainId: number;
  
  // Configuration des transactions
  batchSize?: number; // Nombre de transactions par batch
  gasLimit?: number;
  maxFeePerGas?: string;
}

/**
 * Résultat de la distribution
 */
export interface DistributionResult {
  success: boolean;
  totalDistributed: {
    usdc: number;
    eth: number;
  };
  transactions: {
    usdc: string[];
    eth: string[];
  };
  errors: string[];
}

/**
 * Gestionnaire de distribution Hub vers wallets multiples
 */
export class HubDistributor {
  private bybitAdapter: BybitAdapter;
  private hubWallet: ethers.Wallet;
  private walletManager: WalletManager;
  private provider: ethers.Provider;
  private config: HubDistributionConfig;

  constructor(config: HubDistributionConfig) {
    this.config = config;
    this.provider = getProvider(config.chainId);
    this.hubWallet = new ethers.Wallet(config.hubWalletPrivateKey, this.provider);
    this.bybitAdapter = new BybitAdapter(config.bybit);
    this.walletManager = new WalletManager(this.provider);

    logger.info({
      hubAddress: this.hubWallet.address,
      chainId: config.chainId,
      walletCount: config.walletCount,
      message: 'HubDistributor initialisé'
    });
  }

  /**
   * Exécuter la distribution complète : retrait Bybit → distribution on-chain
   */
  async executeFullDistribution(targetWallets: WalletInfo[]): Promise<DistributionResult> {
    const result: DistributionResult = {
      success: false,
      totalDistributed: { usdc: 0, eth: 0 },
      transactions: { usdc: [], eth: [] },
      errors: [],
    };

    try {
      // Étape 1: Retrait depuis Bybit vers le Hub
      logger.info({
        hubAddress: this.hubWallet.address,
        message: 'Début des retraits depuis Bybit vers le Hub'
      });

      await this.withdrawFromBybit();

      // Étape 2: Distribution on-chain depuis le Hub vers les wallets
      logger.info({
        walletCount: targetWallets.length,
        message: 'Début de la distribution on-chain'
      });

      const distributionResult = await this.distributeToWallets(targetWallets);
      
      // Combiner les résultats
      result.success = distributionResult.success;
      result.totalDistributed = distributionResult.totalDistributed;
      result.transactions = distributionResult.transactions;
      result.errors = distributionResult.errors;

      logger.info({
        success: result.success,
        totalDistributed: result.totalDistributed,
        transactionCount: {
          usdc: result.transactions.usdc.length,
          eth: result.transactions.eth.length,
        },
        errorCount: result.errors.length,
        message: 'Distribution complète terminée'
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.errors.push(`Erreur générale: ${errorMessage}`);
      logger.error({
        error: errorMessage,
        message: 'Erreur lors de la distribution complète'
      });
    }

    return result;
  }

  /**
   * Effectuer les retraits depuis Bybit vers le Hub
   */
  private async withdrawFromBybit(): Promise<void> {
    const { tokens } = this.config;
    const hubAddress = this.hubWallet.address;

    // Retrait USDC si configuré
    if (tokens.usdc) {
      try {
        logger.info({
          token: 'USDC',
          amount: tokens.usdc.totalAmount,
          hubAddress,
          message: 'Retrait USDC depuis Bybit'
        });

        const usdcResult = await this.bybitAdapter.withdraw({
          token: 'USDC',
          amount: tokens.usdc.totalAmount,
          address: hubAddress,
          network: 'ETH', // Adapter selon le réseau
        });

        if (!usdcResult.success) {
          throw new Error(`Retrait USDC échoué: ${usdcResult.error}`);
        }

        // Attendre la confirmation du retrait
        if (usdcResult.withdrawalId) {
          await this.bybitAdapter.waitForWithdrawalCompletion(usdcResult.withdrawalId);
        }

        logger.info({
          token: 'USDC',
          amount: tokens.usdc.totalAmount,
          txHash: usdcResult.txHash,
          message: 'Retrait USDC depuis Bybit confirmé'
        });

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error({
          token: 'USDC',
          error: errorMessage,
          message: 'Erreur lors du retrait USDC depuis Bybit'
        });
        throw error;
      }
    }

    // Retrait ETH si configuré
    if (tokens.eth) {
      try {
        logger.info({
          token: 'ETH',
          amount: tokens.eth.totalAmount,
          hubAddress,
          message: 'Retrait ETH depuis Bybit'
        });

        const ethResult = await this.bybitAdapter.withdraw({
          token: 'ETH',
          amount: tokens.eth.totalAmount,
          address: hubAddress,
          network: 'ETH',
        });

        if (!ethResult.success) {
          throw new Error(`Retrait ETH échoué: ${ethResult.error}`);
        }

        // Attendre la confirmation du retrait
        if (ethResult.withdrawalId) {
          await this.bybitAdapter.waitForWithdrawalCompletion(ethResult.withdrawalId);
        }

        logger.info({
          token: 'ETH',
          amount: tokens.eth.totalAmount,
          txHash: ethResult.txHash,
          message: 'Retrait ETH depuis Bybit confirmé'
        });

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error({
          token: 'ETH',
          error: errorMessage,
          message: 'Erreur lors du retrait ETH depuis Bybit'
        });
        throw error;
      }
    }
  }

  /**
   * Distribuer les fonds du Hub vers les wallets cibles
   */
  private async distributeToWallets(targetWallets: WalletInfo[]): Promise<DistributionResult> {
    const result: DistributionResult = {
      success: false,
      totalDistributed: { usdc: 0, eth: 0 },
      transactions: { usdc: [], eth: [] },
      errors: [],
    };

    // Calculer les montants par wallet
    const amounts = this.calculateDistributionAmounts(targetWallets.length);

    // Distribution USDC si configuré
    if (this.config.tokens.usdc) {
      try {
        const usdcResult = await this.distributeToken(
          'USDC',
          CONSTANTS.TOKENS.USDC,
          amounts.usdc,
          targetWallets
        );
        
        result.transactions.usdc = usdcResult.transactions;
        result.totalDistributed.usdc = usdcResult.totalDistributed;
        result.errors.push(...usdcResult.errors);

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        result.errors.push(`Erreur distribution USDC: ${errorMessage}`);
        logger.error({
          token: 'USDC',
          error: errorMessage,
          message: 'Erreur lors de la distribution USDC'
        });
      }
    }

    // Distribution ETH si configuré
    if (this.config.tokens.eth) {
      try {
        const ethResult = await this.distributeToken(
          'ETH',
          CONSTANTS.NATIVE_ADDRESS,
          amounts.eth,
          targetWallets
        );
        
        result.transactions.eth = ethResult.transactions;
        result.totalDistributed.eth = ethResult.totalDistributed;
        result.errors.push(...ethResult.errors);

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        result.errors.push(`Erreur distribution ETH: ${errorMessage}`);
        logger.error({
          token: 'ETH',
          error: errorMessage,
          message: 'Erreur lors de la distribution ETH'
        });
      }
    }

    result.success = result.errors.length === 0;
    return result;
  }

  /**
   * Distribuer un token spécifique vers les wallets
   */
  private async distributeToken(
    tokenSymbol: string,
    tokenAddress: string,
    amounts: number[],
    targetWallets: WalletInfo[]
  ): Promise<{ transactions: string[]; totalDistributed: number; errors: string[] }> {
    const transactions: string[] = [];
    const errors: string[] = [];
    let totalDistributed = 0;

    const batchSize = this.config.batchSize || 10;
    
    // Traiter par batches pour éviter de surcharger le réseau
    for (let i = 0; i < targetWallets.length; i += batchSize) {
      const batch = targetWallets.slice(i, i + batchSize);
      const batchAmounts = amounts.slice(i, i + batchSize);

      logger.info({
        token: tokenSymbol,
        batchIndex: Math.floor(i / batchSize) + 1,
        batchSize: batch.length,
        totalBatches: Math.ceil(targetWallets.length / batchSize),
        message: `Distribution batch ${tokenSymbol}`
      });

      // Exécuter les transactions du batch en parallèle
      const batchPromises = batch.map(async (wallet, index) => {
        const amount = batchAmounts[index];
        if (amount <= 0) return null;

        try {
          const txHash = await this.sendTokenToWallet(
            tokenSymbol,
            tokenAddress,
            wallet.address,
            amount
          );
          
          totalDistributed += amount;
          return txHash;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          errors.push(`Wallet ${wallet.address}: ${errorMessage}`);
          logger.error({
            token: tokenSymbol,
            wallet: wallet.address,
            amount,
            error: errorMessage,
            message: `Erreur distribution ${tokenSymbol}`
          });
          return null;
        }
      });

      // Attendre que toutes les transactions du batch soient envoyées
      const batchResults = await Promise.all(batchPromises);
      
      // Ajouter les transactions réussies
      batchResults.forEach(txHash => {
        if (txHash) {
          transactions.push(txHash);
        }
      });

      // Petite pause entre les batches pour éviter le rate limiting
      if (i + batchSize < targetWallets.length) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    return { transactions, totalDistributed, errors };
  }

  /**
   * Envoyer un token à un wallet spécifique
   */
  private async sendTokenToWallet(
    tokenSymbol: string,
    tokenAddress: string,
    walletAddress: string,
    amount: number
  ): Promise<string> {
    if (tokenSymbol === 'ETH') {
      // Transaction ETH native
      const tx = await this.hubWallet.sendTransaction({
        to: walletAddress,
        value: ethers.parseEther(amount.toString()),
        gasLimit: this.config.gasLimit || 21000,
      });

      logger.info({
        token: 'ETH',
        to: walletAddress,
        amount,
        txHash: tx.hash,
        message: 'Transaction ETH envoyée'
      });

      return tx.hash;
    } else {
      // Transaction ERC20
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_MIN_ABI, this.hubWallet);
      
      // Obtenir les décimales du token
      const decimals = await tokenContract.decimals();
      const amountWei = ethers.parseUnits(amount.toString(), decimals);

      const tx = await tokenContract.transfer(walletAddress, amountWei, {
        gasLimit: this.config.gasLimit || 100000,
      });

      logger.info({
        token: tokenSymbol,
        to: walletAddress,
        amount,
        txHash: tx.hash,
        message: `Transaction ${tokenSymbol} envoyée`
      });

      return tx.hash;
    }
  }

  /**
   * Calculer les montants de distribution pour chaque wallet
   */
  private calculateDistributionAmounts(walletCount: number): { usdc: number[]; eth: number[] } {
    const usdcAmounts: number[] = [];
    const ethAmounts: number[] = [];

    if (this.config.tokens.usdc) {
      if (this.config.randomizeAmounts) {
        // Distribution aléatoire
        const totalAmount = this.config.tokens.usdc.totalAmount;
        const minPerWallet = this.config.tokens.usdc.amountPerWallet * (1 - (this.config.minAmountVariation || 0.1));
        const maxPerWallet = this.config.tokens.usdc.amountPerWallet * (1 + (this.config.minAmountVariation || 0.1));
        
        usdcAmounts.push(...this.bybitAdapter.calculateRandomAmounts(
          totalAmount,
          walletCount,
          minPerWallet,
          maxPerWallet
        ));
      } else {
        // Distribution égale
        const amountPerWallet = this.config.tokens.usdc.amountPerWallet;
        usdcAmounts.push(...Array(walletCount).fill(amountPerWallet));
      }
    }

    if (this.config.tokens.eth) {
      if (this.config.randomizeAmounts) {
        // Distribution aléatoire
        const totalAmount = this.config.tokens.eth.totalAmount;
        const minPerWallet = this.config.tokens.eth.amountPerWallet * (1 - (this.config.minAmountVariation || 0.1));
        const maxPerWallet = this.config.tokens.eth.amountPerWallet * (1 + (this.config.minAmountVariation || 0.1));
        
        ethAmounts.push(...this.bybitAdapter.calculateRandomAmounts(
          totalAmount,
          walletCount,
          minPerWallet,
          maxPerWallet
        ));
      } else {
        // Distribution égale
        const amountPerWallet = this.config.tokens.eth.amountPerWallet;
        ethAmounts.push(...Array(walletCount).fill(amountPerWallet));
      }
    }

    logger.info({
      walletCount,
      usdcAmounts: usdcAmounts.length,
      ethAmounts: ethAmounts.length,
      usdcTotal: usdcAmounts.reduce((sum, amount) => sum + amount, 0),
      ethTotal: ethAmounts.reduce((sum, amount) => sum + amount, 0),
      message: 'Montants de distribution calculés'
    });

    return { usdc: usdcAmounts, eth: ethAmounts };
  }

  /**
   * Vérifier les balances du Hub
   */
  async checkHubBalances(): Promise<{ usdc: number; eth: number }> {
    const hubAddress = this.hubWallet.address;
    
    // Balance ETH native
    const ethBalance = await this.provider.getBalance(hubAddress);
    const ethBalanceEth = parseFloat(ethers.formatEther(ethBalance));

    // Balance USDC
    let usdcBalance = 0;
    try {
      const usdcContract = new ethers.Contract(CONSTANTS.TOKENS.USDC, ERC20_MIN_ABI, this.provider);
      const usdcBalanceWei = await usdcContract.balanceOf(hubAddress);
      const decimals = await usdcContract.decimals();
      usdcBalance = parseFloat(ethers.formatUnits(usdcBalanceWei, decimals));
    } catch (error) {
      logger.warn({
        error: error instanceof Error ? error.message : String(error),
        message: 'Impossible de récupérer le solde USDC du Hub'
      });
    }

    logger.info({
      hubAddress,
      ethBalance: ethBalanceEth,
      usdcBalance,
      message: 'Balances du Hub vérifiées'
    });

    return { usdc: usdcBalance, eth: ethBalanceEth };
  }

  /**
   * Attendre que les fonds arrivent sur le Hub (après retrait Bybit)
   */
  async waitForHubFunding(
    requiredUsdc: number,
    requiredEth: number,
    maxWaitTimeMs: number = 600000, // 10 minutes
    checkIntervalMs: number = 30000  // 30 secondes
  ): Promise<void> {
    const startTime = Date.now();
    
    logger.info({
      requiredUsdc,
      requiredEth,
      maxWaitTimeMs,
      message: 'Attente de l\'arrivée des fonds sur le Hub'
    });

    while (Date.now() - startTime < maxWaitTimeMs) {
      const balances = await this.checkHubBalances();
      
      if (balances.usdc >= requiredUsdc && balances.eth >= requiredEth) {
        logger.info({
          usdcBalance: balances.usdc,
          ethBalance: balances.eth,
          message: 'Fonds Hub suffisants pour la distribution'
        });
        return;
      }

      logger.info({
        usdcBalance: balances.usdc,
        ethBalance: balances.eth,
        requiredUsdc,
        requiredEth,
        message: 'Attente des fonds Hub...'
      });

      await new Promise(resolve => setTimeout(resolve, checkIntervalMs));
    }

    throw new Error(`Timeout d'attente des fonds Hub après ${maxWaitTimeMs}ms`);
  }

  /**
   * Calculer des parts aléatoires contrôlées
   */
  computeRandomParts(total: number, n: number, minEach: number): number[] {
    if (n * minEach > total) {
      throw new Error(`Impossible de répartir ${total} en ${n} parts de minimum ${minEach} chacune`);
    }

    const parts: number[] = [];
    let remaining = total;

    // Distribuer d'abord le minimum à chaque part
    for (let i = 0; i < n; i++) {
      parts[i] = minEach;
      remaining -= minEach;
    }

    // Distribuer le reste de manière aléatoire
    for (let i = 0; i < remaining; i++) {
      const randomIndex = Math.floor(Math.random() * n);
      parts[randomIndex] += 1;
    }

    // Vérifier que la somme est correcte
    const sum = parts.reduce((acc, part) => acc + part, 0);
    if (Math.abs(sum - total) > 0.0001) {
      throw new Error(`Erreur de répartition: somme attendue ${total}, obtenue ${sum}`);
    }

    return parts;
  }

  /**
   * Distribuer les tokens avec batching
   */
  async distributeTokensBatched(
    wallets: WalletInfo[], 
    amounts: { usdc: number; eth: number }
  ): Promise<Array<{ walletAddress: string; amount: number; token: string; txHash: string }>> {
    const results: Array<{ walletAddress: string; amount: number; token: string; txHash: string }> = [];
    const batchSize = cfg.BATCH_SIZE || 10;

    logger.info({
      totalWallets: wallets.length,
      batchSize,
      message: 'Début de la distribution par batches'
    });

    // Traiter par batches
    for (let i = 0; i < wallets.length; i += batchSize) {
      const batch = wallets.slice(i, i + batchSize);
      
      logger.info({
        batchIndex: Math.floor(i / batchSize) + 1,
        batchSize: batch.length,
        message: `Traitement du batch ${Math.floor(i / batchSize) + 1}`
      });

      // Traiter le batch en parallèle
      const batchPromises = batch.map(async (wallet) => {
        const walletResults = [];

        // Envoyer USDC
        if (amounts.usdc > 0) {
          try {
            const txHash = await this.sendTokenToWallet(wallet.address, amounts.usdc, 'USDC');
            walletResults.push({
              walletAddress: wallet.address,
              amount: amounts.usdc,
              token: 'USDC',
              txHash
            });
          } catch (error) {
            logger.error({
              wallet: wallet.address,
              token: 'USDC',
              amount: amounts.usdc,
              error: error instanceof Error ? error.message : String(error),
              message: 'Erreur lors de l\'envoi USDC'
            });
          }
        }

        // Envoyer ETH
        if (amounts.eth > 0) {
          try {
            const txHash = await this.sendTokenToWallet(wallet.address, amounts.eth, 'ETH');
            walletResults.push({
              walletAddress: wallet.address,
              amount: amounts.eth,
              token: 'ETH',
              txHash
            });
          } catch (error) {
            logger.error({
              wallet: wallet.address,
              token: 'ETH',
              amount: amounts.eth,
              error: error instanceof Error ? error.message : String(error),
              message: 'Erreur lors de l\'envoi ETH'
            });
          }
        }

        return walletResults;
      });

      const batchResults = await Promise.all(batchPromises);
      
      // Aplatir les résultats
      batchResults.forEach(walletResults => {
        results.push(...walletResults);
      });

      // Attendre un peu entre les batches pour éviter la surcharge RPC
      if (i + batchSize < wallets.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    logger.info({
      totalResults: results.length,
      successCount: results.length,
      message: 'Distribution par batches terminée'
    });

    return results;
  }

  /**
   * Dry-run de la distribution
   */
  async dryRunDistribution(wallets: WalletInfo[]): Promise<{
    totalUsdc: number;
    totalEth: number;
    allocations: Array<{
      walletAddress: string;
      usdcAmount: number;
      ethAmount: number;
    }>;
  }> {
    const { tokens } = this.config;
    const walletCount = wallets.length;

    // Calculer les montants par wallet
    const usdcPerWallet = tokens.usdc.amountPerWallet;
    const ethPerWallet = tokens.eth.amountPerWallet;

    // Calculer les allocations
    const allocations = wallets.map(wallet => ({
      walletAddress: wallet.address,
      usdcAmount: usdcPerWallet,
      ethAmount: ethPerWallet,
    }));

    const totalUsdc = usdcPerWallet * walletCount;
    const totalEth = ethPerWallet * walletCount;

    logger.info({
      walletCount,
      totalUsdc,
      totalEth,
      usdcPerWallet,
      ethPerWallet,
      message: 'Dry-run de la distribution calculé'
    });

    return {
      totalUsdc,
      totalEth,
      allocations
    };
  }

  /**
   * Obtenir les diagnostics détaillés
   */
  async getDiagnostics(): Promise<{
    hubBalances: { usdc: number; eth: number };
    walletCount: number;
    totalRequiredUsdc: number;
    totalRequiredEth: number;
    canDistribute: boolean;
    bybitStatus: 'connected' | 'disconnected' | 'error';
  }> {
    try {
      // Balances du Hub
      const hubBalances = await this.checkHubBalances();
      
      // Nombre de wallets
      const wallets = this.walletManager.getWallets();
      const walletCount = wallets.length;
      
      // Montants requis
      const { tokens } = this.config;
      const totalRequiredUsdc = tokens.usdc.amountPerWallet * walletCount;
      const totalRequiredEth = tokens.eth.amountPerWallet * walletCount;
      
      // Vérifier si on peut distribuer
      const canDistribute = hubBalances.usdc >= totalRequiredUsdc && hubBalances.eth >= totalRequiredEth;
      
      // Statut Bybit
      let bybitStatus: 'connected' | 'disconnected' | 'error' = 'disconnected';
      try {
        await this.bybitAdapter.getBalance('USDC');
        bybitStatus = 'connected';
      } catch {
        bybitStatus = 'error';
      }

      return {
        hubBalances,
        walletCount,
        totalRequiredUsdc,
        totalRequiredEth,
        canDistribute,
        bybitStatus
      };
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        message: 'Erreur lors de la récupération des diagnostics'
      });
      
      throw error;
    }
  }
}
