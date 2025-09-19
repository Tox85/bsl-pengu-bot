#!/bin/bash

# Script de configuration du projet ABS Bridge→Swap→LP Bot

echo "🚀 Configuration du projet ABS Bridge→Swap→LP Bot..."

# Vérifier Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js n'est pas installé. Veuillez installer Node.js 18+"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js version 18+ requis. Version actuelle: $(node -v)"
    exit 1
fi

echo "✅ Node.js $(node -v) détecté"

# Vérifier npm/pnpm
if command -v pnpm &> /dev/null; then
    PACKAGE_MANAGER="pnpm"
    echo "✅ pnpm détecté"
elif command -v npm &> /dev/null; then
    PACKAGE_MANAGER="npm"
    echo "✅ npm détecté"
else
    echo "❌ Aucun gestionnaire de paquets détecté"
    exit 1
fi

# Installer les dépendances
echo "📦 Installation des dépendances..."
$PACKAGE_MANAGER install

# Copier le fichier de configuration
if [ ! -f .env ]; then
    echo "📝 Création du fichier .env..."
    cp env.example .env
    echo "✅ Fichier .env créé. Veuillez le configurer avec vos valeurs."
else
    echo "✅ Fichier .env existe déjà"
fi

# Créer le dossier d'état
if [ ! -d .state ]; then
    echo "📁 Création du dossier d'état..."
    mkdir -p .state
    echo "✅ Dossier .state créé"
else
    echo "✅ Dossier .state existe déjà"
fi

# Build du projet
echo "🔨 Build du projet..."
$PACKAGE_MANAGER run build

if [ $? -eq 0 ]; then
    echo "✅ Build réussi"
else
    echo "❌ Erreur lors du build"
    exit 1
fi

# Tests
echo "🧪 Exécution des tests..."
$PACKAGE_MANAGER run test:run

if [ $? -eq 0 ]; then
    echo "✅ Tests réussis"
else
    echo "⚠️  Certains tests ont échoué, mais le setup continue"
fi

echo ""
echo "🎉 Configuration terminée!"
echo ""
echo "📋 Prochaines étapes:"
echo "1. Éditer le fichier .env avec vos valeurs"
echo "2. Vérifier les adresses des tokens sur abscan/pandora UI"
echo "3. Tester en mode DRY_RUN:"
echo "   $PACKAGE_MANAGER tsx src/cli/run.ts full --privateKey 0x... --bridgeAmount 0.01 --bridgeToken ETH --swapAmount 0.001 --swapPair PENGU/ETH --lpRange 5 --collectAfter 10 --dry-run"
echo ""
echo "📚 Documentation: README.md"
echo "🔧 CLI disponible: src/cli/"
echo ""
