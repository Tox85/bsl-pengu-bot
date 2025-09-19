# ABS Bridge→Swap→LP Bot (TypeScript)

Bot TypeScript ultra-structuré pour automatiser le flow complet : **Bridge (Base → Abstract) → Swap (Pandora/Uniswap v3) → LP concentrée → Collect fees**.

## 🚀 Fonctionnalités

- **Bridge** depuis Base vers Abstract via Li.Fi API (Jumper)
- **Swap** sur Pandora/Uniswap v3 avec détection automatique du meilleur pool
- **LP concentrée** Uniswap v3 avec range paramétrable
- **Collect** automatique des frais après délai configurable
- **Mode DRY_RUN** pour simulation complète
- **Mode LIVE** avec micro-montants pour tests
- **Gestion d'état** idempotente avec checkpoints
- **CLI** dédiée pour chaque module
- **Tests** complets avec Vitest
- **Logs** structurés avec Pino

## 📋 Prérequis

- Node.js 18+
- npm ou pnpm
- Clé privée d'un wallet Base/Abstract
- RPC URLs pour Base et Abstract

## 🛠️ Installation

```bash
# Cloner le projet
git clone <repository-url>
cd abs-bridge-swap-lp-bot

# Installer les dépendances
npm install
# ou
pnpm install

# Copier le fichier de configuration
cp env.example .env

# Configurer les variables d'environnement
# Éditer .env avec vos valeurs
```

## ⚙️ Configuration

Éditez le fichier `.env` avec vos valeurs :

```env
# Wallets / RPC
PRIVATE_KEY=0x...            # wallet Base & Abstract
BASE_RPC_URL=...             # ex: https://base-mainnet.g.alchemy.com/v2/...
ABSTRACT_RPC_URL=https://api.mainnet.abs.xyz

# Flow policy
DRY_RUN=true                 # log-only
BRIDGE_TO_TOKEN=ETH          # ETH | USDC (sur Abstract)
SWAP_SLIPPAGE_BPS=80         # 0.8%
LP_RANGE_PCT=5               # ±5% default
LP_MINUTES_BEFORE_COLLECT=10

# Tokens (Abstract) - À VÉRIFIER sur abscan/pandora UI
PENGU_ADDRESS_ABS=0x...      # Adresse PENGU sur Abstract
WETH_ADDRESS_ABS=0x...       # WETH sur Abstract
USDC_ADDRESS_ABS=0x...       # USDC sur Abstract

# Core Uniswap v3 (Abstract mainnet)
UNIV3_FACTORY=0xA1160e73B63F322ae88cC2d8E700833e71D0b2a1
QUOTER_V2=0x728BD3eC25D5EDBafebB84F3d67367Cd9EBC7693
SWAP_ROUTER_02=0x7712FA47387542819d4E35A23f8116C90C18767C
NF_POSITION_MANAGER=0xfA928D3ABc512383b8E5E77edd2d5678696084F9

# Li.Fi
LIFI_BASE_URL=https://li.quest/v1
LIFI_API_KEY=                 # optionnel (meilleures rate limits)
```

## 🚀 Utilisation

### Build

```bash
npm run build
# ou
pnpm build
```

### Tests

```bash
# Tests en mode watch
npm run test
# ou
pnpm test

# Tests une seule fois
npm run test:run
# ou
pnpm test:run
```

### CLI - Bridge

```bash
# Obtenir une route de bridge
pnpm tsx src/cli/bridge.ts route \
  --from base --to abstract --toToken ETH --amount 0.01

# Exécuter un bridge (DRY_RUN)
pnpm tsx src/cli/bridge.ts execute \
  --privateKey 0x... --toToken ETH --amount 0.01 --dry-run

# Exécuter un bridge (LIVE)
pnpm tsx src/cli/bridge.ts execute \
  --privateKey 0x... --toToken ETH --amount 0.01

# Vérifier le statut d'un bridge
pnpm tsx src/cli/bridge.ts status --txHash 0x...
```

### CLI - Swap

```bash
# Obtenir un quote
pnpm tsx src/cli/swap.ts quote \
  --tokenIn ETH --tokenOut PENGU --amount 0.001

# Exécuter un swap (DRY_RUN)
pnpm tsx src/cli/swap.ts execute \
  --privateKey 0x... --tokenIn ETH --tokenOut PENGU --amount 0.001 --dry-run

# Exécuter un swap (LIVE)
pnpm tsx src/cli/swap.ts execute \
  --privateKey 0x... --tokenIn ETH --tokenOut PENGU --amount 0.001

# Lister les pools disponibles
pnpm tsx src/cli/swap.ts pools --tokenA PENGU --tokenB ETH
```

### CLI - LP

```bash
# Créer une position LP (DRY_RUN)
pnpm tsx src/cli/lp.ts add \
  --privateKey 0x... --pair PENGU/ETH --pct 5 \
  --amount0 0.0005 --amount1 0.0005 --dry-run

# Créer une position LP (LIVE)
pnpm tsx src/cli/lp.ts add \
  --privateKey 0x... --pair PENGU/ETH --pct 5 \
  --amount0 0.0005 --amount1 0.0005

# Collecter les frais
pnpm tsx src/cli/lp.ts collect \
  --privateKey 0x... --tokenId 1234

# Obtenir les informations d'une position
pnpm tsx src/cli/lp.ts info --tokenId 1234
```

### CLI - Orchestrateur (Flow complet)

```bash
# Exécuter le flow complet (DRY_RUN)
pnpm tsx src/cli/run.ts full \
  --privateKey 0x... --bridgeAmount 0.01 --bridgeToken ETH \
  --swapAmount 0.001 --swapPair PENGU/ETH --lpRange 5 \
  --collectAfter 10 --dry-run

# Exécuter le flow complet (LIVE)
pnpm tsx src/cli/run.ts full \
  --privateKey 0x... --bridgeAmount 0.01 --bridgeToken ETH \
  --swapAmount 0.001 --swapPair PENGU/ETH --lpRange 5 \
  --collectAfter 10

# Vérifier le statut
pnpm tsx src/cli/run.ts status --privateKey 0x...

# Réinitialiser l'état
pnpm tsx src/cli/run.ts reset --privateKey 0x... --confirm
```

## 🏗️ Architecture

```
src/
├── config/          # Configuration et validation
├── core/            # Utilitaires communs (RPC, math, retry, logs)
├── bridge/          # Module Bridge (Li.Fi API)
├── dex/             # Module Swap (Pandora/Uniswap v3)
├── lp/              # Module LP concentrée (Uniswap v3)
├── orchestrator/    # Orchestrateur principal
├── cli/             # Interfaces CLI
└── abis/            # ABI minimales des contrats
```

## 🔧 Modules

### Bridge (Li.Fi)
- Recherche de routes optimales
- Exécution des transactions de bridge
- Monitoring du statut jusqu'à réception

### Swap (Pandora/Uniswap v3)
- Détection automatique du meilleur pool
- Quotes avec slippage configurable
- Swaps exactInputSingle via SwapRouter02

### LP (Uniswap v3)
- Création de positions concentrées
- Calcul automatique des ranges de ticks
- Gestion des frais et liquidité

### Orchestrateur
- Exécution séquentielle des étapes
- Gestion d'état idempotente
- Checkpoints et reprise sur erreur

## 🧪 Tests

Les tests couvrent :
- **Unitaires** : Chaque service individuellement
- **Intégration** : Flow complet en mode DRY_RUN
- **Mocks** : Services externes (Li.Fi, RPC, contrats)

```bash
# Tests unitaires
pnpm test test/bridge.test.ts
pnpm test test/swap.test.ts
pnpm test test/lp.test.ts
pnpm test test/orchestrator.test.ts

# Tous les tests
pnpm test
```

## 📊 Monitoring

### Logs structurés
- **Pino** pour les logs JSON
- **Niveaux** : debug, info, warn, error
- **Contexte** : wallet, étape, métriques

### Métriques
- Frais collectés par token
- Gas utilisé total
- Durée d'exécution
- PnL brut

### État
- Fichiers JSON dans `.state/`
- Un fichier par wallet
- Reprise possible après interruption

## ⚠️ Sécurité

### Vérifications
- **Adresses** : Validation EIP-55
- **Montants** : Vérification des decimals
- **Gas** : Limites et buffers
- **Slippage** : Protection contre les MEV

### Limites
- **Price Impact** : Max 3% par défaut
- **Gas Price** : Max 50 GWEI
- **Retries** : Max 3 tentatives avec backoff

## 🚨 Risques

### LP Concentrée
- **Impermanent Loss** : Perte si prix sort du range
- **Frais** : Coûts de gas pour les opérations
- **Liquidité** : Risque de perte totale si range mal choisi

### Bridge
- **Temps** : Délais variables selon le bridge
- **Frais** : Coûts de bridge + gas
- **Slippage** : Impact sur les montants reçus

### Swap
- **MEV** : Risque de front-running
- **Slippage** : Impact sur le prix d'exécution
- **Liquidité** : Pools peu liquides = slippage élevé

## 📝 Notes importantes

1. **PENGU_ADDRESS_ABS** doit être vérifié sur abscan/pandora UI
2. **Adresses Uniswap v3** confirmées par la doc Abstract
3. **Mode DRY_RUN** recommandé pour les tests
4. **Micro-montants** pour les tests LIVE
5. **Monitoring** des logs pour détecter les erreurs

## 🤝 Contribution

1. Fork le projet
2. Créer une branche feature
3. Ajouter des tests
4. Soumettre une PR

## 📄 Licence

MIT License - voir LICENSE pour plus de détails.

## 🔗 Liens utiles

- [Abstract Documentation](https://docs.abs.xyz)
- [Uniswap v3 Documentation](https://docs.uniswap.org)
- [Li.Fi API Documentation](https://docs.li.fi)
- [Pandora UI](https://pandora.abstract.xyz)
