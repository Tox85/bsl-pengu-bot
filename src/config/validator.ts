import { z } from 'zod';
import { logger } from '../core/logger.js';

/**
 * Validateur de configuration pour le mode multi-wallet
 */
export class ConfigValidator {
  private config: Record<string, any>;

  constructor(config: Record<string, any>) {
    this.config = config;
  }

  /**
   * Valider la configuration complète
   */
  validate(): { valid: boolean; errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validation des réseaux supportés
    this.validateNetworks(errors);
    
    // Validation des assets de retrait
    this.validateWithdrawAssets(errors, warnings);
    
    // Validation des montants
    this.validateAmounts(errors, warnings);
    
    // Validation des clés API
    this.validateApiKeys(errors);
    
    // Validation des wallets
    this.validateWallets(errors, warnings);
    
    // Validation des paramètres de distribution
    this.validateDistribution(errors, warnings);

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Valider les réseaux supportés
   */
  private validateNetworks(errors: string[]): void {
    const supportedNetworks = ['ARBITRUM', 'ETHEREUM', 'BASE'];
    const network = this.config.NETWORK_WITHDRAW || 'ARBITRUM';
    
    if (!supportedNetworks.includes(network)) {
      errors.push(`Réseau non supporté: ${network}. Réseaux supportés: ${supportedNetworks.join(', ')}`);
    }
  }

  /**
   * Valider les assets de retrait
   */
  private validateWithdrawAssets(errors: string[], warnings: string[]): void {
    const withdrawEnabled = this.config.WITHDRAW_ENABLED === 'true';
    const withdrawUsdc = this.config.WITHDRAW_ASSET_USDC === 'true';
    const withdrawEth = this.config.WITHDRAW_ASSET_ETH === 'true';
    
    if (withdrawEnabled) {
      if (!withdrawUsdc && !withdrawEth) {
        errors.push('Au moins un asset doit être activé pour le retrait (USDC ou ETH)');
      }
      
      if (!this.config.BYBIT_API_KEY || !this.config.BYBIT_API_SECRET) {
        errors.push('Clés API Bybit requises quand WITHDRAW_ENABLED=true');
      }
      
      if (!this.config.HUB_WALLET_PRIVATE_KEY && !this.config.MNEMONIC) {
        errors.push('HUB_WALLET_PRIVATE_KEY ou MNEMONIC requis pour le mode multi-wallet');
      }
    }
  }

  /**
   * Valider les montants
   */
  private validateAmounts(errors: string[], warnings: string[]): void {
    // Validation USDC
    if (this.config.WITHDRAW_ASSET_USDC === 'true') {
      const minUsdc = parseFloat(this.config.WITHDRAW_USDC_MIN || '0');
      const maxUsdc = parseFloat(this.config.WITHDRAW_USDC_MAX || '0');
      
      if (minUsdc <= 0) {
        errors.push('WITHDRAW_USDC_MIN doit être > 0');
      }
      
      if (maxUsdc <= 0) {
        errors.push('WITHDRAW_USDC_MAX doit être > 0');
      }
      
      if (minUsdc > maxUsdc) {
        errors.push('WITHDRAW_USDC_MIN ne peut pas être > WITHDRAW_USDC_MAX');
      }
    }

    // Validation ETH
    if (this.config.WITHDRAW_ASSET_ETH === 'true') {
      const minEth = parseFloat(this.config.WITHDRAW_ETH_MIN || '0');
      const maxEth = parseFloat(this.config.WITHDRAW_ETH_MAX || '0');
      
      if (minEth <= 0) {
        errors.push('WITHDRAW_ETH_MIN doit être > 0');
      }
      
      if (maxEth <= 0) {
        errors.push('WITHDRAW_ETH_MAX doit être > 0');
      }
      
      if (minEth > maxEth) {
        errors.push('WITHDRAW_ETH_MIN ne peut pas être > WITHDRAW_ETH_MAX');
      }
    }

    // Validation top-up ETH
    const topupEth = parseFloat(this.config.DISTRIB_TOPUP_ETH || '0');
    if (topupEth <= 0) {
      warnings.push('DISTRIB_TOPUP_ETH recommandé pour couvrir les frais de gas');
    }
  }

  /**
   * Valider les clés API
   */
  private validateApiKeys(errors: string[]): void {
    if (this.config.BYBIT_API_KEY) {
      if (this.config.BYBIT_API_KEY.length < 10) {
        errors.push('BYBIT_API_KEY semble invalide (trop courte)');
      }
    }
    
    if (this.config.BYBIT_API_SECRET) {
      if (this.config.BYBIT_API_SECRET.length < 10) {
        errors.push('BYBIT_API_SECRET semble invalide (trop courte)');
      }
    }
  }

  /**
   * Valider les wallets
   */
  private validateWallets(errors: string[], warnings: string[]): void {
    const walletCount = parseInt(this.config.WALLET_COUNT || '100');
    
    if (walletCount < 1 || walletCount > 200) {
      errors.push('WALLET_COUNT doit être entre 1 et 200');
    }
    
    if (walletCount > 50) {
      warnings.push(`WALLET_COUNT=${walletCount} élevé, considérez une exécution par batches`);
    }

    // Validation du mnémonique
    if (this.config.MNEMONIC) {
      const words = this.config.MNEMONIC.split(' ');
      if (words.length !== 12 && words.length !== 24) {
        errors.push('MNEMONIC doit contenir 12 ou 24 mots');
      }
    }

    // Validation de la clé privée Hub
    if (this.config.HUB_WALLET_PRIVATE_KEY) {
      if (!this.config.HUB_WALLET_PRIVATE_KEY.startsWith('0x') || this.config.HUB_WALLET_PRIVATE_KEY.length !== 66) {
        errors.push('HUB_WALLET_PRIVATE_KEY format invalide (doit commencer par 0x et faire 66 caractères)');
      }
    }
  }

  /**
   * Valider les paramètres de distribution
   */
  private validateDistribution(errors: string[], warnings: string[]): void {
    const slippage = parseInt(this.config.SLIPPAGE_BPS || '80');
    
    if (slippage < 10 || slippage > 1000) {
      warnings.push(`SLIPPAGE_BPS=${slippage} inhabituel (recommandé: 50-200)`);
    }

    // Validation des RPC
    if (!this.config.ARBITRUM_RPC) {
      warnings.push('ARBITRUM_RPC non configuré, utilisation de la valeur par défaut');
    }
    
    if (!this.config.ABSTRACT_RPC) {
      warnings.push('ABSTRACT_RPC non configuré, utilisation de la valeur par défaut');
    }
  }

  /**
   * Masquer les données sensibles dans les logs
   */
  static maskSensitiveData(config: Record<string, any>): Record<string, any> {
    const masked = { ...config };
    
    // Masquer les clés sensibles
    if (masked.MNEMONIC) {
      masked.MNEMONIC = masked.MNEMONIC.substring(0, 10) + '...';
    }
    
    if (masked.HUB_WALLET_PRIVATE_KEY) {
      masked.HUB_WALLET_PRIVATE_KEY = masked.HUB_WALLET_PRIVATE_KEY.substring(0, 10) + '...';
    }
    
    if (masked.BYBIT_API_KEY) {
      masked.BYBIT_API_KEY = masked.BYBIT_API_KEY.substring(0, 8) + '...';
    }
    
    if (masked.BYBIT_API_SECRET) {
      masked.BYBIT_API_SECRET = '***';
    }
    
    return masked;
  }

  /**
   * Valider et logger les résultats
   */
  static validateAndLog(config: Record<string, any>): boolean {
    const validator = new ConfigValidator(config);
    const result = validator.validate();
    
    const maskedConfig = ConfigValidator.maskSensitiveData(config);
    
    logger.info({
      config: maskedConfig,
      message: 'Validation de la configuration'
    });
    
    if (result.warnings.length > 0) {
      logger.warn({
        warnings: result.warnings,
        message: 'Avertissements de configuration'
      });
    }
    
    if (result.errors.length > 0) {
      logger.error({
        errors: result.errors,
        message: 'Erreurs de configuration'
      });
      return false;
    }
    
    logger.info({
      message: 'Configuration validée avec succès'
    });
    
    return true;
  }
}

/**
 * Schéma de validation Zod pour la configuration
 */
export const configSchema = z.object({
  // Multi-wallet
  MNEMONIC: z.string().optional(),
  WALLET_COUNT: z.number().int().min(1).max(200).default(100),
  HUB_WALLET_PRIVATE_KEY: z.string().optional(),
  MNEMONIC_INDEX_HUB: z.number().int().min(0).default(0),
  
  // Bybit
  BYBIT_API_KEY: z.string().optional(),
  BYBIT_API_SECRET: z.string().optional(),
  BYBIT_SANDBOX: z.boolean().default(false),
  BYBIT_TESTNET: z.boolean().default(false),
  
  // Réseaux
  NETWORK_WITHDRAW: z.enum(['ARBITRUM', 'ETHEREUM', 'BASE']).default('ARBITRUM'),
  ARBITRUM_RPC: z.string().url().optional(),
  ABSTRACT_RPC: z.string().url().optional(),
  
  // Retraits
  WITHDRAW_ENABLED: z.boolean().default(true),
  WITHDRAW_ASSET_USDC: z.boolean().default(true),
  WITHDRAW_ASSET_ETH: z.boolean().default(false),
  WITHDRAW_USDC_MIN: z.number().positive().default(10),
  WITHDRAW_USDC_MAX: z.number().positive().default(100),
  WITHDRAW_ETH_MIN: z.number().positive().default(0.01),
  WITHDRAW_ETH_MAX: z.number().positive().default(0.1),
  
  // Distribution
  DISTRIB_TOPUP_ETH: z.number().positive().default(0.0001),
  SLIPPAGE_BPS: z.number().int().min(10).max(1000).default(80),
  
  // Polling
  BYPASS_POLLING: z.boolean().default(false),
  POLLING_TIMEOUT_MS: z.number().int().positive().default(300000), // 5 minutes
  POLLING_INTERVAL_MS: z.number().int().positive().default(10000), // 10 secondes
});

/**
 * Mapping des réseaux Bybit
 */
export const BYBIT_NETWORK_MAP: Record<string, string> = {
  ARBITRUM: 'ARBITRUM',
  ETHEREUM: 'ETH',
  BASE: 'BASE',
};

/**
 * Validation rapide d'une configuration
 */
export function validateConfig(config: Record<string, any>): boolean {
  return ConfigValidator.validateAndLog(config);
}
