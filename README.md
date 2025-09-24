# BSL Pengu Bot (v2)

Bot TypeScript minimaliste pour exécuter le flow complet demandé :
**Bybit/Base wallet → Hub Wallet → Distribution → Bridge (Base → Abstract) → Swap ETH/PENGU → LP Uniswap v2 → Collecte & réinvestissement des frais.**

## ✨ Points clés

- 13 fichiers TypeScript pour couvrir toute la chaîne d'exécution.
- Stockage chiffré et déterministe d'un ensemble de wallets configurables (par défaut 100, dont 1 hub) depuis votre **mnemonic**.
- Possibilité de limiter dynamiquement le nombre de wallets actifs via `STRATEGY_ACTIVE_WALLET_COUNT` sans régénérer le store existant.
- Retrait Bybit via `ccxt` ou fallback depuis un wallet Base (clé privée dans `.env`).
- Distribution hub → satellites avec montants aléatoires dans un intervalle configurable.
- Bridge ETH Base → Abstract via l'API Jumper, puis swap 50/50 ETH/PENGU.
- Gestion robuste des indisponibilités Jumper (bridge & swap) pour éviter les arrêts de cycle.
- Fourniture de liquidité Uniswap **v2** (pool PENGU/WETH) en déployant ~80% de chaque jeton.
- Collecte conditionnelle des fees (drift de prix, fees > 3× gas) puis recyclage partiel en ETH pour la sécurité.
- Logs synthétiques (funding, bridge, swap, LP) pour vérifier un cycle en quelques lignes.

## 🗂️ Structure ultra-compacte

```
src/
├── index.ts           # CLI
├── config.ts          # Chargement & validation des env vars
├── logger.ts          # Logger Pino
├── utils.ts           # Helpers math / temps / conversions
├── types.ts           # Types partagés
├── walletStore.ts     # Génération + stockage chiffré des wallets
├── bybitClient.ts     # Intégration Bybit (retrait ETH)
├── walletHub.ts       # Distribution depuis le hub vers les wallets satellites configurables
├── bridgeService.ts   # Bridge Base → Abstract via Jumper
├── swapService.ts     # Swaps ETH↔PENGU + gestion du wrapping WETH
├── feeManager.ts      # Politique d'utilisation des fees
├── lpManager.ts       # Gestion Uniswap v2 (add/remove liquidity + triggers)
└── strategy.ts        # Orchestrateur complet (cycle unique)
```

## ⚙️ Configuration

1. Copiez `env.example` → `.env` et renseignez les valeurs.
2. Le mot de passe (`HUB_WALLET_PASSWORD`) protège le fichier `HUB_WALLET_STORE` (AES-256-GCM).
3. Les adresses des contrats (PENGU, WETH, router Uniswap v2, pool LP) doivent être vérifiées côté Abstract.

Variables obligatoires :
- `STRATEGY_MNEMONIC`, `STRATEGY_WALLET_COUNT`, `STRATEGY_ACTIVE_WALLET_COUNT`, `HUB_WALLET_PASSWORD`, `HUB_WALLET_STORE`, `HUB_WALLET_INDEX`.
- `BYBIT_API_KEY`, `BYBIT_API_SECRET` (facultatif si vous utilisez le mode wallet unique) et `HUB_WITHDRAW_AMOUNT`.
- `BASE_FUNDING_PRIVATE_KEY` (optionnel) pour lancer le flow sans Bybit.
- `RPC_BASE`, `RPC_ABSTRACT`, `CHAIN_ID_BASE`, `CHAIN_ID_ABSTRACT`.
- `PENGU_TOKEN_ADDRESS`, `WRAPPED_ETH_ADDRESS`, `UNISWAP_ROUTER_ADDRESS`, `UNISWAP_PAIR_ADDRESS`.
- Paramètres stratégiques : `BRIDGE_SLIPPAGE_BPS`, `SWAP_SLIPPAGE_BPS`, `REBALANCE_PRICE_THRESHOLD_PERCENT`, `FEE_GAS_MULTIPLE_TRIGGER`, `LIQUIDITY_UTILIZATION_PERCENT`, `PENGU_TO_ETH_FEE_SWAP_PERCENT`, `FEE_REINVEST_PERCENT`, `SATELLITE_VARIANCE_MIN/MAX`.

## 🚀 Installation & usage

```bash
npm install
cp env.example .env
# puis éditez .env avec vos paramètres (voir ci-dessous)
```

### Lancement standard (Bybit → Hub → satellites, 100 wallets par défaut)

```bash
# 1. Construire le CLI
npm run build

# 2. Lancer un cycle complet (retrait Bybit, distribution, bridge, swap, LP)
npm start -- cycle

# 3. Vérifier les balances du wallet stratégie (réseau Abstract)
npm start -- balances
```

Le cycle exécute automatiquement :
1. Retrait Bybit (ou transfert depuis le wallet Base) vers le hub.
2. Distribution aléatoire du hub vers les satellites configurés (dont le wallet stratégie).
3. Bridge du satellite stratégique → Abstract.
4. Swap pour obtenir ~50% WETH / 50% PENGU.
5. Dépôt d'~80% de chaque jeton dans le pool Uniswap v2 PENGU/WETH.
6. Collecte conditionnelle des fees + décision de redeploiement.

### Mode wallet unitaire (sans API Bybit)

Pour un dry-run depuis un seul wallet Base :

1. Laissez `BYBIT_API_KEY` / `BYBIT_API_SECRET` vides.
2. Renseignez `BASE_FUNDING_PRIVATE_KEY` avec la clé privée du wallet Base à utiliser.
3. Lancer `npm run build && npm start -- cycle`.

Le bot :

- alimente le hub depuis ce wallet unique,
- crée (ou recharge) le nombre de wallets configuré dérivés via la mnemonic,
- continue le flow complet (bridge, swap, LP) sans dépendance à Bybit.

### Logs & monitoring

- Niveau par défaut : `info` (configurable via `LOG_LEVEL`).
- Chaque cycle affiche un résumé unique : source de funding, montant distribué, bridge/swap exécutés, état de la LP et fees récoltées.
- Les détails transactionnels restent disponibles au niveau `debug` (transferts satellites, retour de fonds, etc.).

## 🔁 Stratégie de harvest / redeploiement

Le bot surveille en continu la position Uniswap v2 :

- **Drift de prix** : si le prix implicite du pool dérive de plus de `REBALANCE_PRICE_THRESHOLD_PERCENT`.
- **Fees accumulées** : si la valeur des fees dépasse `FEE_GAS_MULTIPLE_TRIGGER × gas` estimé.

Lorsque l'une de ces conditions est remplie :

1. Le LP est retiré (ETH & PENGU récupérés + fees séparées).
2. `PENGU_TO_ETH_FEE_SWAP_PERCENT` des fees PENGU est swapé en ETH pour sécuriser la liquidité.
3. `FEE_REINVEST_PERCENT` des fees restants est composé à nouveau.
4. Une nouvelle position est créée en réutilisant ~80% du stock WETH/PENGU disponible.

## 🔒 Stockage des wallets

- Le nombre de wallets (par défaut 100) est dérivé depuis `STRATEGY_MNEMONIC` (`m/44'/60'/0'/0/i`).
- `STRATEGY_ACTIVE_WALLET_COUNT` borne le nombre de wallets utilisés par le bot (ex. 2 pour n'activer que le hub + le premier satellite) tout en conservant les entrées excédentaires pour la production.
- Chiffrement AES-256-GCM, clé dérivée via `scrypt` + salt unique.
- Relancer le bot recharge automatiquement les wallets existants. Modifier `HUB_WALLET_INDEX` permet de choisir le hub à whitelister.
- Les montants envoyés aux satellites sont randomisés dans l'intervalle `[SATELLITE_VARIANCE_MIN, SATELLITE_VARIANCE_MAX]` pour éviter des patterns fixes.

## 🧪 Tests & lint

```bash
npm run lint
npm run type-check
npm test
```

Les modules externes (Bybit/Jumper/Uniswap) sont fortement dépendants du réseau : activez un environnement de test (montants faibles) avant de passer en production.

## 🛡️ Bonnes pratiques

- Utilisez un hub wallet dédié et limitez les droits API Bybit (withdraw-only).
- Vérifiez manuellement les adresses PENGU/WETH/pool avant mise en production.
- Surveillez les logs Pino (niveau `info` par défaut, configurable via `LOG_LEVEL`).
- Adaptez `GAS_PRICE_GWEI` au contexte réseau Abstract.

## 📄 Licence

MIT.
