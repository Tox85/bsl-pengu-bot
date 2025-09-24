import { randomInt } from 'crypto';
import { JsonRpcProvider, Wallet, parseUnits } from 'ethers';
import { DISTRIBUTION_VARIANCE, NETWORKS } from './config.js';
import type { DistributionPlan, ExecutionResult, HubWalletState } from './types.js';
import { logger } from './logger.js';
import { fromWei } from './utils.js';

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

  private randomFactor(): number {
    const rand = randomInt(0, 1_000_000) / 1_000_000;
    return DISTRIBUTION_VARIANCE.minFactor + rand * (DISTRIBUTION_VARIANCE.maxFactor - DISTRIBUTION_VARIANCE.minFactor);
  }

  createDistributionPlan(totalWei: bigint): DistributionPlan[] {
    if (totalWei === 0n) return [];
    const scale = 1_000_000n;
    const factors = this.satellites.map(() => BigInt(Math.floor(this.randomFactor() * Number(scale))));
    const totalFactor = factors.reduce((sum, factor) => sum + factor, 0n) || BigInt(this.satellites.length);

    const provisional = factors.map((factor) => (totalWei * factor) / totalFactor);
    const allocated = provisional.reduce((sum, amount) => sum + amount, 0n);
    let remainder = totalWei - allocated;

    const plan = provisional.map((amountWei) => {
      if (remainder > 0n) {
        remainder -= 1n;
        return amountWei + 1n;
      }
      return amountWei;
    });

    return this.satellites.map((satellite, index) => ({
      recipient: {
        label: `satellite-${index + 1}`,
        address: satellite.address,
        privateKey: satellite.privateKey,
      },
      amountWei: plan[index],
    }));
  }

  async executeDistribution(plan: DistributionPlan[], gasPriceWei: bigint): Promise<ExecutionResult<void>> {
    if (plan.length === 0) {
      logger.info('No satellites funded this cycle (empty plan)');
      return { success: true };
    }

    let fundedCount = 0;
    let totalWei = 0n;
    try {
      for (const item of plan) {
        if (item.amountWei === 0n) continue;
        
        // Vérifier le nonce pour éviter les conflits
        const currentNonce = await this.hub.getNonce();
        const tx = await this.hub.sendTransaction({
          to: item.recipient.address,
          value: item.amountWei,
          gasPrice: gasPriceWei,
          nonce: currentNonce,
        });
        await tx.wait();
        fundedCount += 1;
        totalWei += item.amountWei;
        logger.debug({ txHash: tx.hash, recipient: item.recipient.address, nonce: currentNonce }, 'Satellite funded');
      }
      if (fundedCount > 0) {
        logger.info(
          { fundedCount, totalEth: fromWei(totalWei) },
          'Satellite distribution completed',
        );
      } else {
        logger.info('Distribution plan contained only zero-value transfers');
      }
      return { success: true };
    } catch (error) {
      logger.error({ err: error }, 'Failed to execute distribution');
      return { success: false, error: error as Error };
    }
  }

  async topUpHubFromSatellites(minBalanceWei: bigint, gasPriceWei: bigint) {
    let returned = 0;
    let totalWei = 0n;
    for (const satellite of this.satellites) {
      const balance = await this.provider.getBalance(satellite.address);
      if (balance < minBalanceWei) continue;
      const tx = await satellite.sendTransaction({
        to: this.hub.address,
        value: balance - parseUnits('0.0001', 18),
        gasPrice: gasPriceWei,
      });
      await tx.wait();
      returned += 1;
      totalWei += balance - parseUnits('0.0001', 18);
      logger.debug({ from: satellite.address, txHash: tx.hash }, 'Returned residual funds to hub');
    }
    if (returned > 0) {
      logger.info(
        { returnedCount: returned, totalEth: fromWei(totalWei) },
        'Residual funds consolidated back to hub',
      );
    }
  }

  async fundHubFromExternal(privateKey: string, amountWei: bigint, gasPriceWei: bigint): Promise<ExecutionResult<void>> {
    try {
      const external = new Wallet(privateKey, this.provider);
      const tx = await external.sendTransaction({
        to: this.hub.address,
        value: amountWei,
        gasPrice: gasPriceWei,
      });
      await tx.wait();
      logger.info(
        { txHash: tx.hash, from: external.address, amountEth: fromWei(amountWei) },
        'Funded hub directly from base wallet',
      );
      return { success: true, txHash: tx.hash };
    } catch (error) {
      logger.error({ err: error }, 'Failed to fund hub from external wallet');
      return { success: false, error: error as Error };
    }
  }
}
