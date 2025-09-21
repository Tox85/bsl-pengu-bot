import axios from "axios";
import pino from "pino";
import { parseUnits, Wallet, JsonRpcProvider, Contract, ZeroAddress, MaxUint256, NonceManager } from "ethers";
import { ERC20_MIN_ABI } from "../abis/erc20.js";
import { cfg } from "../config/env.js";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

const LIFI_URL = cfg.LIFI_BASE_URL;
const LIFI_HEADERS: Record<string,string> = { accept: "application/json" };
if (cfg.LIFI_API_KEY) LIFI_HEADERS["x-lifi-api-key"] = cfg.LIFI_API_KEY;

const client = axios.create({ 
  baseURL: LIFI_URL, 
  headers: LIFI_HEADERS, 
  timeout: 60_000 // Augmenter à 60s pour les bridges
});

let lastCall = 0;
async function throttle(ms=400) {
  const now = Date.now();
  const wait = Math.max(0, lastCall + ms - now);
  if (wait) await new Promise(r => setTimeout(r, wait));
  lastCall = Date.now();
}

async function with429Retry<T>(fn: () => Promise<T>, max = 5) {
  let base = 1000; // 1s
  for (let i=1;i<=max;i++) {
    try {
      await throttle();
      return await fn();
    } catch (e:any) {
      const status = e?.response?.status;
      const isTimeout = e?.code === 'ECONNABORTED' || e?.message?.includes('timeout');
      const is429 = status === 429;
      
      if (!is429 && !isTimeout) throw e;
      if (i === max) throw e;
      
      let delay: number;
      if (is429) {
        // Parse Retry-After header (en SECONDES)
        const ra = Number(e.response?.headers?.["retry-after"]);
        const retryAfterMs = Number.isFinite(ra) ? ra * 1000 : base;
        const jitter = 200 + Math.floor(Math.random()*600);
        delay = Math.min(15_000, retryAfterMs + jitter);
        
        logger.warn({ 
          attempt: i, 
          maxRetries: max, 
          delay,
          retryAfter: ra,
          message: "Rate limit Li.Fi, retry en cours" 
        });
      } else {
        // Timeout: backoff exponentiel
        delay = Math.min(15_000, base * i);
        logger.warn({ 
          attempt: i, 
          maxRetries: max, 
          delay,
          message: "Timeout Li.Fi, retry en cours" 
        });
      }
      
      await new Promise(r => setTimeout(r, delay));
      base = Math.min(base*2, 15_000);
    }
  }
  // unreachable
}

export interface BridgeParams {
  fromChainId: number;
  toChainId: number;
  fromTokenAddress: string;
  toTokenAddress: string;
  amount: string;
  fromAddress: string;
  toAddress: string;
  slippage: number;
}

export interface LiFiRoute {
  id: string;
  fromChainId: number;
  toChainId: number;
  fromToken: {
    address: string;
    symbol: string;
    decimals: number;
    chainId: number;
    name: string;
  };
  toToken: {
    address: string;
    symbol: string;
    decimals: number;
    chainId: number;
    name: string;
  };
  fromAmount: string;
  toAmount: string;
  steps: any[];
  tags: string[];
  tool: string;
  bridgeUsed: string;
}

export interface LiFiTransactionRequest {
  to: string;
  data: string;
  value: string;
  gasLimit: string;
  gasPrice?: string;
}

// Helper pour extraire le transactionRequest
function extractTxRequest(quoteOrRoute: any) {
  // Cas 1: /quote renvoie directement transactionRequest
  if (quoteOrRoute?.transactionRequest?.to && typeof quoteOrRoute?.transactionRequest?.data === "string") {
    return quoteOrRoute.transactionRequest;
  }
  // Cas 2: /routes renvoie steps[0].transactionRequest
  const step = quoteOrRoute?.steps?.[0];
  if (step?.transactionRequest?.to && typeof step?.transactionRequest?.data === "string") {
    return step.transactionRequest;
  }
  throw new Error("LiFi: transactionRequest introuvable dans la réponse.");
}

// Helper pour gérer l'approval USDC
async function ensureAllowance({
  signer, token, spender, requiredHuman
}: { signer:any; token:string; spender:string; requiredHuman:string; }) {
  if (!token || token === ZeroAddress) return; // natif: pas d'approve
  
  const erc = new Contract(token, ERC20_MIN_ABI, signer);
  const dec = await erc.decimals();
  const required = parseUnits(requiredHuman, dec);
  const current = await erc.allowance(await signer.getAddress(), spender);
  
  logger.info({
    token,
    spender,
    current: current.toString(),
    required: required.toString(),
    message: "Vérification allowance"
  });
  
  if (current >= required) {
    logger.info({ message: "Allowance suffisante" });
    return;
  }

  logger.info({
    spender,
    amount: required.toString(),
    message: "Approve USDC requis"
  });
  
  const tx = await erc.approve(spender, required);
  await tx.wait();
  
  logger.info({
    txHash: tx.hash,
    message: "Approve USDC confirmé"
  });
}

export class LiFiClient {
  private nonceSigner: NonceManager | null = null;
  
  constructor(private fromProvider: JsonRpcProvider) {}

  async getDecimals(token: string): Promise<number> {
    // AddressZero => natif => 18 par convention (mais ici on bridgera des ERC-20)
    if (/^0x0{40}$/i.test(token)) return 18;
    const erc = new Contract(token, ERC20_MIN_ABI, this.fromProvider);
    return await erc.decimals();
  }

  extractTxReq(quoteOrRoute: any) {
    if (quoteOrRoute?.transactionRequest) return quoteOrRoute.transactionRequest;
    const step = quoteOrRoute?.steps?.[0];
    if (step?.transactionRequest) return step.transactionRequest;
    throw new Error("No transactionRequest found in Li.Fi response");
  }

  detectBridgeName(quoteOrRoute: any) {
    // Li.Fi met souvent le nom du bridge dans "tool" ou dans le 1er step
    return quoteOrRoute?.tool || quoteOrRoute?.steps?.[0]?.tool || "lifi";
  }

  async executeQuoteBase({ signerBase, quote, humanFromAmount, fromToken, owner }:{
    signerBase:any, quote:any, humanFromAmount:string, fromToken:string, owner:string
  }) {
    // Initialiser le NonceManager si pas déjà fait
    if (!this.nonceSigner) {
      this.nonceSigner = new NonceManager(signerBase);
    }
    // 1) APPROVAL si nécessaire (USDC Base)
    const approvalAddress = quote?.estimate?.approvalAddress || quote?.approvalData?.spender || quote?.toolDetails?.allowanceTo;
    
    logger.info({
      approvalAddress,
      fromToken,
      humanFromAmount,
      message: "Vérification approval bridge"
    });
    
    if (approvalAddress && fromToken && fromToken !== "0x0000000000000000000000000000000000000000") {
      await ensureAllowance({
        signer: signerBase,
        token: fromToken,
        spender: approvalAddress,
        requiredHuman: humanFromAmount
      });
    }

    // 2) Tx request (doit contenir data non vide)
    const txReq = extractTxRequest(quote);
    if (!txReq?.to) throw new Error("LiFi: tx.to manquant");
    if (typeof txReq.data !== "string" || !txReq.data.startsWith("0x") || txReq.data.length <= 2) {
      throw new Error("LiFi: tx.data vide ou invalide. Ne pas envoyer cette transaction.");
    }

    // 3) Nettoyer le txRequest pour éviter le nonce figé
    delete (txReq as any).nonce;
    delete (txReq as any).gasPrice; // Garder EIP-1559 si fourni

    // 4) Construire et envoyer avec NonceManager
    const tx = {
      to: txReq.to,
      data: txReq.data,
      value: txReq.value ? BigInt(txReq.value) : 0n,
      gasLimit: txReq.gasLimit ? BigInt(txReq.gasLimit) : undefined,
      maxFeePerGas: txReq.maxFeePerGas ? BigInt(txReq.maxFeePerGas) : undefined,
      maxPriorityFeePerGas: txReq.maxPriorityFeePerGas ? BigInt(txReq.maxPriorityFeePerGas) : undefined,
    };

    logger.info({
      to: tx.to,
      dataLength: tx.data.length,
      value: tx.value.toString(),
      gasLimit: tx.gasLimit?.toString(),
      message: "Exécution transaction bridge Li.Fi"
    });

    try {
      const sent = await this.nonceSigner.sendTransaction(tx);
      const receipt = await sent.wait();
      return receipt.hash;
    } catch (e: any) {
      const msg = (e?.message || '').toLowerCase();
      if (msg.includes('nonce too low') || e.code === 'NONCE_EXPIRED') {
        // Retry 1 fois avec nonce recalculé
        logger.warn({ message: "Nonce expiré, retry avec nonce recalculé" });
        const addr = await this.nonceSigner.getAddress();
        await this.nonceSigner.setNonce(
          await this.nonceSigner.provider!.getTransactionCount(addr, 'pending')
        );
        const sent = await this.nonceSigner.sendTransaction(tx);
        const receipt = await sent.wait();
        return receipt.hash;
      }
      throw e;
    }
  }

  async waitUntilReceived(params: { bridge: string; fromChain: number; toChain: number; txHash: string; timeoutMs?: number }) {
    const started = Date.now();
    const timeout = params.timeoutMs ?? 10 * 60_000; // 10 min
    
    logger.info({
      bridge: params.bridge,
      txHash: params.txHash,
      message: "Attente confirmation bridge Li.Fi"
    });
    
    while (true) {
      const res = await with429Retry(async () => {
        const r = await client.get("/status", { params: {
          bridge: params.bridge, 
          fromChain: params.fromChain, 
          toChain: params.toChain, 
          txHash: params.txHash
        }});
        return r.data;
      });
      
      const status = res?.status;
      logger.info({
        status,
        txHash: params.txHash,
        message: "Statut bridge Li.Fi"
      });
      
      if (status === "DONE" || status === "RECEIVED") {
        logger.info({
          status,
          txHash: params.txHash,
          message: "Bridge reçu avec succès"
        });
        return res;
      }
      
      if (Date.now() - started > timeout) {
        logger.error({
          status,
          tool: params.bridge,
          txHash: params.txHash,
          timeoutMs: timeout,
          message: "Bridge status timeout - réessayez avec un montant ≥ MIN_BRIDGE_USD"
        });
        throw new Error(`Bridge status timeout: ${status ?? "unknown"}. Réessayez avec un montant ≥ MIN_BRIDGE_USD.`);
      }
      
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  async getChains() {
    return with429Retry(async () => (await client.get("/chains")).data);
  }

  async pollRouteDone(routeId: string, { timeoutSec = 900, intervalMs = 3000 } = {}) {
    const end = Date.now() + timeoutSec * 1000;
    while (Date.now() < end) {
      const status = await this.getRouteStatus(routeId);
      logger.info({ routeId, status: status.status }, 'LiFi route status');
      if (status.status === 'DONE') return status;
      if (status.status === 'FAILED') throw new Error('Bridge FAILED on LiFi');
      await new Promise(r => setTimeout(r, intervalMs));
    }
    throw new Error('Bridge timeout waiting for DONE');
  }

  async getRouteStatus(routeId: string) {
    // Simuler le statut pour l'instant - à implémenter avec l'API Li.Fi
    return { status: 'DONE' };
  }

  async quoteBaseToAbstract(params: {
    fromChain:number; 
    toChain:number;
    fromToken:string; 
    toToken:string;
    fromAmountHuman:string; 
    fromAddress:string;
  }) {
    const dec = await this.getDecimals(params.fromToken);
    const fromAmount = parseUnits(params.fromAmountHuman, dec).toString();
    
    logger.info({ 
      ...params, 
      fromAmountHuman: params.fromAmountHuman,
      fromAmount,
      decimals: dec,
      message: "LiFi quote generic" 
    });

    return with429Retry(async () => {
      const res = await client.get("/quote", {
        params: {
          fromChain: params.fromChain,
          toChain: params.toChain,
          fromToken: params.fromToken,
          toToken: params.toToken,
          fromAmount,
          fromAddress: params.fromAddress
        }
      });
      return res.data; // contiendra un step avec transactionRequest à signer sur Base
    });
  }

  async quoteUSDCBaseToAbstractUSDC(params: {
    fromChain:number; 
    toChain:number;
    usdcBase:string; 
    usdcAbs:string;
    fromAmountHuman:string; 
    fromAddress:string;
  }) {
    const dec = await this.getDecimals(params.usdcBase); // devrait renvoyer 6
    const fromAmount = parseUnits(params.fromAmountHuman, dec).toString();
    
    logger.info({ 
      ...params, 
      fromAmount,
      decimals: dec,
      message: "LiFi quote USDC Base -> USDC Abstract" 
    });

    return with429Retry(async () => {
      const res = await client.get("/quote", {
        params: {
          fromChain: params.fromChain,
          toChain: params.toChain,
          fromToken: params.usdcBase,
          toToken: params.usdcAbs,
          fromAmount,
          fromAddress: params.fromAddress
        }
      });
      return res.data;
    });
  }

  // Méthode de compatibilité avec l'ancien code
  async getRoute(params: BridgeParams): Promise<LiFiRoute> {
    const route = await this.quoteBaseToAbstract({
      fromChain: params.fromChainId,
      toChain: params.toChainId,
      fromToken: params.fromTokenAddress,
      toToken: params.toTokenAddress,
      fromAmountHuman: params.amount,
      fromAddress: params.fromAddress
    });

    logger.info({
      routeId: route?.id || 'undefined',
      fromToken: route?.fromToken?.symbol || route?.fromToken?.address || 'undefined',
      toToken: route?.toToken?.symbol || route?.toToken?.address || 'undefined',
      fromAmount: route?.fromAmount || 'undefined',
      toAmount: route?.estimate?.toAmount || 'undefined',
      message: 'Route Li.Fi obtenue dans getRoute'
    });

    // Adapter la réponse au format attendu avec les vraies données Li.Fi
    return {
      id: route.id || 'route-' + Date.now(),
      fromChainId: params.fromChainId,
      toChainId: params.toChainId,
      fromToken: route.fromToken || {
        address: params.fromTokenAddress,
        symbol: params.fromTokenAddress === '0x0000000000000000000000000000000000000000' ? 'ETH' : 'UNKNOWN',
        decimals: 18,
        chainId: params.fromChainId,
        name: 'Unknown Token'
      },
      toToken: {
        address: params.toTokenAddress,
        symbol: params.toTokenAddress === '0x0000000000000000000000000000000000000000' ? 'ETH' : (route.toToken?.symbol || 'UNKNOWN'),
        decimals: route.toToken?.decimals || 18,
        chainId: params.toChainId,
        name: route.toToken?.name || 'Unknown Token'
      },
      fromAmount: route.fromAmount || params.amount,
      toAmount: route.estimate?.toAmount || params.amount,
      fromAmountHuman: params.amount, // Ajouter le montant humain
      steps: route.steps || [],
      tags: route.tags || [],
      tool: route.tool || 'unknown',
      bridgeUsed: route.bridgeUsed || 'unknown'
    };
  }
}

// Service de bridge
export class BridgeService {
  public lifiClient: LiFiClient;

  constructor() {
    // Utiliser le provider Base pour les appels Li.Fi
    const baseProvider = new JsonRpcProvider(cfg.BASE_RPC_URL);
    this.lifiClient = new LiFiClient(baseProvider);
  }

  async getBridgeRoute(params: BridgeParams): Promise<LiFiRoute> {
    // Corriger les paramètres pour Li.Fi
    const correctedParams = {
      ...params,
      // S'assurer que toToken est WETH9 sur Abstract (pas ETH natif)
      // SAUF pour le bridge ETH natif → ETH natif (top-up gas)
      toTokenAddress: (params.toTokenAddress === '0x0000000000000000000000000000000000000000' && 
                      params.fromTokenAddress === '0x0000000000000000000000000000000000000000')
        ? params.toTokenAddress  // Garder ETH natif pour ETH → ETH
        : (params.toTokenAddress === '0x0000000000000000000000000000000000000000' 
          ? cfg.WETH_ADDRESS_ABS  // ETH → WETH pour les autres cas
          : params.toTokenAddress)
    };

    logger.info({
      fromChainId: correctedParams.fromChainId,
      toChainId: correctedParams.toChainId,
      fromTokenAddress: correctedParams.fromTokenAddress,
      toTokenAddress: correctedParams.toTokenAddress,
      message: 'Paramètres Li.Fi corrigés'
    });

    // En mode DRY_RUN, simuler une route si Li.Fi échoue
    try {
      return await this.lifiClient.getRoute(correctedParams);
    } catch (error: any) {
      if (cfg.DRY_RUN && error.message?.includes('404')) {
        logger.warn({
          message: 'Li.Fi ne supporte pas Abstract, simulation en mode DRY_RUN'
        });
        
        // Simuler une route pour le test
        return {
          id: 'simulated-route',
          fromChainId: correctedParams.fromChainId,
          toChainId: correctedParams.toChainId,
          fromToken: { 
            address: correctedParams.fromTokenAddress, 
            symbol: 'USDC', 
            decimals: 6, 
            chainId: correctedParams.fromChainId, 
            name: 'USD Coin' 
          },
          toToken: { 
            address: correctedParams.toTokenAddress, 
            symbol: 'USDC', 
            decimals: 6, 
            chainId: correctedParams.toChainId, 
            name: 'USD Coin' 
          },
          fromAmount: correctedParams.amount,
          toAmount: correctedParams.amount, // Même montant pour la simulation
          steps: [],
          tags: ['simulated'],
          tool: 'simulated',
          bridgeUsed: 'simulated'
        };
      }
      throw error;
    }
  }

  async quoteBaseToAbstract(params: {
    fromChain: number;
    toChain: number;
    fromToken: string;
    toToken: string;
    fromAmountHuman: string;
    fromAddress: string;
  }) {
    return this.lifiClient.quoteBaseToAbstract(params);
  }

  async getRouteStatus(routeId: string) {
    // Simuler le statut pour l'instant
    return { status: 'DONE' };
  }

  async executeApproval(tokenAddress: string, spender: string, amount: string, signer: any) {
    // Utiliser la fonction ensureAllowance existante
    const { ensureAllowance } = await import('./lifi.js');
    return ensureAllowance({
      signer,
      token: tokenAddress,
      spender,
      requiredHuman: amount
    });
  }

  async executeRoute(route: LiFiRoute, signerOrPrivateKey: any, options: { dryRun?: boolean } = {}): Promise<{
    success: boolean;
    txHash?: string;
    error?: string;
    status?: { status: string };
  }> {
    if (options.dryRun) {
      logger.info({
        routeId: route.id,
        fromAmount: route.fromAmount,
        toAmount: route.toAmount,
        message: 'DRY_RUN: Route de bridge simulée'
      });
      
      return {
        success: true,
        txHash: '0x' + '0'.repeat(64), // Hash simulé
        status: { status: 'PENDING' }
      };
    }

    try {
      // Bridge réel - gérer soit un signer soit une private key
      let signer;
      if (typeof signerOrPrivateKey === 'string') {
        const baseProvider = new JsonRpcProvider(cfg.BASE_RPC_URL);
        signer = new Wallet(signerOrPrivateKey, baseProvider);
      } else {
        signer = signerOrPrivateKey; // C'est déjà un signer
      }
      
      // Obtenir le quote original pour l'exécution
      const quote = await this.lifiClient.quoteBaseToAbstract({
        fromChain: route.fromChainId,
        toChain: route.toChainId,
        fromToken: route.fromToken.address,
        toToken: route.toToken.address,
        fromAmountHuman: route.fromAmountHuman || route.fromAmount, // Utiliser le montant humain si disponible
        fromAddress: await signer.getAddress()
      });

      // Exécuter la transaction avec approval
      const txHash = await this.lifiClient.executeQuoteBase({
        signerBase: signer,
        quote,
        humanFromAmount: route.fromAmountHuman || route.fromAmount,
        fromToken: route.fromToken.address,
        owner: await signer.getAddress()
      });
      
      // Attendre la confirmation
      const status = await this.lifiClient.waitUntilReceived({
        bridge: this.lifiClient.detectBridgeName(quote),
        fromChain: route.fromChainId,
        toChain: route.toChainId,
        txHash
      });

      return {
        success: true,
        txHash,
        status: { status: status.status || 'RECEIVED' }
      };

    } catch (error: any) {
      logger.error({
        error: error.message,
        message: 'Bridge réel échoué'
      });
      
      return {
        success: false,
        error: error.message,
        status: { status: 'FAILED' }
      };
    }
  }
}

// Instance singleton
export const bridgeService = new BridgeService();