import { ethers } from 'ethers';
import { logger } from './logger.js';
import { getProvider } from './rpc.js';

/**
 * Interface pour les informations d'un wallet
 */
export interface WalletInfo {
  address: string;
  wallet: any; // ethers.Wallet ou ethers.HDNodeWallet
  index: number;
  nonce: number;
}

/**
 * Interface pour les paramètres de création de wallet
 */
export interface WalletCreationParams {
  mnemonic: string;
  index: number;
  provider?: ethers.Provider;
}

/**
 * Gestionnaire de wallets multiples avec support des nonces
 * Permet de créer et gérer plusieurs wallets dérivés d'une phrase mnémonique
 */
export class WalletManager {
  private wallets: Map<string, WalletInfo> = new Map();
  private nonceMap: Map<string, number> = new Map();
  private nonceLocks: Map<string, Promise<void>> = new Map();
  private provider: ethers.Provider;

  constructor(provider?: ethers.Provider) {
    this.provider = provider || getProvider(8453); // Base par défaut
  }

  /**
   * Créer un wallet à partir d'une clé privée
   */
  addWallet(privateKey: string, index?: number): WalletInfo {
    const wallet = new ethers.Wallet(privateKey, this.provider);
    const address = wallet.address;
    
    const walletInfo: WalletInfo = {
      address,
      wallet,
      index: index || this.wallets.size,
      nonce: 0,
    };

    this.wallets.set(address, walletInfo);
    logger.info({
      address,
      index: walletInfo.index,
      message: 'Wallet ajouté via clé privée'
    });

    return walletInfo;
  }

  /**
   * Créer un wallet à partir d'un mnémonique et d'un index
   */
  createWalletFromMnemonic(params: WalletCreationParams): WalletInfo {
    const { mnemonic, index, provider } = params;
    
    // Utiliser ethers v6 syntax pour créer le wallet avec le chemin de dérivation
    const derivationPath = `m/44'/60'/0'/0/${index}`;
    const hdNode = ethers.HDNodeWallet.fromPhrase(mnemonic, derivationPath);
    const wallet = new ethers.Wallet(hdNode.privateKey, provider || this.provider);
    const address = wallet.address;
    
    const walletInfo: WalletInfo = {
      address,
      wallet,
      index,
      nonce: 0,
    };

    this.wallets.set(address, walletInfo);
    logger.info({
      address,
      index,
      message: 'Wallet créé depuis mnémonique'
    });

    return walletInfo;
  }

  /**
   * Obtenir un wallet par son adresse
   */
  getWallet(address: string): WalletInfo | undefined {
    return this.wallets.get(address.toLowerCase());
  }

  /**
   * Obtenir tous les wallets gérés
   */
  getWallets(): WalletInfo[] {
    return Array.from(this.wallets.values());
  }

  /**
   * Obtenir les adresses de tous les wallets
   */
  getWalletAddresses(): string[] {
    return Array.from(this.wallets.keys());
  }

  /**
   * Obtenir le nombre de wallets gérés
   */
  getWalletCount(): number {
    return this.wallets.size;
  }

  /**
   * Obtenir le nonce pour un wallet avec gestion de la concurrence
   */
  async getNonce(walletAddress: string): Promise<number> {
    const address = walletAddress.toLowerCase();
    
    // Attendre qu'il n'y ait pas de verrou actif pour ce wallet
    if (this.nonceLocks.has(address)) {
      await this.nonceLocks.get(address);
    }

    // Créer un nouveau verrou
    let resolveLock: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      resolveLock = resolve;
    });
    this.nonceLocks.set(address, lockPromise);

    try {
      const walletInfo = this.wallets.get(address);
      if (!walletInfo) {
        throw new Error(`Wallet non trouvé: ${address}`);
      }

      // Obtenir le nonce actuel depuis le réseau
      const currentNonce = await this.provider.getTransactionCount(address, 'pending');
      
      // Utiliser le nonce réseau s'il est plus élevé que notre compteur local
      const storedNonce = this.nonceMap.get(address) || 0;
      const nextNonce = Math.max(currentNonce, storedNonce);
      
      // Mettre à jour le compteur local
      this.nonceMap.set(address, nextNonce + 1);
      walletInfo.nonce = nextNonce;

      logger.debug({
        address,
        networkNonce: currentNonce,
        storedNonce,
        nextNonce,
        message: 'Nonce calculé'
      });

      return nextNonce;
    } finally {
      // Libérer le verrou
      resolveLock!();
      this.nonceLocks.delete(address);
    }
  }

  /**
   * Marquer un nonce comme utilisé (après envoi d'une transaction)
   */
  markNonceUsed(walletAddress: string): void {
    const address = walletAddress.toLowerCase();
    const storedNonce = this.nonceMap.get(address) || 0;
    
    // Le nonce est déjà incrémenté dans getNonce, pas besoin de le faire ici
    logger.debug({
      address,
      usedNonce: storedNonce - 1,
      nextNonce: storedNonce,
      message: 'Nonce marqué comme utilisé'
    });
  }

  /**
   * Réinitialiser le nonce d'un wallet (en cas d'erreur)
   */
  async resetNonce(walletAddress: string): Promise<void> {
    const address = walletAddress.toLowerCase();
    
    // Attendre qu'il n'y ait pas de verrou actif
    if (this.nonceLocks.has(address)) {
      await this.nonceLocks.get(address);
    }

    // Obtenir le nonce actuel depuis le réseau
    const currentNonce = await this.provider.getTransactionCount(address, 'pending');
    this.nonceMap.set(address, currentNonce);

    const walletInfo = this.wallets.get(address);
    if (walletInfo) {
      walletInfo.nonce = currentNonce;
    }

    logger.info({
      address,
      resetToNonce: currentNonce,
      message: 'Nonce réinitialisé depuis le réseau'
    });
  }

  /**
   * Créer plusieurs wallets à partir d'un mnémonique
   */
  createMultipleWallets(mnemonic: string, count: number, startIndex: number = 0): WalletInfo[] {
    const wallets: WalletInfo[] = [];
    
    for (let i = 0; i < count; i++) {
      const index = startIndex + i;
      const walletInfo = this.createWalletFromMnemonic({
        mnemonic,
        index,
        provider: this.provider,
      });
      wallets.push(walletInfo);
    }

    logger.info({
      count: wallets.length,
      startIndex,
      endIndex: startIndex + count - 1,
      message: 'Wallets multiples créés'
    });

    return wallets;
  }

  /**
   * Vérifier si un wallet existe
   */
  hasWallet(address: string): boolean {
    return this.wallets.has(address.toLowerCase());
  }

  /**
   * Supprimer un wallet
   */
  removeWallet(address: string): boolean {
    const addressLower = address.toLowerCase();
    const removed = this.wallets.delete(addressLower);
    
    if (removed) {
      this.nonceMap.delete(addressLower);
      this.nonceLocks.delete(addressLower);
      
      logger.info({
        address: addressLower,
        message: 'Wallet supprimé'
      });
    }

    return removed;
  }

  /**
   * Nettoyer tous les wallets
   */
  clear(): void {
    const count = this.wallets.size;
    this.wallets.clear();
    this.nonceMap.clear();
    this.nonceLocks.clear();
    
    logger.info({
      clearedCount: count,
      message: 'Tous les wallets ont été supprimés'
    });
  }

  /**
   * Obtenir des statistiques sur les wallets
   */
  getStats(): {
    totalWallets: number;
    addresses: string[];
    nonceStats: Record<string, number>;
  } {
    return {
      totalWallets: this.wallets.size,
      addresses: Array.from(this.wallets.keys()),
      nonceStats: Object.fromEntries(this.nonceMap),
    };
  }

  /**
   * Valider un mnémonique
   */
  static validateMnemonic(mnemonic: string): boolean {
    try {
      ethers.Wallet.fromPhrase(mnemonic);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Générer un mnémonique aléatoire
   */
  static generateMnemonic(): string {
    return ethers.Wallet.createRandom().mnemonic!.phrase;
  }
}

/**
 * Instance singleton du WalletManager
 * Peut être utilisée globalement ou instanciée séparément
 */
export const walletManager = new WalletManager();
