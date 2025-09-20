# 🚀 Guide de Test en Mode Réel

## ✅ Ce qui fonctionne déjà (confirmé)

- **Auto top-up Base → Abstract** : route Li.Fi valide, tx envoyée, statut DONE ✅
- **Unification --dry-run** : CLI expose full/collect/unwrap-weth/status ✅
- **Commandes CLI** : collect et unwrap-weth présentes, compilation OK ✅
- **Solde Abstract** : ETH + WETH + USDC.e visible sur Abscan ✅

## 🎯 Ce qu'il reste à valider en réel

### 1. **Swap USDC → PENGU réel**
**Attendu en logs :**
- `DEBUG: SwapService - dryRun reçu: false`
- `Approbation du token nécessaire` (si nécessaire)
- `Transaction de swap envoyée` + txHash
- `Swap exécuté avec succès` + receipt
- Nouveaux soldes USDC.e ↓, PENGU ↑

**À surveiller :**
- Adresse SwapRouter Abstract correcte
- `amountOutMin` calculé avec slippage 80 bps
- Gas estimate réaliste

### 2. **Mint LP PENGU/USDC réel**
**Attendu en logs :**
- `DEBUG: LiquidityPositionService - dryRun reçu: false`
- Approvals pour NonfungiblePositionManager
- `Transaction de création de position envoyée` + txHash
- `Position LP créée avec succès` + tokenId
- Sauvegarde dans `.state`

### 3. **Collect LP fees réel**
**Attendu :**
- Lecture du tokenId depuis `.state`
- `Transaction de collecte de frais envoyée` + txHash
- `Frais collectés avec succès` + montants

### 4. **CostsReporter**
**Attendu en fin de run :**
- Bilan ΔETH (Base/Abstract)
- ΔUSDC.e, ΔPENGU, ΔWETH
- Gas utilisés et coût total

## 🧪 Plan de test concret

### **Étape 1: Préparation**
```bash
# 1. Vérifier .env (adresses des tokens Abstract)
cat .env | grep -E "(PENGU|WETH|USDC)_ADDRESS_ABS"

# 2. Vérifier les soldes sur Abscan
# - Base: ~0.0003-0.0005 ETH
# - Abstract: ETH + USDC.e + WETH
```

### **Étape 2: Test DRY_RUN (simulation)**
```bash
node dist/cli/run.js full \
  --privateKey "0x<TA_VRAIE_CLE>" \
  --bridgeAmount 0 \
  --bridgeToken USDC \
  --swapAmount 0.2 \
  --swapPair "PENGU/USDC" \
  --lpRange 5 \
  --collectAfter 0 \
  --autoGasTopUp true \
  --fresh \
  --dry-run true \
  --gasTopUpTarget 100000000000000
```

**Vérifier dans les logs :**
- `DEBUG: Vérification du contexte dryRun: { contextDryRun: true, paramsDryRun: true }`
- `DEBUG: SwapService - dryRun reçu: true`
- `DEBUG: LiquidityPositionService - dryRun reçu: true`
- Pas de transactions réelles envoyées

### **Étape 3: Test RÉEL (transactions on-chain)**
```bash
node dist/cli/run.js full \
  --privateKey "0x<TA_VRAIE_CLE>" \
  --bridgeAmount 0 \
  --bridgeToken USDC \
  --swapAmount 0.2 \
  --swapPair "PENGU/USDC" \
  --lpRange 5 \
  --collectAfter 0 \
  --autoGasTopUp true \
  --fresh \
  --dry-run false \
  --gasTopUpTarget 100000000000000
```

**Vérifier dans les logs :**
- `DEBUG: Vérification du contexte dryRun: { contextDryRun: false, paramsDryRun: false }`
- `DEBUG: SwapService - dryRun reçu: false`
- `DEBUG: LiquidityPositionService - dryRun reçu: false`
- Transactions envoyées avec txHash
- TokenId sauvegardé dans `.state`

### **Étape 4: Tests de vérification**

#### **Vérifier l'état :**
```bash
node dist/cli/run.js status --privateKey "0x<TA_VRAIE_CLE>"
```

#### **Collect manuel :**
```bash
node dist/cli/run.js collect --privateKey "0x<TA_VRAIE_CLE>"
```

#### **Unwrap WETH (si nécessaire) :**
```bash
node dist/cli/run.js unwrap-weth --privateKey "0x<TA_VRAIE_CLE>" --amount 0.0001
```

## 🔍 Points d'attention

### **Si tu vois encore "DRY_RUN: Swap simulé" :**
1. Vérifier que `.env` n'a pas `DRY_RUN=true`
2. Vérifier les logs de debug `contextDryRun` vs `paramsDryRun`
3. S'assurer que `--dry-run false` est bien passé

### **Approvals :**
- USDC.e → SwapRouter Abstract
- PENGU/USDC → NonfungiblePositionManager

### **Sécurité :**
- Utiliser `.env` avec `PRIVATE_KEY=0x...`
- Ne pas exposer la clé privée dans les logs/captures

## 🎉 Critères de succès

Le bot est **100% autonome** si tu vois :

1. ✅ **Swap réel** : txHash + nouveaux soldes
2. ✅ **Mint LP réel** : tokenId sauvegardé dans `.state`
3. ✅ **Collect réel** : frais collectés avec succès
4. ✅ **Bilan coûts** : ΔETH, Δtokens, gas total
5. ✅ **Logs cohérents** : `dryRun: false` partout

## 🚨 En cas de problème

### **Erreur "Solde insuffisant" :**
- Vérifier les soldes sur Abscan
- Ajuster `--swapAmount` ou bridger plus

### **Erreur "Pool introuvable" :**
- Vérifier les adresses des tokens dans `.env`
- Vérifier que le pool PENGU/USDC existe sur Abstract

### **Erreur "TokenId non trouvé" :**
- Vérifier que `.state` contient les données LP
- Relancer avec `--fresh` si nécessaire

---

**🎯 Une fois ces tests passés, ton bot est prêt pour la production !**
