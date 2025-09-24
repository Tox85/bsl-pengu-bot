#!/usr/bin/env node

import { JsonRpcProvider, Wallet } from 'ethers';
import dotenv from 'dotenv';

dotenv.config();

const RPC_BASE = process.env.RPC_BASE || 'https://mainnet.base.org';
const BASE_FUNDING_PRIVATE_KEY = process.env.BASE_FUNDING_PRIVATE_KEY;

async function resetNonce() {
  if (!BASE_FUNDING_PRIVATE_KEY) {
    console.error('BASE_FUNDING_PRIVATE_KEY not found in .env');
    process.exit(1);
  }
  
  const provider = new JsonRpcProvider(RPC_BASE);
  const wallet = new Wallet(BASE_FUNDING_PRIVATE_KEY, provider);
  
  console.log('Wallet address:', wallet.address);
  
  try {
    // Vérifier le nonce actuel
    const nonce = await wallet.getNonce();
    console.log('Current nonce:', nonce);
    
    // Vérifier le nonce pending
    const pendingNonce = await wallet.getNonce('pending');
    console.log('Pending nonce:', pendingNonce);
    
    if (pendingNonce > nonce) {
      console.log('Il y a des transactions en attente. Tentative de reset...');
      
      // Envoyer une transaction avec un nonce plus élevé pour "débloquer"
      const tx = await wallet.sendTransaction({
        to: wallet.address, // Se transférer à soi-même
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

resetNonce().catch(console.error);
