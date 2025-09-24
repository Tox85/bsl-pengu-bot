import { ethers } from 'ethers';
import { vi } from 'vitest';

/**
 * Mock factory pour les contrats ethers
 */
export class EthersMockFactory {
  /**
   * Créer un mock de contrat HubDistributor
   */
  static createHubDistributorMock(options: {
    distributeSuccess?: boolean;
    getBalanceSuccess?: boolean;
    estimateGasSuccess?: boolean;
    distributeRevert?: boolean;
    getBalanceRevert?: boolean;
    estimateGasRevert?: boolean;
    distributeError?: string;
    getBalanceError?: string;
    estimateGasError?: string;
    balance?: string;
    gasEstimate?: string;
  } = {}): ethers.Contract {
    const {
      distributeSuccess = true,
      getBalanceSuccess = true,
      estimateGasSuccess = true,
      distributeRevert = false,
      getBalanceRevert = false,
      estimateGasRevert = false,
      distributeError,
      getBalanceError,
      estimateGasError,
      balance = '1000000000000000000', // 1 ETH
      gasEstimate = '21000',
    } = options;

    const mockContract = {
      // Mock de la fonction distribute
      distribute: vi.fn().mockImplementation(async (recipients: string[], amounts: string[]) => {
        if (distributeRevert) {
          throw new Error('Transaction reverted');
        }
        if (distributeError) {
          throw new Error(distributeError);
        }
        if (!distributeSuccess) {
          throw new Error('Distribute failed');
        }
        
        return {
          hash: '0xabc123...',
          wait: vi.fn().mockResolvedValue({
            status: 1,
            transactionHash: '0xabc123...',
            blockNumber: 12345,
            gasUsed: '21000',
          }),
        };
      }),

      // Mock de la fonction getBalance
      getBalance: vi.fn().mockImplementation(async (address: string) => {
        if (getBalanceRevert) {
          throw new Error('Transaction reverted');
        }
        if (getBalanceError) {
          throw new Error(getBalanceError);
        }
        if (!getBalanceSuccess) {
          throw new Error('Get balance failed');
        }
        
        return ethers.parseEther(balance);
      }),

      // Mock de la fonction estimateGas
      estimateGas: {
        distribute: vi.fn().mockImplementation(async (recipients: string[], amounts: string[]) => {
          if (estimateGasRevert) {
            throw new Error('Transaction reverted');
          }
          if (estimateGasError) {
            throw new Error(estimateGasError);
          }
          if (!estimateGasSuccess) {
            throw new Error('Estimate gas failed');
          }
          
          return BigInt(gasEstimate);
        }),
      },

      // Mock de la fonction interface
      interface: {
        getFunction: vi.fn().mockReturnValue({
          name: 'distribute',
          inputs: [
            { name: 'recipients', type: 'address[]' },
            { name: 'amounts', type: 'uint256[]' },
          ],
          outputs: [],
        }),
      },

      // Mock de l'adresse du contrat
      target: '0x1234567890123456789012345678901234567890',

      // Mock du provider
      provider: {
        getTransactionCount: vi.fn().mockResolvedValue(0),
        getGasPrice: vi.fn().mockResolvedValue(ethers.parseUnits('20', 'gwei')),
        getFeeData: vi.fn().mockResolvedValue({
          gasPrice: ethers.parseUnits('20', 'gwei'),
          maxFeePerGas: ethers.parseUnits('25', 'gwei'),
          maxPriorityFeePerGas: ethers.parseUnits('2', 'gwei'),
        }),
        sendTransaction: vi.fn().mockResolvedValue({
          hash: '0xabc123...',
          wait: vi.fn().mockResolvedValue({
            status: 1,
            transactionHash: '0xabc123...',
            blockNumber: 12345,
            gasUsed: '21000',
          }),
        }),
      },
    };

    return mockContract as unknown as ethers.Contract;
  }

  /**
   * Créer un mock de contrat Uniswap V3
   */
  static createUniswapV3Mock(options: {
    swapSuccess?: boolean;
    addLiquiditySuccess?: boolean;
    collectSuccess?: boolean;
    swapRevert?: boolean;
    addLiquidityRevert?: boolean;
    collectRevert?: boolean;
    swapError?: string;
    addLiquidityError?: string;
    collectError?: string;
    gasEstimate?: string;
  } = {}): ethers.Contract {
    const {
      swapSuccess = true,
      addLiquiditySuccess = true,
      collectSuccess = true,
      swapRevert = false,
      addLiquidityRevert = false,
      collectRevert = false,
      swapError,
      addLiquidityError,
      collectError,
      gasEstimate = '150000',
    } = options;

    const mockContract = {
      // Mock de la fonction swap
      swap: vi.fn().mockImplementation(async (params: any) => {
        if (swapRevert) {
          throw new Error('Transaction reverted');
        }
        if (swapError) {
          throw new Error(swapError);
        }
        if (!swapSuccess) {
          throw new Error('Swap failed');
        }
        
        return {
          hash: '0xswap123...',
          wait: vi.fn().mockResolvedValue({
            status: 1,
            transactionHash: '0xswap123...',
            blockNumber: 12345,
            gasUsed: '150000',
          }),
        };
      }),

      // Mock de la fonction addLiquidity
      addLiquidity: vi.fn().mockImplementation(async (params: any) => {
        if (addLiquidityRevert) {
          throw new Error('Transaction reverted');
        }
        if (addLiquidityError) {
          throw new Error(addLiquidityError);
        }
        if (!addLiquiditySuccess) {
          throw new Error('Add liquidity failed');
        }
        
        return {
          hash: '0xlp123...',
          wait: vi.fn().mockResolvedValue({
            status: 1,
            transactionHash: '0xlp123...',
            blockNumber: 12345,
            gasUsed: '200000',
          }),
        };
      }),

      // Mock de la fonction collect
      collect: vi.fn().mockImplementation(async (params: any) => {
        if (collectRevert) {
          throw new Error('Transaction reverted');
        }
        if (collectError) {
          throw new Error(collectError);
        }
        if (!collectSuccess) {
          throw new Error('Collect failed');
        }
        
        return {
          hash: '0xcollect123...',
          wait: vi.fn().mockResolvedValue({
            status: 1,
            transactionHash: '0xcollect123...',
            blockNumber: 12345,
            gasUsed: '100000',
          }),
        };
      }),

      // Mock de la fonction estimateGas
      estimateGas: {
        swap: vi.fn().mockImplementation(async (params: any) => {
          if (swapRevert) {
            throw new Error('Transaction reverted');
          }
          if (swapError) {
            throw new Error(swapError);
          }
          if (!swapSuccess) {
            throw new Error('Estimate gas failed');
          }
          
          return BigInt(gasEstimate);
        }),
        addLiquidity: vi.fn().mockImplementation(async (params: any) => {
          if (addLiquidityRevert) {
            throw new Error('Transaction reverted');
          }
          if (addLiquidityError) {
            throw new Error(addLiquidityError);
          }
          if (!addLiquiditySuccess) {
            throw new Error('Estimate gas failed');
          }
          
          return BigInt('200000');
        }),
        collect: vi.fn().mockImplementation(async (params: any) => {
          if (collectRevert) {
            throw new Error('Transaction reverted');
          }
          if (collectError) {
            throw new Error(collectError);
          }
          if (!collectSuccess) {
            throw new Error('Estimate gas failed');
          }
          
          return BigInt('100000');
        }),
      },

      // Mock de l'adresse du contrat
      target: '0x1234567890123456789012345678901234567890',

      // Mock du provider
      provider: {
        getTransactionCount: vi.fn().mockResolvedValue(0),
        getGasPrice: vi.fn().mockResolvedValue(ethers.parseUnits('20', 'gwei')),
        getFeeData: vi.fn().mockResolvedValue({
          gasPrice: ethers.parseUnits('20', 'gwei'),
          maxFeePerGas: ethers.parseUnits('25', 'gwei'),
          maxPriorityFeePerGas: ethers.parseUnits('2', 'gwei'),
        }),
        sendTransaction: vi.fn().mockResolvedValue({
          hash: '0xabc123...',
          wait: vi.fn().mockResolvedValue({
            status: 1,
            transactionHash: '0xabc123...',
            blockNumber: 12345,
            gasUsed: '150000',
          }),
        }),
      },
    };

    return mockContract as unknown as ethers.Contract;
  }

  /**
   * Créer un mock de provider ethers
   */
  static createProviderMock(options: {
    getTransactionCountSuccess?: boolean;
    getGasPriceSuccess?: boolean;
    getFeeDataSuccess?: boolean;
    sendTransactionSuccess?: boolean;
    getTransactionCountError?: string;
    getGasPriceError?: string;
    getFeeDataError?: string;
    sendTransactionError?: string;
    transactionCount?: number;
    gasPrice?: string;
    feeData?: any;
  } = {}): ethers.Provider {
    const {
      getTransactionCountSuccess = true,
      getGasPriceSuccess = true,
      getFeeDataSuccess = true,
      sendTransactionSuccess = true,
      getTransactionCountError,
      getGasPriceError,
      getFeeDataError,
      sendTransactionError,
      transactionCount = 0,
      gasPrice = '20000000000',
      feeData = {
        gasPrice: ethers.parseUnits('20', 'gwei'),
        maxFeePerGas: ethers.parseUnits('25', 'gwei'),
        maxPriorityFeePerGas: ethers.parseUnits('2', 'gwei'),
      },
    } = options;

    const mockProvider = {
      getTransactionCount: vi.fn().mockImplementation(async (address: string, blockTag?: string) => {
        if (getTransactionCountError) {
          throw new Error(getTransactionCountError);
        }
        if (!getTransactionCountSuccess) {
          throw new Error('Get transaction count failed');
        }
        return transactionCount;
      }),

      getGasPrice: vi.fn().mockImplementation(async () => {
        if (getGasPriceError) {
          throw new Error(getGasPriceError);
        }
        if (!getGasPriceSuccess) {
          throw new Error('Get gas price failed');
        }
        return ethers.parseUnits(gasPrice, 'wei');
      }),

      getFeeData: vi.fn().mockImplementation(async () => {
        if (getFeeDataError) {
          throw new Error(getFeeDataError);
        }
        if (!getFeeDataSuccess) {
          throw new Error('Get fee data failed');
        }
        return feeData;
      }),

      sendTransaction: vi.fn().mockImplementation(async (signedTransaction: string) => {
        if (sendTransactionError) {
          throw new Error(sendTransactionError);
        }
        if (!sendTransactionSuccess) {
          throw new Error('Send transaction failed');
        }
        return {
          hash: '0xabc123...',
          wait: vi.fn().mockResolvedValue({
            status: 1,
            transactionHash: '0xabc123...',
            blockNumber: 12345,
            gasUsed: '21000',
          }),
        };
      }),

      getNetwork: vi.fn().mockResolvedValue({
        chainId: 8453,
        name: 'base',
      }),

      getBlockNumber: vi.fn().mockResolvedValue(12345),
    };

    return mockProvider as unknown as ethers.Provider;
  }
}
