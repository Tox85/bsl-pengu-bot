import { JsonRpcProvider, Wallet, parseUnits } from 'ethers';
import { NETWORKS } from './config.js';
import type { DistributionPlan, ExecutionResult, HubWalletState } from './types.js';
import { logger } from './logger.js';

export class WalletHub {
  private readonly provider: JsonRpcProvider;
  private readonly hub: Wallet;
  private readonly satellites: Wallet[];

  constructor(state: HubWalletState) {
    this.provider = new JsonRpcProvider(NETWORKS.base.rpcUrl, NETWORKS.base.chainId);
    this.hub = new Wallet(state.hub.privateKey, this.provider);
    this.satellites = state.satellites.map((wallet) => new Wallet(wallet.privateKey, this.provider));
  }

  async getHubBalance(): Promise<bigint> {
    const balance = await this.provider.getBalance(this.hub.address);
    logger.debug({ balance: balance.toString() }, 'Hub balance fetched');
    return balance;
  }

  createDistributionPlan(totalWei: bigint): DistributionPlan[] {
    const amountPerWallet = totalWei / BigInt(this.satellites.length);
    return this.satellites.map((satellite, index) => ({
      recipient: {
        label: `satellite-${index + 1}`,
        address: satellite.address,
        privateKey: satellite.privateKey,
      },
      amountWei: amountPerWallet,
    }));
  }

  async executeDistribution(plan: DistributionPlan[], gasPriceWei: bigint): Promise<ExecutionResult<void>> {
    try {
      for (const item of plan) {
        if (item.amountWei === 0n) continue;
        const tx = await this.hub.sendTransaction({
          to: item.recipient.address,
          value: item.amountWei,
          gasPrice: gasPriceWei,
        });
        await tx.wait();
        logger.info({ txHash: tx.hash, recipient: item.recipient.address }, 'Satellite funded');
      }
      return { success: true };
    } catch (error) {
      logger.error({ err: error }, 'Failed to execute distribution');
      return { success: false, error: error as Error };
    }
  }

  async topUpHubFromSatellites(minBalanceWei: bigint, gasPriceWei: bigint) {
    for (const satellite of this.satellites) {
      const balance = await this.provider.getBalance(satellite.address);
      if (balance < minBalanceWei) continue;
      const tx = await satellite.sendTransaction({
        to: this.hub.address,
        value: balance - parseUnits('0.0001', 18),
        gasPrice: gasPriceWei,
      });
      await tx.wait();
      logger.info({ from: satellite.address, txHash: tx.hash }, 'Returned residual funds to hub');
    }
  }
}
