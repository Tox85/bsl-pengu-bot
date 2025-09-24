# BSL Pengu Bot (v2)

Bot TypeScript minimaliste pour exécuter le flow complet demandé :
**Bybit → Hub Wallet → Distribution → Bridge (Base → Abstract) → Swap ETH/PENGU → LP concentrée → Collecte & réinvestissement des frais.**

## ✨ Points clés

- 12 fichiers TypeScript seulement pour tout le bot.
- Stockage chiffré des 100 wallets (1 hub + 99 satellites) avec mot de passe.
- Retrait Bybit via `ccxt`, distribution on-chain depuis le hub.
- Bridge ETH Base → Abstract via l'API Jumper.
- Maintien d'un mix 50% ETH / 50% PENGU sur Abstract.
- Création & suivi d'une position Uniswap v3 (range ±X%, configurable).
- Collecte conditionnelle des fees (prix hors range, fees > 3× gas, variation > 10%).
- Réinvestissement intelligent : swap d'une partie des PENGU en ETH + compounding.
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
├── swapService.ts     # Swaps ETH↔PENGU + lecture balances
├── feeManager.ts      # Politique d'utilisation des fees
├── lpManager.ts       # Gestion Uniswap v3 (mint/collect/rebalance)
└── strategy.ts        # Orchestrateur complet (cycle unique)
```

## ⚙️ Configuration

1. Copiez `env.example` → `.env` et renseignez les valeurs.
2. Le mot de passe (`HUB_WALLET_PASSWORD`) protège le fichier `HUB_WALLET_STORE` (AES-256-GCM).
3. Les adresses des contrats (PENGU, WETH, pool, NFPositionManager) doivent être vérifiées côté Abstract.

Variables obligatoires :
- `BYBIT_API_KEY`, `BYBIT_API_SECRET`, `HUB_WITHDRAW_AMOUNT` (en ETH).
- `RPC_BASE`, `RPC_ABSTRACT`, `CHAIN_ID_BASE`, `CHAIN_ID_ABSTRACT`.
- `PENGU_TOKEN_ADDRESS`, `WRAPPED_ETH_ADDRESS`, `TARGET_POOL_ADDRESS`, `POSITION_MANAGER_ADDRESS`.
- Paramètres stratégiques : `BRIDGE_SLIPPAGE_BPS`, `SWAP_SLIPPAGE_BPS`, `RANGE_WIDTH_PERCENT`, `REBALANCE_PRICE_THRESHOLD_PERCENT`, `FEE_GAS_MULTIPLE_TRIGGER`.

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
1. Retrait Bybit vers le hub.
2. Distribution du hub vers 99 satellites.
3. Bridge du satellite stratégique → Abstract.
4. Swap pour obtenir ~50% ETH / 50% PENGU.
5. Création (ou mise à jour) de la position Uniswap v3.
6. Collecte des fees + décision de rebalance.

## 🔁 Stratégie de rebalance

Un rebalance est déclenché si :
- Le prix courant sort du range défini.
- Les fees collectées > `FEE_GAS_MULTIPLE_TRIGGER × gas`.
- Le prix a varié de plus de `REBALANCE_PRICE_THRESHOLD_PERCENT` depuis le dernier ajustement.

Lors d'un rebalance :
- Fermeture de la position courante.
- Swap de `penguToEthSafetySwapPercent` des fees PENGU vers ETH.
- Recréation d'une position neuve avec compounding des fees restants.

## 🔒 Stockage des wallets

- Les 100 wallets sont générés automatiquement (ethers) et sauvegardés dans `HUB_WALLET_STORE`.
- Chiffrement AES-256-GCM, clé dérivée via `scrypt` + salt unique.
- Relancer le bot recharge automatiquement les wallets existants.

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
