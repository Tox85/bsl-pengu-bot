import { ethers } from 'ethers';
import { logger } from '../core/logger.js';
import { getProvider } from '../core/rpc.js';
import { CONSTANTS } from '../config/env.js';

// ABI pour lire la factory d'un pool
const POOL_FACTORY_ABI = [
  'function factory() external view returns (address)'
];

// ABI pour lire la factory d'un router
const ROUTER_FACTORY_ABI = [
  'function factory() external view returns (address)'
];

// ABI pour lire la factory d'un position manager
const NPM_FACTORY_ABI = [
  'function factory() external view returns (address)'
];

export interface FactoryCheckResult {
  poolFactory: string;
  routerFactory: string;
  npmFactory: string;
  isCompatible: boolean;
  mismatches: string[];
}

export class FactoryChecker {
  private provider: ethers.Provider;

  constructor() {
    this.provider = getProvider(CONSTANTS.CHAIN_IDS.ABSTRACT);
  }

  async checkFactories(
    poolAddress: string,
    routerAddress: string,
    npmAddress: string
  ): Promise<FactoryCheckResult> {
    logger.info({
      poolAddress,
      routerAddress,
      npmAddress,
      message: 'Vérification des factories'
    });

    // Lire les factories
    const poolContract = new ethers.Contract(poolAddress, POOL_FACTORY_ABI, this.provider);
    const routerContract = new ethers.Contract(routerAddress, ROUTER_FACTORY_ABI, this.provider);
    const npmContract = new ethers.Contract(npmAddress, NPM_FACTORY_ABI, this.provider);

    const [poolFactory, routerFactory, npmFactory] = await Promise.all([
      poolContract.factory(),
      routerContract.factory(),
      npmContract.factory()
    ]);

    logger.info({
      poolFactory,
      routerFactory,
      npmFactory,
      message: 'Factories lues'
    });

    // Vérifier la compatibilité
    const mismatches: string[] = [];
    
    if (routerFactory.toLowerCase() !== poolFactory.toLowerCase()) {
      mismatches.push(`Router factory (${routerFactory}) !== Pool factory (${poolFactory})`);
    }
    
    if (npmFactory.toLowerCase() !== poolFactory.toLowerCase()) {
      mismatches.push(`NPM factory (${npmFactory}) !== Pool factory (${poolFactory})`);
    }

    const isCompatible = mismatches.length === 0;

    if (!isCompatible) {
      logger.error({
        poolAddress,
        poolFactory,
        routerAddress,
        routerFactory,
        npmAddress,
        npmFactory,
        mismatches,
        message: 'Factory mismatch détecté'
      });
    } else {
      logger.info({
        message: 'Toutes les factories sont compatibles'
      });
    }

    return {
      poolFactory,
      routerFactory,
      npmFactory,
      isCompatible,
      mismatches
    };
  }

  async checkWithOverrides(
    poolAddress: string,
    routerOverride?: string,
    npmOverride?: string,
    factoryOverride?: string
  ): Promise<FactoryCheckResult> {
    // Utiliser les overrides ou les adresses par défaut
    const routerAddress = routerOverride || CONSTANTS.UNIV3.SWAP_ROUTER_02;
    const npmAddress = npmOverride || CONSTANTS.UNIV3.NF_POSITION_MANAGER;

    if (factoryOverride) {
      // Si factory override fournie, on considère que tout est compatible
      logger.info({
        factoryOverride,
        message: 'Factory override fournie, skip de la vérification'
      });
      
      return {
        poolFactory: factoryOverride,
        routerFactory: factoryOverride,
        npmFactory: factoryOverride,
        isCompatible: true,
        mismatches: []
      };
    }

    return this.checkFactories(poolAddress, routerAddress, npmAddress);
  }
}

export const factoryChecker = new FactoryChecker();
