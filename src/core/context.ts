/**
 * Contexte centralisé pour éviter la redondance des signers
 */

import { ethers } from 'ethers';
import { CONSTANTS } from '../config/env.js';
import { getProvider } from './rpc.js';

// Helper pour convertir les valeurs en booléen
export function toBool(value: any): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true';
  }
  return Boolean(value);
}

export interface BotContext {
  // Providers
  providerBase: ethers.JsonRpcProvider;
  providerAbstract: ethers.JsonRpcProvider;
  
  // Signers
  signerBase: ethers.Wallet;
  signerAbstract: ethers.Wallet;
  
  // Wallet info
  walletAddress: string;
  privateKey: string;
  
  // Options
  autoGasTopUp: boolean;
  fresh: boolean;
  dryRun: boolean;
  
  // Gas settings
  minNativeOnDest?: string;
  gasTopUpTarget?: string;
  
  // Overrides d'adresses
  routerOverride?: string;
  npmOverride?: string;
  factoryOverride?: string;
}

export function buildContext(params: {
  privateKey: string;
  autoGasTopUp?: boolean;
  fresh?: boolean;
  dryRun?: boolean;
  minNativeOnDest?: string;
  gasTopUpTarget?: string;
  routerOverride?: string;
  npmOverride?: string;
  factoryOverride?: string;
}): BotContext {
  // Validation de la clé privée
  if (!params.privateKey.startsWith('0x') || params.privateKey.length !== 66) {
    throw new Error('Format de clé privée invalide: doit commencer par 0x et faire 66 caractères');
  }

  // Créer les providers
  const providerBase = getProvider(CONSTANTS.CHAIN_IDS.BASE);
  const providerAbstract = getProvider(CONSTANTS.CHAIN_IDS.ABSTRACT);

  // Créer le wallet et les signers
  const wallet = new ethers.Wallet(params.privateKey);
  const signerBase = wallet.connect(providerBase);
  const signerAbstract = wallet.connect(providerAbstract);

  return {
    providerBase,
    providerAbstract,
    signerBase,
    signerAbstract,
    walletAddress: wallet.address,
    privateKey: params.privateKey,
    autoGasTopUp: params.autoGasTopUp !== undefined ? toBool(params.autoGasTopUp) : CONSTANTS.AUTO_GAS_TOPUP,
    fresh: params.fresh !== undefined ? toBool(params.fresh) : false,
    dryRun: params.dryRun !== undefined ? toBool(params.dryRun) : CONSTANTS.DRY_RUN,
    minNativeOnDest: params.minNativeOnDest,
    gasTopUpTarget: params.gasTopUpTarget,
    routerOverride: params.routerOverride,
    npmOverride: params.npmOverride,
    factoryOverride: params.factoryOverride,
  };
}
