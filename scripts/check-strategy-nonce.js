#!/usr/bin/env node

import { JsonRpcProvider, Wallet } from 'ethers';
import dotenv from 'dotenv';

dotenv.config();

const RPC_BASE = process.env.RPC_BASE || 'https://mainnet.base.org';
const STRATEGY_MNEMONIC = process.env.STRATEGY_MNEMONIC;
const HUB_WALLET_INDEX = parseInt(process.env.HUB_WALLET_INDEX || '0');

async function checkStrategyNonce() {
  if (!STRATEGY_MNEMONIC) {
    console.error('STRATEGY_MNEMONIC not found in .env');
    process.exit(1);
  }
  
  const provider = new JsonRpcProvider(RPC_BASE);
  
  // Générer le portefeuille de stratégie (index 0 des satellites)
  const hdNode = Wallet.fromPhrase(STRATEGY_MNEMONIC, provider);
  const strategyWallet = hdNode.deriveChild(1); // Index 1 = premier satellite
  
  console.log('Strategy wallet address:', strategyWallet.address);
  
  try {
    // Vérifier le nonce actuel
    const nonce = await strategyWallet.getNonce();
    console.log('Current nonce:', nonce);
    
    // Vérifier le nonce pending
    const pendingNonce = await strategyWallet.getNonce('pending');
    console.log('Pending nonce:', pendingNonce);
    
    // Vérifier le solde
    const balance = await provider.getBalance(strategyWallet.address);
    console.log('Balance:', (Number(balance) / 1e18).toFixed(6), 'ETH');
    
    if (pendingNonce > nonce) {
      console.log('Il y a des transactions en attente. Tentative de reset...');
      
      // Envoyer une transaction avec un nonce plus élevé pour "débloquer"
      const tx = await strategyWallet.sendTransaction({
        to: strategyWallet.address, // Se transférer à soi-même
        value: 0,
        nonce: nonce + 10, // Utiliser un nonce beaucoup plus élevé
        gasLimit: 21000,
      });
      
      console.log('Reset transaction sent:', tx.hash);
      console.log('Attendez quelques minutes puis relancez le bot.');
    } else {
      console.log('Aucune transaction en attente détectée.');
    }
    
  } catch (error) {
    console.error('Erreur:', error.message);
  }
}

checkStrategyNonce().catch(console.error);
