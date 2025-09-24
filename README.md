# BSL Pengu Bot (v2)

Bot TypeScript minimaliste pour exécuter le flow complet demandé :
**Bybit/Base wallet → Hub Wallet → Distribution → Bridge (Base → Abstract) → Swap ETH/PENGU → LP Uniswap v2 → Collecte & réinvestissement des frais.**

## ✨ Points clés

- 13 fichiers TypeScript pour couvrir toute la chaîne d'exécution.
- Stockage chiffré et déterministe des 100 wallets (1 hub + 99 satellites) depuis votre **mnemonic**.
- Retrait Bybit via `ccxt` ou fallback depuis un wallet Base (clé privée dans `.env`).
- Distribution hub → satellites avec montants aléatoires dans un intervalle configurable.
- Bridge ETH Base → Abstract via l'API Jumper, puis swap 50/50 ETH/PENGU.
- Fourniture de liquidité Uniswap **v2** (pool PENGU/WETH) en déployant ~80% de chaque jeton.
- Collecte conditionnelle des fees (drift de prix, fees > 3× gas) puis recyclage partiel en ETH pour la sécurité.
- CLI unique (`npm start -- cycle`) pour lancer un cycle complet.
- CLI unique (`npm start -- cycle`) pour lancer un cycle complet.

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
├── walletHub.ts       # Distribution depuis le hub vers 99 wallets
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
- `STRATEGY_MNEMONIC`, `HUB_WALLET_PASSWORD`, `HUB_WALLET_STORE`, `HUB_WALLET_INDEX`.
- `BYBIT_API_KEY`, `BYBIT_API_SECRET` (facultatif si vous utilisez le mode wallet unique) et `HUB_WITHDRAW_AMOUNT`.
- `BASE_FUNDING_PRIVATE_KEY` (optionnel) pour lancer le flow sans Bybit.
- `RPC_BASE`, `RPC_ABSTRACT`, `CHAIN_ID_BASE`, `CHAIN_ID_ABSTRACT`.
- `PENGU_TOKEN_ADDRESS`, `WRAPPED_ETH_ADDRESS`, `UNISWAP_ROUTER_ADDRESS`, `UNISWAP_PAIR_ADDRESS`.
- Paramètres stratégiques : `BRIDGE_SLIPPAGE_BPS`, `SWAP_SLIPPAGE_BPS`, `REBALANCE_PRICE_THRESHOLD_PERCENT`, `FEE_GAS_MULTIPLE_TRIGGER`, `LIQUIDITY_UTILIZATION_PERCENT`, `PENGU_TO_ETH_FEE_SWAP_PERCENT`, `FEE_REINVEST_PERCENT`, `SATELLITE_VARIANCE_MIN/MAX`.

## 🚀 Installation & usage

```bash
npm install
cp env.example .env
# éditer .env avec vos valeurs

# Build + run un cycle complet
npm run build
node dist/index.js cycle
# ou directement en dev (ts-node via tsup --watch)
npx ts-node src/index.ts cycle

# Consulter les balances du wallet stratégie (Abstract)
node dist/index.js balances
```

Le cycle exécute :
1. Retrait Bybit (ou transfert depuis le wallet Base) vers le hub.
2. Distribution aléatoire du hub vers les 99 satellites (dont le wallet stratégie).
3. Bridge du satellite stratégique → Abstract.
4. Swap pour obtenir ~50% WETH / 50% PENGU.
5. Dépôt d'~80% de chaque jeton dans le pool Uniswap v2 PENGU/WETH.
6. Collecte conditionnelle des fees + décision de redeploiement.

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

- Les 100 wallets sont dérivés depuis `STRATEGY_MNEMONIC` (`m/44'/60'/0'/0/i`).
- Chiffrement AES-256-GCM, clé dérivée via `scrypt` + salt unique.
- Relancer le bot recharge automatiquement les wallets existants. Modifier `HUB_WALLET_INDEX` permet de choisir le hub à whitelister.

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
