import { randomInt } from 'crypto';
import { JsonRpcProvider, Wallet, parseUnits } from 'ethers';
import { DISTRIBUTION_VARIANCE, NETWORKS } from './config.js';
import type { DistributionPlan, ExecutionResult, HubWalletState } from './types.js';
import { logger } from './logger.js';
import { fromWei } from './utils.js';

const MIN_SATELLITE_TRANSFER_WEI = parseUnits('0.0002', 18);

export class WalletHub {
  private readonly provider: JsonRpcProvider;
  private readonly hub: Wallet;
  private readonly satellites: Wallet[];

  constructor(state: HubWalletState) {
    this.provider = new JsonRpcProvider(NETWORKS.base.rpcUrl, NETWORKS.base.chainId);
    this.hub = new Wallet(state.hub.privateKey, this.provider);
    this.satellites = state.satellites.map((wallet) => new Wallet(wallet.privateKey, this.provider));
  }

  async getNetworkGasPrice(): Promise<bigint> {
    const feeData = await this.provider.getFeeData();
    if (feeData.maxFeePerGas) {
      return feeData.maxFeePerGas;
    }
    if (feeData.gasPrice) {
      return feeData.gasPrice;
    }
    return this.provider.getGasPrice();
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

  createDistributionPlan(totalWei: bigint, gasPriceWei: bigint): DistributionPlan[] {
    if (totalWei === 0n) return [];

    const gasCostPerTx = gasPriceWei * 21_000n;
    if (totalWei <= gasCostPerTx) {
      logger.warn('Hub balance insufficient to cover gas for any satellite funding');
      return [];
    }

    const minTransferWei =
      MIN_SATELLITE_TRANSFER_WEI > gasCostPerTx * 2n ? MIN_SATELLITE_TRANSFER_WEI : gasCostPerTx * 2n;

    let eligibleCount = Math.min(
      this.satellites.length,
      Number(totalWei / (gasCostPerTx + minTransferWei)) || 0,
    );

    while (eligibleCount > 0) {
      const distributionPool = totalWei - gasCostPerTx * BigInt(eligibleCount);
      if (distributionPool <= 0n) {
        eligibleCount -= 1;
        continue;
      }
      if (distributionPool / BigInt(eligibleCount) < minTransferWei) {
        eligibleCount -= 1;
        continue;
      }
      break;
    }

    const plan = this.satellites.map((satellite, index) => ({
      recipient: {
        label: `satellite-${index + 1}`,
        address: satellite.address,
        privateKey: satellite.privateKey,
      },
      amountWei: 0n,
    }));

    if (eligibleCount === 0) {
      logger.warn('Unable to allocate funds to satellites after reserving gas and minimum transfers');
      return plan;
    }

    const distributionPool = totalWei - gasCostPerTx * BigInt(eligibleCount);
    const guaranteed = minTransferWei * BigInt(eligibleCount);
    let remaining = distributionPool - guaranteed;
    if (remaining < 0n) {
      remaining = 0n;
    }

    const scale = 1_000_000n;
    const factors = Array.from({ length: eligibleCount }).map(() =>
      BigInt(Math.floor(this.randomFactor() * Number(scale))),
    );
    const totalFactor = factors.reduce((sum, factor) => sum + factor, 0n) || BigInt(eligibleCount);

    const extras = factors.map((factor) => (remaining * factor) / totalFactor);
    const allocatedExtras = extras.reduce((sum, amount) => sum + amount, 0n);
    let remainder = remaining - allocatedExtras;

    for (let index = 0; index < eligibleCount; index += 1) {
      let amountWei = minTransferWei + extras[index];
      if (remainder > 0n) {
        amountWei += 1n;
        remainder -= 1n;
      }
      plan[index].amountWei = amountWei;
    }

    return plan;
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
        const tx = await this.hub.sendTransaction({
          to: item.recipient.address,
          value: item.amountWei,
          gasPrice: gasPriceWei,
        });
        await tx.wait();
        fundedCount += 1;
        totalWei += item.amountWei;
        logger.debug({ txHash: tx.hash, recipient: item.recipient.address }, 'Satellite funded');
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
      const balance = await external.provider.getBalance(external.address);
      const gasLimit = 21000n; // Standard transfer gas limit
      const gasCost = gasLimit * gasPriceWei;
      const maxAmount = balance > gasCost ? balance - gasCost : 0n;
      const actualAmount = maxAmount < amountWei ? maxAmount : amountWei;
      
      if (actualAmount === 0n) {
        logger.warn({ 
          balance: fromWei(balance), 
          gasCost: fromWei(gasCost),
          gasPriceGwei: Number(gasPriceWei) / 1e9,
          gasLimit: Number(gasLimit)
        }, 'Insufficient balance for funding');
        return { success: false, error: new Error('Insufficient balance for funding') };
      }

      const tx = await external.sendTransaction({
        to: this.hub.address,
        value: actualAmount,
        gasPrice: gasPriceWei,
        gasLimit: gasLimit,
      });
      await tx.wait();
      logger.info(
        { txHash: tx.hash, from: external.address, amountEth: fromWei(actualAmount) },
        'Funded hub directly from base wallet',
      );
      return { success: true, txHash: tx.hash };
    } catch (error) {
      logger.error({ err: error }, 'Failed to fund hub from external wallet');
      return { success: false, error: error as Error };
    }
  }
}
