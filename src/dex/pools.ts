import { ethers } from 'ethers';
import { CONSTANTS } from '../config/env.js';
import { logger, logError } from '../core/logger.js';
import { withRetryRpc } from '../core/retry.js';
import { getProvider } from '../core/rpc.js';
import { UNIV3_FACTORY_ABI, UNIV3_POOL_ABI } from '../abis/index.js';
import type { PoolInfo, PoolDiscoveryParams } from './types.js';

// Service de découverte de pools
export class PoolDiscoveryService {
  private factory: ethers.Contract;

  constructor() {
    const provider = getProvider(CONSTANTS.CHAIN_IDS.ABSTRACT);
    this.factory = new ethers.Contract(
      CONSTANTS.UNIV3.FACTORY,
      UNIV3_FACTORY_ABI,
      provider
    );
  }

  // Découvrir le meilleur pool pour une paire de tokens
  async discoverBestPool(params: PoolDiscoveryParams): Promise<PoolInfo | null> {
    const { tokenA, tokenB, feeTiers } = params;

    logger.info({
      tokenA,
      tokenB,
      feeTiers,
      message: 'Recherche du meilleur pool'
    });

    let bestPool: PoolInfo | null = null;
    let maxLiquidity = 0n;

    // Essayer chaque fee tier
    for (const fee of feeTiers) {
      try {
        const poolAddress = await this.getPoolAddress(tokenA, tokenB, fee);
        
        if (poolAddress === ethers.ZeroAddress) {
          logger.debug({
            tokenA,
            tokenB,
            fee,
            message: 'Pool inexistant pour ce fee tier'
          });
          continue;
        }

        const poolInfo = await this.getPoolInfo(poolAddress);
        
        if (poolInfo.liquidity > maxLiquidity) {
          maxLiquidity = poolInfo.liquidity;
          bestPool = poolInfo;
        }

        logger.debug({
          poolAddress,
          fee,
          liquidity: poolInfo.liquidity.toString(),
          message: 'Pool trouvé'
        });

      } catch (error) {
        logError(error, { tokenA, tokenB, fee });
        continue;
      }
    }

    if (bestPool) {
      logger.info({
        poolAddress: bestPool.address,
        token0: bestPool.token0,
        token1: bestPool.token1,
        fee: bestPool.fee,
        liquidity: bestPool.liquidity.toString(),
        message: 'Meilleur pool trouvé'
      });
    } else {
      logger.warn({
        tokenA,
        tokenB,
        message: 'Aucun pool trouvé'
      });
    }

    return bestPool;
  }

  // Obtenir l'adresse d'un pool
  private async getPoolAddress(
    tokenA: string,
    tokenB: string,
    fee: number
  ): Promise<string> {
    return await withRetryRpc(async () => {
      return await this.factory.getPool(tokenA, tokenB, fee);
    });
  }

  // Obtenir les informations d'un pool
  private async getPoolInfo(poolAddress: string): Promise<PoolInfo> {
    const provider = getProvider(CONSTANTS.CHAIN_IDS.ABSTRACT);
    const pool = new ethers.Contract(poolAddress, UNIV3_POOL_ABI, provider);

    const [slot0, liquidity, tickSpacing, fee, token0, token1] = await withRetryRpc(async () => {
      return await Promise.all([
        pool.slot0(),
        pool.liquidity(),
        pool.tickSpacing(),
        pool.fee(),
        pool.token0(),
        pool.token1(),
      ]);
    });

    return {
      address: poolAddress,
      token0,
      token1,
      fee: Number(fee),
      tickSpacing: Number(tickSpacing),
      liquidity: BigInt(liquidity),
      sqrtPriceX96: BigInt(slot0.sqrtPriceX96),
      tick: Number(slot0.tick),
    };
  }

  // Vérifier si un pool existe
  async poolExists(tokenA: string, tokenB: string, fee: number): Promise<boolean> {
    try {
      const poolAddress = await this.getPoolAddress(tokenA, tokenB, fee);
      return poolAddress !== ethers.ZeroAddress;
    } catch (error) {
      logError(error, { tokenA, tokenB, fee });
      return false;
    }
  }

  // Obtenir tous les pools disponibles pour une paire
  async getAllPools(params: PoolDiscoveryParams): Promise<PoolInfo[]> {
    const { tokenA, tokenB, feeTiers } = params;
    const pools: PoolInfo[] = [];

    for (const fee of feeTiers) {
      try {
        const poolAddress = await this.getPoolAddress(tokenA, tokenB, fee);
        
        if (poolAddress !== ethers.ZeroAddress) {
          const poolInfo = await this.getPoolInfo(poolAddress);
          pools.push(poolInfo);
        }
      } catch (error) {
        logError(error, { tokenA, tokenB, fee });
        continue;
      }
    }

    // Trier par liquidité décroissante
    pools.sort((a, b) => Number(b.liquidity - a.liquidity));

    logger.info({
      tokenA,
      tokenB,
      poolsFound: pools.length,
      message: 'Pools disponibles trouvés'
    });

    return pools;
  }
}

// Instance singleton du service de découverte de pools
export const poolDiscoveryService = new PoolDiscoveryService();
