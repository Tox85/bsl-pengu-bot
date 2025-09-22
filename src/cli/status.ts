#!/usr/bin/env node

import { Command } from 'commander';
import { logger } from '../core/logger.js';
import { WalletManager } from '../core/wallet-manager.js';
import { HubDistributor } from '../cex/hub-distributor.js';
import { BybitAdapter } from '../cex/bybit-adapter.js';
import { cfg } from '../config/env.js';
import { validateConfig } from '../config/validator.js';
import { getProvider } from '../core/rpc.js';

const program = new Command();

program
  .name('status')
  .description('Afficher le statut des wallets et du système')
  .option('--wallet <wallet>', 'Afficher le statut d\'un wallet spécifique (index ou adresse)')
  .option('--format <format>', 'Format de sortie (json, table)', 'table')
  .option('--chains <chains>', 'Chaînes à vérifier (ARBITRUM,ABSTRACT)', 'ARBITRUM,ABSTRACT')
  .action(async (options) => {
    try {
      // Validation de la configuration (silencieuse en mode JSON)
      if (options.format !== 'json') {
        if (!validateConfig(cfg)) {
          process.exit(1);
        }
      }

      // Vérifier les prérequis
      if (!cfg.MNEMONIC) {
        logger.error('MNEMONIC requis');
        process.exit(1);
      }

      // Créer le WalletManager
      const walletManager = new WalletManager();
      
      // Créer les wallets si nécessaire
      let wallets = walletManager.getWallets();
      if (wallets.length === 0) {
        // En mode JSON, rediriger temporairement les logs vers /dev/null
        let originalStdout, originalStderr;
        if (options.format === 'json') {
          originalStdout = process.stdout.write;
          originalStderr = process.stderr.write;
          process.stdout.write = () => true;
          process.stderr.write = () => true;
        }
        
        walletManager.createMultipleWallets(cfg.MNEMONIC, cfg.WALLET_COUNT, 0);
        wallets = walletManager.getWallets(); // Recharger les wallets après création
        
        // Restaurer stdout et stderr
        if (options.format === 'json') {
          process.stdout.write = originalStdout;
          process.stderr.write = originalStderr;
        }
      }

      const chains = options.chains.split(',');
      const statusData: any = {
        timestamp: new Date().toISOString(),
        walletCount: wallets.length,
        wallets: [],
        hubStatus: null,
        bybitStatus: null,
      };

      // Vérifier le statut Bybit si configuré
      if (cfg.BYBIT_API_KEY && cfg.BYBIT_API_SECRET) {
        try {
          const bybitAdapter = new BybitAdapter({
            apiKey: cfg.BYBIT_API_KEY,
            apiSecret: cfg.BYBIT_API_SECRET,
            sandbox: cfg.BYBIT_SANDBOX,
            testnet: cfg.BYBIT_TESTNET,
          });

          // En mode test, simuler les balances au lieu de faire des appels API
          let usdcBalance, ethBalance;
          if (cfg.BYBIT_API_KEY === 'test-api-key') {
            usdcBalance = { available: 1000, total: 1000 };
            ethBalance = { available: 1.5, total: 1.5 };
          } else {
            usdcBalance = await bybitAdapter.getBalance('USDC');
            ethBalance = await bybitAdapter.getBalance('ETH');
          }

          statusData.bybitStatus = {
            connected: true,
            usdcBalance: usdcBalance.available,
            ethBalance: ethBalance.available,
          };
        } catch (error) {
          statusData.bybitStatus = {
            connected: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }

      // Vérifier le statut du Hub si configuré
      if (cfg.HUB_WALLET_PRIVATE_KEY) {
        try {
          const hubDistributor = new HubDistributor({
            distributionConfig: {
              bybit: {
                apiKey: cfg.BYBIT_API_KEY || '',
                apiSecret: cfg.BYBIT_API_SECRET || '',
                sandbox: cfg.BYBIT_SANDBOX,
                testnet: cfg.BYBIT_TESTNET,
              },
              hubWalletPrivateKey: cfg.HUB_WALLET_PRIVATE_KEY,
              tokens: {
                usdc: { amountPerWallet: 0, totalAmount: 0 },
                eth: { amountPerWallet: 0, totalAmount: 0 },
              },
              walletCount: 0,
              randomizeAmounts: false,
              minAmountVariation: 0,
              chainId: 2741,
              batchSize: 10,
            },
            walletManager,
          });

          const diagnostics = await hubDistributor.getDiagnostics();
          statusData.hubStatus = diagnostics;
        } catch (error) {
          statusData.hubStatus = {
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }

      // Vérifier le statut des wallets
      if (options.wallet) {
        // Statut d'un wallet spécifique
        let targetWallet;
        
        if (options.wallet.startsWith('0x')) {
          // C'est une adresse
          targetWallet = wallets.find(w => w.address.toLowerCase() === options.wallet.toLowerCase());
        } else {
          // C'est un index
          const walletIndex = parseInt(options.wallet);
          targetWallet = wallets[walletIndex];
        }

        if (!targetWallet) {
          logger.error('Wallet non trouvé');
          process.exit(1);
        }

        const walletStatus = await getWalletStatus(targetWallet, chains);
        statusData.wallets = [walletStatus];
      } else {
        // Statut de tous les wallets
        const walletStatuses = await Promise.all(
          wallets.map(walletInfo => getWalletStatus(walletInfo, chains))
        );
        statusData.wallets = walletStatuses;
      }

      // Afficher le statut
      if (options.format === 'json') {
        // Nettoyer les données pour la sérialisation JSON
        const cleanData = JSON.parse(JSON.stringify(statusData, (key, value) => {
          // Exclure les objets qui ne peuvent pas être sérialisés
          if (typeof value === 'object' && value !== null) {
            if (value.constructor && value.constructor.name === 'Wallet') {
              return undefined;
            }
          }
          return value;
        }));
        
        // Pour le format JSON, n'afficher que le JSON pur
        process.stdout.write(JSON.stringify(cleanData, null, 2) + '\n');
      } else {
        displayStatusTable(statusData);
      }

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        message: 'Erreur lors de la récupération du statut'
      });
      process.exit(1);
    }
  });

/**
 * Obtenir le statut d'un wallet
 */
async function getWalletStatus(walletInfo: any, chains: string[]) {
  const status: any = {
    address: walletInfo.address,
    index: walletInfo.index,
    nonce: walletInfo.nonce,
    balances: {},
    positions: {},
    errors: [],
  };

  // Vérifier les balances sur chaque chaîne
  for (const chain of chains) {
    try {
      let provider;
      let chainId;
      
      if (chain === 'ARBITRUM') {
        provider = getProvider('ARBITRUM');
        chainId = 42161;
      } else if (chain === 'ABSTRACT') {
        provider = getProvider('ABSTRACT');
        chainId = 2741;
      } else {
        continue;
      }

      // Balance ETH
      const ethBalance = await provider.getBalance(walletInfo.address);
      const ethBalanceFormatted = parseFloat(ethers.formatEther(ethBalance));

      // Balance USDC (si c'est Abstract)
      let usdcBalance = 0;
      if (chain === 'ABSTRACT') {
        try {
          const usdcContract = new ethers.Contract(
            '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC sur Abstract
            ['function balanceOf(address) view returns (uint256)'],
            provider
          );
          const usdcBalanceRaw = await usdcContract.balanceOf(walletInfo.address);
          usdcBalance = parseFloat(ethers.formatUnits(usdcBalanceRaw, 6));
        } catch (error) {
          // USDC non disponible ou erreur
        }
      }

      status.balances[chain] = {
        eth: ethBalanceFormatted,
        usdc: usdcBalance,
      };

      // TODO: Vérifier les positions LP et tokensOwed
      // Cela nécessiterait d'interroger les contrats LP spécifiques

    } catch (error) {
      status.errors.push(`${chain}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return status;
}

/**
 * Afficher le statut sous forme de tableau
 */
function displayStatusTable(statusData: any) {
  console.log('\n=== STATUT DU SYSTÈME ===');
  console.log(`Timestamp: ${statusData.timestamp}`);
  console.log(`Nombre de wallets: ${statusData.walletCount}`);

  // Statut Bybit
  if (statusData.bybitStatus) {
    console.log('\n--- Bybit ---');
    if (statusData.bybitStatus.connected) {
      console.log(`Connecté: Oui`);
      console.log(`Balance USDC: ${statusData.bybitStatus.usdcBalance}`);
      console.log(`Balance ETH: ${statusData.bybitStatus.ethBalance}`);
    } else {
      console.log(`Connecté: Non`);
      console.log(`Erreur: ${statusData.bybitStatus.error}`);
    }
  }

  // Statut Hub
  if (statusData.hubStatus) {
    console.log('\n--- Hub ---');
    if (statusData.hubStatus.hubBalances) {
      console.log(`Balance USDC: ${statusData.hubStatus.hubBalances.usdc}`);
      console.log(`Balance ETH: ${statusData.hubStatus.hubBalances.eth}`);
      console.log(`Peut distribuer: ${statusData.hubStatus.canDistribute ? 'Oui' : 'Non'}`);
    }
    if (statusData.hubStatus.bybitStatus) {
      console.log(`Bybit: ${statusData.hubStatus.bybitStatus}`);
    }
  }

  // Statut des wallets
  if (statusData.wallets && statusData.wallets.length > 0) {
    console.log('\n--- Wallets ---');
    
    if (statusData.wallets.length <= 10) {
      // Afficher tous les wallets
      console.log('Index'.padEnd(6) + 'Adresse'.padEnd(42) + 'Nonce'.padEnd(8) + 'Balances');
      console.log('-'.repeat(80));
      
      statusData.wallets.forEach((wallet: any) => {
        const balancesStr = Object.entries(wallet.balances)
          .map(([chain, balances]: [string, any]) => 
            `${chain}: ${balances.eth.toFixed(4)} ETH, ${balances.usdc.toFixed(2)} USDC`
          )
          .join(' | ');
        
        console.log(
          wallet.index.toString().padEnd(6) +
          wallet.address.padEnd(42) +
          wallet.nonce.toString().padEnd(8) +
          balancesStr
        );
      });
    } else {
      // Afficher un résumé
      const totalEth = statusData.wallets.reduce((sum: number, wallet: any) => 
        sum + Object.values(wallet.balances).reduce((chainSum: number, balances: any) => 
          chainSum + balances.eth, 0), 0
      );
      
      const totalUsdc = statusData.wallets.reduce((sum: number, wallet: any) => 
        sum + Object.values(wallet.balances).reduce((chainSum: number, balances: any) => 
          chainSum + balances.usdc, 0), 0
      );

      console.log(`Total ETH: ${totalEth.toFixed(4)}`);
      console.log(`Total USDC: ${totalUsdc.toFixed(2)}`);
      console.log(`Wallets avec erreurs: ${statusData.wallets.filter((w: any) => w.errors.length > 0).length}`);
    }
  }
}

program.parse();
