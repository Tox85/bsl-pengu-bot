# 🐛 GitHub Issues - Bot BSL.PENGU

## 🔴 Critical Issues (P0)

### Issue #1: Fix Direct LP Mode Token Approvals
**Labels:** `bug`, `critical`, `lp`, `direct-mode`  
**Priority:** P0  
**Estimated Effort:** 2-3 days  

**Description:**
The direct LP mode fails with "execution reverted" error when creating positions. Analysis shows this is due to missing token approvals before position creation.

**Current Behavior:**
```bash
node dist/cli/run.js direct --pair PENGU/USDC --amount0 0.3 --amount1 0.5 --range 5 --dry-run false
# Results in: "execution reverted (no data present; likely require(false) occurred)"
```

**Expected Behavior:**
Direct LP mode should successfully create positions with existing tokens on Abstract.

**Root Cause:**
- Token approvals not checked before `mint()` call
- No automatic approval handling in direct mode
- Missing approval verification in `createPosition()`

**Solution:**
Add token approval checks and automatic approval handling in `src/lp/v3.ts`:
```typescript
// Check and approve tokens before minting
const token0Approval = await this.checkTokenApproval(token0, npmAddress, amount0Desired, signer);
const token1Approval = await this.checkTokenApproval(token1, npmAddress, amount1Desired, signer);

if (!token0Approval) {
  await this.approveToken(token0, npmAddress, amount0Desired, signer);
}
if (!token1Approval) {
  await this.approveToken(token1, npmAddress, amount1Desired, signer);
}
```

**Files to Modify:**
- `src/lp/v3.ts` (lines 97-150)
- `test/lp.test.ts` (add approval tests)

---

### Issue #2: Fix Test Suite Ethers.js Mocking
**Labels:** `tests`, `critical`, `mocking`  
**Priority:** P0  
**Estimated Effort:** 1-2 days  

**Description:**
5 out of 7 tests are failing due to incomplete ethers.js mocking in Vitest configuration.

**Current Behavior:**
```bash
npm test
# Results in: "No 'JsonRpcProvider' export is defined on the 'ethers' mock"
```

**Root Cause:**
- Incomplete ethers.js mocking in `vitest.config.ts`
- Missing `JsonRpcProvider` and `Interface` mocks
- Tests expect real ethers objects but get undefined

**Solution:**
Update `vitest.config.ts` with proper ethers.js mocking:
```typescript
vi.mock('ethers', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    JsonRpcProvider: vi.fn().mockImplementation(() => ({
      getNetwork: vi.fn().mockResolvedValue({ chainId: 2741 }),
      getBalance: vi.fn().mockResolvedValue('1000000000000000000'),
    })),
    Interface: vi.fn().mockImplementation(() => ({
      getEvent: vi.fn().mockReturnValue({ topicHash: '0x...' }),
    })),
  };
});
```

**Files to Modify:**
- `vitest.config.ts`
- `test/bridge.test.ts`
- `test/lp.test.ts`

---

### Issue #3: Fix TypeScript Compilation Errors
**Labels:** `typescript`, `critical`, `compilation`  
**Priority:** P0  
**Estimated Effort:** 3-5 days  

**Description:**
56 TypeScript compilation errors prevent proper build and deployment.

**Current Behavior:**
```bash
npx tsc --noEmit
# Results in 56 errors across 14 files
```

**Critical Errors:**
- Duplicate exports in `src/bridge/index.ts`
- Missing properties: `gasUsed`, `error` in result types
- Null safety issues with receipts and providers
- API mismatches with Li.Fi SDK

**Solution:**
1. Fix duplicate exports by using explicit re-exports
2. Add missing properties to result interfaces
3. Add null checks and proper type guards
4. Update Li.Fi SDK integration

**Files to Modify:**
- `src/bridge/index.ts`
- `src/bridge/lifi.ts`
- `src/orchestrator/types.ts`
- `src/lp/v3.ts`
- `src/dex/swap.ts`

---

## 🟡 Important Issues (P1)

### Issue #4: Implement WalletManager for Multi-Wallet Support
**Labels:** `feature`, `scaling`, `wallets`  
**Priority:** P1  
**Estimated Effort:** 1-2 weeks  

**Description:**
Current architecture only supports single wallet. Need to implement WalletManager to support 100 wallets concurrently.

**Current Behavior:**
- Single private key from environment variable
- No concurrent wallet management
- No nonce management for multiple wallets

**Expected Behavior:**
- Support 100 wallets from single mnemonic
- Concurrent wallet operations
- Proper nonce management per wallet

**Solution:**
Create `WalletManager` class in `src/core/wallet-manager.ts`:
```typescript
export class WalletManager {
  private wallets: Map<string, ethers.Wallet> = new Map();
  private nonceManager: Map<string, number> = new Map();
  private mutex: Map<string, Mutex> = new Map();

  async createWalletFromMnemonic(mnemonic: string, index: number): Promise<ethers.Wallet> {
    const path = `m/44'/60'/0'/0/${index}`;
    const wallet = ethers.Wallet.fromPhrase(mnemonic, path, provider);
    this.wallets.set(wallet.address, wallet);
    this.mutex.set(wallet.address, new Mutex());
    return wallet;
  }

  async getNonce(walletAddress: string): Promise<number> {
    const mutex = this.mutex.get(walletAddress);
    return await mutex.runExclusive(async () => {
      // Nonce management logic
    });
  }
}
```

**Files to Create:**
- `src/core/wallet-manager.ts`
- `test/wallet-manager.test.ts`

---

### Issue #5: Implement Bybit Adapter for Withdrawals
**Labels:** `feature`, `cex`, `bybit`  
**Priority:** P1  
**Estimated Effort:** 1-2 weeks  

**Description:**
Missing Bybit integration for programmatic withdrawals as specified in requirements.

**Current Behavior:**
- No Bybit integration
- Cannot withdraw from Bybit programmatically
- Manual withdrawal required

**Expected Behavior:**
- Automatic withdrawal from Bybit
- Random amount withdrawals
- Whitelist management

**Solution:**
Create Bybit adapter in `src/cex/bybit-adapter.ts`:
```typescript
export class BybitAdapter {
  private apiKey: string;
  private apiSecret: string;

  async withdrawToWallet(
    walletAddress: string,
    amount: string,
    token: string
  ): Promise<WithdrawResult> {
    // Implement Bybit withdrawal API
  }

  async addToWhitelist(address: string): Promise<boolean> {
    // Implement whitelist management
  }
}
```

**Files to Create:**
- `src/cex/bybit-adapter.ts`
- `src/cex/types.ts`
- `test/bybit-adapter.test.ts`

---

### Issue #6: Implement Binance Fallback Adapter
**Labels:** `feature`, `cex`, `binance`, `fallback`  
**Priority:** P1  
**Estimated Effort:** 1-2 weeks  

**Description:**
Missing Binance integration for fallback withdrawals when Bybit has insufficient funds.

**Current Behavior:**
- No Binance integration
- No fallback mechanism for insufficient funds
- Manual intervention required

**Expected Behavior:**
- Automatic fallback to Binance
- Balance checking and management
- Seamless withdrawal switching

**Solution:**
Create Binance adapter with fallback logic in `src/cex/binance-adapter.ts`:
```typescript
export class BinanceAdapter {
  private apiKey: string;
  private apiSecret: string;

  async getBalance(token: string): Promise<string> {
    // Implement balance checking
  }

  async withdrawToWallet(
    walletAddress: string,
    amount: string,
    token: string
  ): Promise<WithdrawResult> {
    // Implement Binance withdrawal API
  }
}
```

**Files to Create:**
- `src/cex/binance-adapter.ts`
- `src/cex/fallback-manager.ts`
- `test/binance-adapter.test.ts`

---

### Issue #7: Implement Secure Key Management
**Labels:** `security`, `keys`, `vault`  
**Priority:** P1  
**Estimated Effort:** 2-3 days  

**Description:**
Current key management stores private keys in plain text environment variables, creating security vulnerabilities.

**Current Behavior:**
- Private keys in plain text `.env` files
- No encryption or vault integration
- Risk of key exposure in logs

**Expected Behavior:**
- Encrypted key storage
- Vault integration (Hashicorp Vault/AWS KMS)
- No plain text keys in environment

**Solution:**
Implement secure key management in `src/core/key-manager.ts`:
```typescript
export class KeyManager {
  private vaultClient: VaultClient;

  async getPrivateKey(walletId: string): Promise<string> {
    const secret = await this.vaultClient.kv.v2.read(`secret/bot/keys/${walletId}`);
    return this.decrypt(secret.data.value);
  }

  async storePrivateKey(walletId: string, privateKey: string): Promise<void> {
    const encrypted = this.encrypt(privateKey);
    await this.vaultClient.kv.v2.create(`secret/bot/keys/${walletId}`, {
      data: { value: encrypted }
    });
  }
}
```

**Files to Create:**
- `src/core/key-manager.ts`
- `src/core/encryption.ts`

---

## 🟢 Enhancement Issues (P2)

### Issue #8: Add Advanced Monitoring and Metrics
**Labels:** `monitoring`, `metrics`, `observability`  
**Priority:** P2  
**Estimated Effort:** 1 week  

**Description:**
Current monitoring is basic. Need advanced metrics, alerting, and dashboard for production use.

**Current Behavior:**
- Basic structured logging with Pino
- No metrics collection
- No alerting system

**Expected Behavior:**
- Detailed metrics collection
- Real-time alerting
- Dashboard for monitoring
- Performance tracking

**Solution:**
Implement monitoring system with Prometheus/Grafana:
```typescript
export class MetricsCollector {
  private prometheus: PrometheusClient;

  recordTransactionSuccess(wallet: string, step: string, duration: number): void {
    this.prometheus.counter('transactions_success_total', { wallet, step }).inc();
    this.prometheus.histogram('transaction_duration_seconds', { wallet, step }).observe(duration);
  }

  recordFeesCollected(wallet: string, amount: string, token: string): void {
    this.prometheus.counter('fees_collected_total', { wallet, token }).inc(parseFloat(amount));
  }
}
```

**Files to Create:**
- `src/monitoring/metrics-collector.ts`
- `src/monitoring/alert-manager.ts`
- `docker-compose.monitoring.yml`

---

### Issue #9: Implement MEV Protection
**Labels:** `mev`, `security`, `optimization`  
**Priority:** P2  
**Estimated Effort:** 1-2 weeks  

**Description:**
Current transactions are vulnerable to MEV attacks and front-running.

**Current Behavior:**
- No MEV protection
- Transactions submitted to public mempool
- Vulnerable to front-running

**Expected Behavior:**
- MEV protection mechanisms
- Private mempool usage
- Slippage protection

**Solution:**
Implement MEV protection strategies:
```typescript
export class MEVProtection {
  async submitPrivateTransaction(tx: TransactionRequest): Promise<string> {
    // Submit to private mempool (Flashbots, etc.)
  }

  async calculateOptimalSlippage(amount: bigint, pool: Pool): Promise<number> {
    // Dynamic slippage calculation based on pool liquidity
  }

  async detectMEVAttack(tx: TransactionRequest): Promise<boolean> {
    // MEV attack detection logic
  }
}
```

**Files to Create:**
- `src/mev/protection.ts`
- `src/mev/private-mempool.ts`

---

### Issue #10: Optimize Gas Usage and Costs
**Labels:** `optimization`, `gas`, `costs`  
**Priority:** P2  
**Estimated Effort:** 1 week  

**Description:**
Current gas usage is not optimized, leading to higher transaction costs.

**Current Behavior:**
- Fixed gas limits
- No gas optimization
- Higher transaction costs

**Expected Behavior:**
- Dynamic gas estimation
- Gas optimization strategies
- Cost monitoring and optimization

**Solution:**
Implement gas optimization:
```typescript
export class GasOptimizer {
  async estimateOptimalGas(tx: TransactionRequest): Promise<bigint> {
    // Dynamic gas estimation
  }

  async batchTransactions(txs: TransactionRequest[]): Promise<TransactionRequest> {
    // Batch multiple operations
  }

  async monitorGasCosts(): Promise<GasMetrics> {
    // Gas cost monitoring
  }
}
```

**Files to Create:**
- `src/optimization/gas-optimizer.ts`
- `src/optimization/batch-manager.ts`

---

## 📋 Issue Summary

| Priority | Count | Estimated Effort |
|----------|-------|------------------|
| P0 (Critical) | 3 | 6-10 days |
| P1 (Important) | 4 | 5-7 weeks |
| P2 (Enhancement) | 3 | 3-4 weeks |
| **Total** | **10** | **8-11 weeks** |

## 🎯 Recommended Implementation Order

1. **Week 1-2:** Fix P0 issues (Direct LP mode, tests, TypeScript)
2. **Week 3-4:** Implement WalletManager and key management
3. **Week 5-6:** Add Bybit and Binance adapters
4. **Week 7-8:** Implement monitoring and MEV protection
5. **Week 9:** Gas optimization and final testing

## 🏷️ Label Legend

- `bug`: Something isn't working
- `feature`: New feature or request
- `critical`: Critical issue that blocks production
- `security`: Security-related issue
- `tests`: Test-related issue
- `scaling`: Scaling-related issue
- `optimization`: Performance optimization
- `monitoring`: Monitoring and observability
