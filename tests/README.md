# Tests du Bot ABS Bridge→Swap→LP

Ce dossier contient tous les tests pour le bot ABS, organisés par type et fonctionnalité.

## Structure des Tests

```
tests/
├── fixtures/           # Fixtures et mocks pour les tests
│   ├── nock/          # Mocks HTTP avec nock
│   │   ├── bybit.fixture.ts
│   │   └── bridge.fixture.ts
│   ├── mocks/         # Mocks ethers et contrats
│   │   └── ethers.hub.ts
│   └── index.ts       # Factory centralisée des fixtures
├── integration/       # Tests d'intégration
│   ├── multiwallet.happy.spec.ts
│   ├── multiwallet.failureCases.spec.ts
│   ├── resume.spec.ts
│   ├── stress.100wallets.spec.ts
│   ├── cli-simple.spec.ts
│   └── simple-multiwallet.spec.ts
├── concurrency/       # Tests de concurrence
│   └── idempotence.spec.ts
├── cli/               # Tests CLI avancés
│   └── cli-advanced.spec.ts
├── setup.ts          # Configuration globale des tests
└── README.md         # Ce fichier
```

## Types de Tests

### 1. Tests Unitaires
- **Localisation** : `test/` (dossier existant)
- **Commande** : `npm run test:unit`
- **Description** : Tests des composants individuels (WalletManager, StateManager, etc.)

### 2. Tests d'Intégration
- **Localisation** : `tests/integration/`
- **Commande** : `npm run test:integration`
- **Description** : Tests du flow complet multi-wallet avec stubs

### 3. Tests de Concurrence
- **Localisation** : `tests/concurrency/`
- **Commande** : `npm run test:concurrency`
- **Description** : Tests d'idempotence et de concurrence

### 4. Tests de Stress
- **Localisation** : `tests/integration/stress.100wallets.spec.ts`
- **Commande** : `npm run test:stress`
- **Description** : Tests de performance avec 100 wallets

### 5. Tests CLI Avancés
- **Localisation** : `tests/cli/`
- **Commande** : `npm run test:integration`
- **Description** : Tests des options CLI avancées

## Comment Exécuter les Tests

### Prérequis
- Node.js 18+ 
- npm install
- npm run build

### Commandes Disponibles

```bash
# Tous les tests
npm test

# Tests unitaires uniquement
npm run test:unit

# Tests d'intégration uniquement
npm run test:integration

# Tests de stress (100 wallets)
npm run test:stress

# Tests avec couverture
npm run test:ci

# Tests en mode watch
npm run test:watch
```

### Tests d'Intégration Locaux

Les tests d'intégration utilisent des stubs/mocks et ne nécessitent pas de clés réelles :

```bash
# Test multi-wallet happy path (N=10)
npm run test:integration -- tests/integration/multiwallet.happy.spec.ts

# Test des cas d'échec
npm run test:integration -- tests/integration/multiwallet.failureCases.spec.ts

# Test de reprise
npm run test:integration -- tests/integration/resume.spec.ts

# Test d'idempotence
npm run test:concurrency -- tests/concurrency/idempotence.spec.ts

# Test de stress (100 wallets)
npm run test:stress

# Tests CLI avancés
npm run test:integration -- tests/cli/cli-advanced.spec.ts
```

### Simulation avec CLI

Pour tester le CLI avec des stubs :

```bash
# Test multi-wallet avec stubs
node dist/cli/run-multi.js --simulate-stubs=true --mnemonicCount=10 --dry-run

# Test avec reprise
node dist/cli/run-multi.js --simulate-stubs=true --resume --dry-run

# Test avec fresh start
node dist/cli/run-multi.js --simulate-stubs=true --fresh --dry-run

# Test avec format JSON
node dist/cli/run-multi.js --simulate-stubs=true --format json --dry-run

# Test avec skip bridge
node dist/cli/run.js full --simulate-stubs=true --skip-bridge --dry-run
```

## Fixtures et Mocks

### Factory Centralisée
```typescript
import { fixtures, setupBybitSuccess, setupBridgeSuccess } from '../fixtures/index.js';

// Utilisation simple
setupBybitSuccess();
setupBridgeSuccess();

// Ou utilisation directe
fixtures.getBybit().mockWithdrawSuccess();
fixtures.getBridge().mockRouteFound();
```

### Bybit Fixtures
- `mockWithdrawSuccess()` : Retrait réussi
- `mockWithdrawInsufficientBalance()` : Solde insuffisant
- `mockWithdrawRateLimitThenSuccess()` : Rate limit puis succès
- `mockWithdrawTimeout()` : Timeout de retrait
- `mockGetBalance(balance)` : Vérification de solde
- `mockGetWithdrawalStatus(status)` : Statut de retrait

### Bridge Fixtures
- `mockRouteFound()` : Route trouvée
- `mockRouteNotFound()` : Aucune route
- `mockExecuteBridge()` : Exécution de bridge
- `mockBridgeStatusSuccess()` : Bridge réussi
- `mockBridgeTimeout()` : Timeout de bridge
- `mockBridgeStatusFailed()` : Bridge échoué

### Ethers Mocks
- `createHubDistributorMock(options)` : Mock du contrat Hub
- `createProviderMock()` : Mock du provider Ethereum

## Structure des Tests Multi-Wallet

### Happy Path (N=10)
- Création de 10 wallets depuis une mnemonic
- Exécution du flow complet : Bridge → Swap → LP → Collect
- Vérification de l'idempotence
- Gestion des nonces
- Persistance de l'état
- Tests de concurrence contrôlée

### Cas d'Échec
1. **INSUFFICIENT_FUNDS** : Solde insuffisant pour retrait
2. **BRIDGE_TIMEOUT** : Timeout du bridge avec retry
3. **SWAP_NO_POOL** : Aucun pool de swap disponible
4. **COLLECT_REVERT** : Échec du collect avec retry
5. **RATE_LIMIT** : Gestion des limites de taux

### Reprise
- Crash après swap → reprise à LP
- Crash après LP → reprise à Collect
- Mode `--fresh` pour réinitialiser
- Préservation des operation IDs
- Gestion des états corrompus

### Idempotence
- Exécution concurrente du même wallet
- Prévention des doubles exécutions
- Gestion des nonces atomique
- Isolation entre wallets
- Mutex par wallet

### Stress Test (100 Wallets)
- Test avec 100 wallets en parallèle
- Contrôle de concurrence (max 5)
- Gestion de la mémoire
- Performance et timeouts
- Scénarios mixtes succès/échec

## Infrastructure de Test

### BotError Standardisé
```typescript
import { BotError } from '../errors/BotError.js';

// Erreurs avec codes
throw BotError.insufficientFunds('Solde insuffisant');
throw BotError.rateLimit('Rate limit atteint');
throw BotError.timeout('Timeout de bridge');

// Vérification des erreurs
if (error instanceof BotError && error.isRetryable()) {
  // Retry logic
}
```

### Retry Helper
```typescript
import { retry, retryApi, retryTransaction } from '../utils/retry.js';

// Retry avec backoff exponentiel
const result = await retry(
  () => apiCall(),
  { maxRetries: 3, baseDelayMs: 1000 }
);

// Retry spécialisé pour API
const result = await retryApi(() => bybitWithdraw());
```

### Mutex et Nonce Manager
```typescript
import { walletMutexManager } from '../utils/mutex.js';
import { NonceManager } from '../utils/nonceManager.js';

// Mutex par wallet
await walletMutexManager.runExclusive(walletAddress, async () => {
  // Opération atomique
});

// Gestion des nonces
const nonce = await nonceManager.getNextNonce();
await nonceManager.markNonceUsed(nonce);
```

### Écritures Atomiques
```typescript
import { writeAtomicJson } from '../utils/writeAtomic.js';

// Écriture atomique avec .tmp + rename
writeAtomicJson(filePath, state);
```

### Operation IDs pour Idempotence
```typescript
import { generateOperationId, OPERATION_INTENTS } from '../utils/operationId.js';

// Génération d'ID unique
const operationId = generateOperationId(wallet, OPERATION_INTENTS.BRIDGE, params);

// Vérification d'exécution
if (stateManager.isOperationExecuted(wallet, operationId)) {
  return; // Déjà exécuté
}
```

## Configuration des Tests

### Variables d'Environnement
Les tests utilisent des variables d'environnement mockées :

```bash
export MNEMONIC="abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
export WALLET_COUNT="5"
export BYBIT_API_KEY="test-api-key"
export BYBIT_API_SECRET="test-api-secret"
export HUB_WALLET_PRIVATE_KEY="0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
export DISTRIBUTION_USDC_PER_WALLET="10"
export DISTRIBUTION_ETH_PER_WALLET="0.005"
export ARBITRUM_RPC="https://arb1.arbitrum.io/rpc"
```

### Fake Timers
Les tests utilisent des fake timers pour contrôler les délais :

```typescript
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// Avancer les timers
await vi.runAllTimersAsync();
```

### Configuration Vitest
- `vitest.unit.config.ts` : Tests unitaires
- `vitest.integration.config.ts` : Tests d'intégration
- `tests/setup.ts` : Configuration globale

## Débogage des Tests

### Logs Détaillés
```bash
# Activer les logs détaillés
DEBUG=* npm run test:integration

# Logs spécifiques
DEBUG=wallet-manager,state-manager npm run test:integration
```

### Tests Individuels
```bash
# Exécuter un test spécifique
npm run test:integration -- --grep "should complete flow for 10 wallets"

# Exécuter avec timeout étendu
npm run test:integration -- --timeout 120000
```

### Inspection des États
```bash
# Vérifier les fichiers d'état
ls -la .test-state/

# Nettoyer les états de test
rm -rf .test-state/
```

## Intégration Continue

Les tests s'exécutent automatiquement sur :
- Push vers `main` ou `develop`
- Pull requests vers `main` ou `develop`
- Matrices Node.js 18.x et 20.x
- Ubuntu, Windows, et macOS

### Commandes CI
```bash
# Pipeline complet
npm run test:ci

# Tests avec couverture
npm run test:ci -- --coverage
```

### GitHub Actions
- `.github/workflows/test.yml` : Pipeline CI/CD
- Tests multi-plateformes
- Tests de stress avec timeout
- Validation des types et linting

## Ajout de Nouveaux Tests

### Structure Recommandée
```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupBybitSuccess, fixtures } from '../fixtures/index.js';
import { runFlowForWallets } from '../../src/cli-runner.js';

describe('Nouveau Test', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    setupBybitSuccess();
  });

  afterEach(() => {
    fixtures.cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('should test something', async () => {
    const results = await runFlowForWallets({ 
      simulateStubs: true, 
      mnemonicCount: 5 
    });
    
    expect(results).toHaveLength(5);
    expect(results.every(r => r.status === 'success')).toBe(true);
  });
});
```

### Bonnes Pratiques
1. **Isolation** : Chaque test doit être indépendant
2. **Cleanup** : Nettoyer les mocks et fixtures après chaque test
3. **Fake Timers** : Utiliser pour contrôler les délais
4. **Assertions** : Vérifier les états et les résultats
5. **Documentation** : Commenter les cas complexes
6. **Performance** : Utiliser `toBeCloseTo()` pour les comparaisons numériques
7. **Concurrence** : Tester les scénarios concurrents
8. **Idempotence** : Vérifier que les opérations sont idempotentes

## Métriques et Rapports

### Logs Structurés
```json
{
  "wallet": "0x742d35Cc6634C0532925a3b8D1B2b3b4C5D6E7F8",
  "step": "bridge",
  "status": "success",
  "txHash": "0xabc123...",
  "durationMs": 1234
}
```

### Résumé Final
```json
{
  "wallets": [...],
  "summary": {
    "totalWallets": 100,
    "successCount": 95,
    "partialCount": 3,
    "failedCount": 2,
    "totalDurationMs": 45000,
    "avgDurationPerWallet": 450
  }
}
```

## Troubleshooting

### Problèmes Courants

1. **Tests qui timeout** : Augmenter `testTimeout` ou utiliser fake timers
2. **Mocks non nettoyés** : Vérifier `afterEach` et `fixtures.cleanup()`
3. **États corrompus** : Nettoyer `.test-state/` entre les tests
4. **Concurrence** : Utiliser `vi.useFakeTimers()` pour contrôler les délais
5. **Nonces en collision** : Vérifier l'isolation des wallets

### Commandes de Debug
```bash
# Nettoyer tout
rm -rf .test-state/ node_modules/.cache/

# Rebuild complet
npm run build
npm run test:integration

# Test avec logs détaillés
DEBUG=* npm run test:integration -- --reporter=verbose
```