import { ethers } from 'ethers';
import { cfg, CONSTANTS } from '../config/env.js';
import { logger } from './logger.js';

// Providers RPC
export const baseProvider = new ethers.JsonRpcProvider(cfg.BASE_RPC_URL);
export const abstractProvider = new ethers.JsonRpcProvider(cfg.ABSTRACT_RPC_URL);

// Fonction utilitaire pour obtenir le provider selon la chain
export const getProvider = (chainId: number): ethers.JsonRpcProvider => {
  switch (chainId) {
    case CONSTANTS.CHAIN_IDS.BASE:
      return baseProvider;
    case CONSTANTS.CHAIN_IDS.ABSTRACT:
      return abstractProvider;
    default:
      throw new Error(`Chain ID non supporté: ${chainId}`);
  }
};

// Fonction utilitaire pour créer un signer
export const createSigner = async (privateKey: string, chainId: number): Promise<ethers.Wallet> => {
  const provider = getProvider(chainId);
  const wallet = new ethers.Wallet(privateKey, provider);
  
  // Obtenir le chainId du réseau
  const network = await provider.getNetwork();
  
  // Log obligatoire au démarrage
  logger.info({
    chainId: Number(network.chainId),
    signer: wallet.address,
    message: 'Signer prêt'
  });
  
  return wallet;
};

// Fonction utilitaire pour vérifier la connexion RPC
export const checkRpcConnection = async (chainId: number): Promise<boolean> => {
  try {
    const provider = getProvider(chainId);
    const network = await provider.getNetwork();
    
    if (Number(network.chainId) !== chainId) {
      logger.warn({
        expected: chainId,
        actual: Number(network.chainId),
        message: 'Chain ID mismatch'
      });
      return false;
    }
    
    const blockNumber = await provider.getBlockNumber();
    logger.info({
      chainId,
      blockNumber,
      message: 'Connexion RPC OK'
    });
    
    return true;
  } catch (error) {
    logger.error({
      chainId,
      error: error instanceof Error ? error.message : 'Unknown error',
      message: 'Erreur de connexion RPC'
    });
    return false;
  }
};

// Fonction utilitaire pour obtenir le gas price avec buffer
export const getGasPrice = async (provider: ethers.JsonRpcProvider): Promise<bigint> => {
  try {
    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice || 0n;
    
    // Appliquer le multiplicateur de gas
    const adjustedGasPrice = (gasPrice * BigInt(Math.floor(cfg.GAS_LIMIT_MULTIPLIER * 100))) / 100n;
    
    // Limiter le gas price maximum
    const maxGasPrice = BigInt(cfg.MAX_GAS_PRICE_GWEI) * 10n ** 9n; // Convertir GWEI en wei
    
    return adjustedGasPrice > maxGasPrice ? maxGasPrice : adjustedGasPrice;
  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : 'Unknown error',
      message: 'Erreur lors de la récupération du gas price'
    });
    throw error;
  }
};

// Fonction utilitaire pour estimer le gas limit
export const estimateGasLimit = async (
  contract: ethers.Contract,
  method: string,
  args: unknown[],
  overrides: ethers.TransactionRequest = {}
): Promise<bigint> => {
  try {
    const gasEstimate = await contract[method].estimateGas(...args, overrides);
    const adjustedGasLimit = (gasEstimate * BigInt(Math.floor(cfg.GAS_LIMIT_MULTIPLIER * 100))) / 100n;
    
    logger.debug({
      method,
      gasEstimate: gasEstimate.toString(),
      adjustedGasLimit: adjustedGasLimit.toString(),
      message: 'Gas limit estimé'
    });
    
    return adjustedGasLimit;
  } catch (error) {
    logger.error({
      method,
      args,
      error: error instanceof Error ? error.message : 'Unknown error',
      message: 'Erreur lors de l\'estimation du gas limit'
    });
    throw error;
  }
};
