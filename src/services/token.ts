import { ethers } from 'ethers';
import { CONSTANTS } from '../config/env.js';
import { logger, logError } from '../core/logger.js';
import { withRetryRpc, withRetryTransaction } from '../core/retry.js';
import { createSigner, getProvider, getGasPrice, estimateGasLimit } from '../core/rpc.js';
import { ERC20_MIN_ABI } from '../abis/erc20.js';

// ABI minimal pour WETH
const WETH_ABI = [
  'function withdraw(uint256 wad) external',
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)'
];

// Service de gestion des tokens
export class TokenService {
  private wethContract: ethers.Contract;

  constructor() {
    const provider = getProvider(CONSTANTS.CHAIN_IDS.ABSTRACT);
    this.wethContract = new ethers.Contract(
      CONSTANTS.TOKENS.WETH,
      WETH_ABI,
      provider
    );
  }

  // Unwrap WETH vers ETH natif
  async unwrapWETH(
    amountHuman: string,
    privateKey: string,
    options: { dryRun?: boolean } = {}
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const { dryRun = false } = options;

    try {
      logger.info({
        amountHuman,
        wethAddress: CONSTANTS.TOKENS.WETH,
        message: 'Unwrap WETH vers ETH natif'
      });

      if (dryRun) {
        logger.info({
          amountHuman,
          message: 'DRY_RUN: Unwrap WETH simulé'
        });
        return { success: true };
      }

      // Créer le signer
      const signer = await createSigner(privateKey, CONSTANTS.CHAIN_IDS.ABSTRACT);
      const wallet = await signer.getAddress();

      // Vérifier le solde WETH
      const wethBalance = await withRetryRpc(async () => {
        return await this.wethContract.balanceOf(wallet);
      });

      const decimals = await withRetryRpc(async () => {
        return await this.wethContract.decimals();
      });

      const amountWei = ethers.parseUnits(amountHuman, decimals);

      if (wethBalance < amountWei) {
        throw new Error(`Solde WETH insuffisant. Disponible: ${ethers.formatUnits(wethBalance, decimals)}, Requis: ${amountHuman}`);
      }

      // Obtenir le solde ETH avant
      const ethBalanceBefore = await withRetryRpc(async () => {
        return await signer.provider!.getBalance(wallet);
      });

      // Estimer le gas
      const gasLimit = await estimateGasLimit(
        this.wethContract.connect(signer),
        'withdraw',
        [amountWei],
        { value: 0n }
      );

      // Obtenir le gas price
      const gasPrice = await getGasPrice(signer.provider! as any);

      // Exécuter l'unwrap
      const tx = await withRetryTransaction(async () => {
        return await this.wethContract.connect(signer).withdraw(amountWei, {
          gasLimit,
          gasPrice,
        });
      });

      logger.info({
        txHash: tx.hash,
        message: 'Transaction unwrap WETH envoyée'
      });

      // Attendre la confirmation
      const receipt = await tx.wait();

      if (!receipt) {
        throw new Error('Transaction unwrap WETH échouée');
      }

      // Vérifier le solde ETH après
      const ethBalanceAfter = await withRetryRpc(async () => {
        return await signer.provider!.getBalance(wallet);
      });

      const ethReceived = ethBalanceAfter - ethBalanceBefore;

      logger.info({
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        wethUnwrapped: amountHuman,
        ethReceived: ethers.formatEther(ethReceived),
        message: 'WETH unwrap exécuté avec succès'
      });

      return {
        success: true,
        txHash: receipt.hash,
      };

    } catch (error) {
      logError(error, { 
        amountHuman,
        wethAddress: CONSTANTS.TOKENS.WETH,
      });
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // Obtenir le solde d'un token
  async getTokenBalance(
    tokenAddress: string,
    walletAddress: string,
    chainId: number
  ): Promise<{ balance: bigint; decimals: number; symbol?: string }> {
    try {
      const provider = getProvider(chainId);
      const token = new ethers.Contract(tokenAddress, ERC20_MIN_ABI, provider);
      
      const [balance, decimals] = await Promise.all([
        withRetryRpc(async () => token.balanceOf(walletAddress)),
        withRetryRpc(async () => token.decimals())
      ]);

      return {
        balance: BigInt(balance),
        decimals: Number(decimals),
      };
    } catch (error) {
      logError(error, { tokenAddress, walletAddress, chainId });
      throw error;
    }
  }

  // Obtenir le solde ETH natif
  async getNativeBalance(
    walletAddress: string,
    chainId: number
  ): Promise<bigint> {
    try {
      const provider = getProvider(chainId);
      return await withRetryRpc(async () => {
        return await provider.getBalance(walletAddress);
      });
    } catch (error) {
      logError(error, { walletAddress, chainId });
      throw error;
    }
  }
}

// Instance singleton du service de tokens
export const tokenService = new TokenService();
