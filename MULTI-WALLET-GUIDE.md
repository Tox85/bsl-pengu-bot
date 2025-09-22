# Guide d'utilisation du système Multi-Wallet

Ce guide explique comment utiliser le nouveau système multi-wallet avec intégration Bybit pour automatiser les opérations DeFi sur plusieurs wallets simultanément.

## Vue d'ensemble

Le système multi-wallet permet de :
1. **Gérer jusqu'à 100 wallets** dérivés d'une phrase mnémonique unique
2. **Retirer des fonds depuis Bybit** vers un wallet "Hub" whitelisté
3. **Distribuer automatiquement** les fonds du Hub vers tous les wallets cibles
4. **Exécuter la chaîne DeFi complète** (bridge → swap → LP → collect) sur chaque wallet

## Architecture

```
Bybit Exchange
     ↓ (retrait automatique)
Wallet Hub (whitelisté)
     ↓ (distribution on-chain)
100 Wallets (dérivés du mnémonique)
     ↓ (chaîne DeFi parallèle)
Bridge → Swap → LP → Collect
```

## Configuration

### 1. Variables d'environnement

Ajoutez ces variables à votre fichier `.env` :

```bash
# Multi-wallet configuration
MNEMONIC="abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
WALLET_COUNT=100
HUB_WALLET_PRIVATE_KEY=0x...

# Bybit configuration
BYBIT_API_KEY=your_api_key
BYBIT_API_SECRET=your_api_secret
BYBIT_SANDBOX=false
BYBIT_TESTNET=false

# Distribution configuration
DISTRIBUTION_USDC_PER_WALLET=10.0
DISTRIBUTION_ETH_PER_WALLET=0.005
DISTRIBUTION_RANDOMIZE_AMOUNTS=true
DISTRIBUTION_VARIATION_PERCENT=10
```

### 2. Configuration Bybit

1. **Créez un compte Bybit** et obtenez vos clés API
2. **Whitelistez l'adresse du wallet Hub** dans Bybit :
   - Connectez-vous à Bybit
   - Allez dans "Assets" → "Withdrawal" → "Address Management"
   - Ajoutez l'adresse de votre wallet Hub
   - Attendez la confirmation (peut prendre quelques heures)

### 3. Préparation du wallet Hub

Le wallet Hub doit avoir :
- Une clé privée valide
- Des fonds USDC et/ou ETH sur Bybit pour les retraits
- Un solde ETH suffisant pour les transactions de distribution

## Utilisation

### Mode automatique (recommandé)

Le système détecte automatiquement le mode multi-wallet si toutes les variables requises sont configurées :

```bash
npm start
```

### Mode single-wallet (comportement original)

Si les variables multi-wallet ne sont pas configurées, le système utilise le mode single-wallet avec `PRIVATE_KEY` :

```bash
# Utilise uniquement PRIVATE_KEY
PRIVATE_KEY=0x... npm start
```

## Processus d'exécution

### 1. Création des wallets
- Génération de `WALLET_COUNT` wallets depuis le mnémonique
- Utilisation des chemins de dérivation standard `m/44'/60'/0'/0/index`

### 2. Distribution des fonds
- **Retrait depuis Bybit** : USDC et ETH vers le wallet Hub
- **Distribution on-chain** : Le Hub envoie des montants aléatoires à chaque wallet
- **Gestion des nonces** : Chaque wallet maintient son propre nonce

### 3. Exécution DeFi
- **Bridge** : Base → Abstract (si configuré)
- **Swap** : Token → PENGU sur Uniswap v3
- **LP** : Création de position de liquidité concentrée
- **Collect** : Collecte des frais après le délai spécifié

## Configuration avancée

### Distribution des montants

```bash
# Montants fixes
DISTRIBUTION_RANDOMIZE_AMOUNTS=false
DISTRIBUTION_USDC_PER_WALLET=10.0

# Montants aléatoires (recommandé)
DISTRIBUTION_RANDOMIZE_AMOUNTS=true
DISTRIBUTION_VARIATION_PERCENT=10  # ±10% de variation
```

### Exécution parallèle vs séquentielle

Par défaut, l'exécution est **séquentielle** pour la stabilité. Pour activer le parallélisme :

```typescript
// Dans le code
const multiWalletConfig = {
  sequential: false,
  maxConcurrentWallets: 5, // Maximum 5 wallets en parallèle
};
```

## Surveillance et logs

### Logs structurés

Tous les logs incluent l'adresse du wallet concerné :

```json
{
  "wallet": "0x742d35Cc6634C0532925a3b8D1B2b3b4C5D6E7F8",
  "index": 0,
  "message": "Wallet traité avec succès"
}
```

### Métriques

Le système fournit des métriques détaillées :
- Nombre total de wallets traités
- Nombre de succès/échecs
- Temps d'exécution total
- Répartition des erreurs

## Gestion des erreurs

### Types d'erreurs courantes

1. **Erreur Bybit** : Solde insuffisant, adresse non whitelistée
2. **Erreur de distribution** : Gas insuffisant, transaction échouée
3. **Erreur DeFi** : Slippage, pool non trouvé, position échouée

### Stratégies de récupération

- **Retry automatique** : Les transactions échouées sont retentées
- **Isolation des erreurs** : Un wallet qui échoue n'affecte pas les autres
- **Logs détaillés** : Toutes les erreurs sont loggées avec contexte

## Sécurité

### Bonnes pratiques

1. **Utilisez des mnémoniques sécurisés** : Générés de manière cryptographiquement sûre
2. **Limitez les permissions Bybit** : Utilisez des clés API avec permissions minimales
3. **Surveillez les balances** : Vérifiez régulièrement les fonds
4. **Testez sur testnet** : Utilisez `BYBIT_TESTNET=true` pour les tests

### Gestion des clés

- **Mnémonique** : Stockez de manière sécurisée (hardware wallet recommandé)
- **Clés API Bybit** : Ne les exposez jamais dans le code
- **Wallet Hub** : Utilisez un wallet dédié avec des fonds limités

## Tests

### Tests unitaires

```bash
npm test
```

### Tests d'intégration

```bash
# Test avec Bybit sandbox
BYBIT_SANDBOX=true npm test

# Test avec un petit nombre de wallets
WALLET_COUNT=3 npm test
```

## Dépannage

### Problèmes courants

1. **"Address not whitelisted"**
   - Vérifiez que l'adresse Hub est bien whitelistée sur Bybit
   - Attendez la confirmation (peut prendre jusqu'à 24h)

2. **"Insufficient balance"**
   - Vérifiez le solde sur Bybit
   - Ajustez `DISTRIBUTION_*_PER_WALLET` si nécessaire

3. **"Nonce too low"**
   - Le système gère automatiquement les nonces
   - Redémarrez si le problème persiste

### Support

Pour plus d'aide :
1. Consultez les logs détaillés
2. Vérifiez la configuration
3. Testez avec un petit nombre de wallets d'abord

## Limitations actuelles

1. **Maximum 100 wallets** par exécution
2. **Exécution séquentielle** par défaut (pour la stabilité)
3. **Une seule adresse Hub** par configuration
4. **Support Bybit uniquement** (extensible pour d'autres exchanges)

## Roadmap

- [ ] Support d'autres exchanges (Binance, Coinbase)
- [ ] Exécution parallèle optimisée
- [ ] Interface web de monitoring
- [ ] Support de plus de 100 wallets
- [ ] Intégration avec des hardware wallets
