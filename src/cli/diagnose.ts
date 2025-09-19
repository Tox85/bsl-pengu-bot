import { Command } from "commander";
import pino from "pino";
import { JsonRpcProvider, Wallet } from "ethers";
import { LiFiClient } from "../bridge/lifi.js";
import { cfg } from "../config/env.js";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

const FROM_CHAIN = cfg.BASE_CHAIN_ID;
const TO_CHAIN = cfg.ABSTRACT_CHAIN_ID;
const BASE_RPC = cfg.BASE_RPC_URL;
const PRIV = cfg.PRIVATE_KEY;
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_ABS = cfg.USDC_ADDRESS_ABS;

const program = new Command();

program
  .name("diagnose")
  .description("Diagnostic Li.Fi + chaînes + quote")
  .option("--amount <n>", "amount human (USDC)", "0.01")
  .option("--verbose", "affichage détaillé")
  .action(async (opts) => {
    try {
      logger.info({
        fromChain: FROM_CHAIN,
        toChain: TO_CHAIN,
        usdcBase: USDC_BASE,
        usdcAbs: USDC_ABS,
        message: "Démarrage du diagnostic Li.Fi"
      });

      // 1. Vérifier la connexion RPC et wallet
      const fromProvider = new JsonRpcProvider(BASE_RPC);
      const w = new Wallet(PRIV, fromProvider);
      const address = await w.getAddress();
      logger.info({ address }, "Wallet chargé");

      // 2. Tester la connexion Li.Fi
      const lifi = new LiFiClient(fromProvider);
      
      logger.info("Vérification des chaînes supportées par Li.Fi...");
      const chains = await lifi.getChains();
      
      const abs = chains.find((c: any) => c.id === TO_CHAIN);
      if (!abs) {
        logger.error({ 
          chainsCount: chains.length,
          availableChains: chains.map((c: any) => ({ id: c.id, name: c.name })).slice(0, 10)
        }, "Abstract (2741) non trouvé dans /chains");
        process.exit(1);
      }
      logger.info({ name: abs.name, id: abs.id, key: abs.key }, "Li.Fi voit Abstract ✅");

      // 3. Tester un quote USDC Base -> USDC Abstract
      logger.info("Test du quote USDC Base -> USDC Abstract...");
      const q = await lifi.quoteUSDCBaseToAbstractUSDC({
        fromChain: FROM_CHAIN, 
        toChain: TO_CHAIN,
        usdcBase: USDC_BASE, 
        usdcAbs: USDC_ABS,
        fromAmountHuman: opts.amount, // Montant humain (ex: "0.01")
        fromAddress: address
      });

      logger.info({ 
        estimate: q?.estimate, 
        tool: q?.tool,
        bridgeUsed: q?.bridgeUsed,
        message: "Quote OK ✅" 
      });

      if (opts.verbose) {
        console.log("\n=== DÉTAILS DU QUOTE ===");
        console.log(JSON.stringify(q, null, 2));
      }

      // 4. Résumé
      console.log("\n=== RÉSUMÉ DIAGNOSTIC ===");
      console.log(`✅ Wallet: ${address}`);
      console.log(`✅ RPC Base: ${BASE_RPC}`);
      console.log(`✅ Li.Fi chains: ${chains.length} chaînes supportées`);
      console.log(`✅ Abstract (${TO_CHAIN}): ${abs.name} (${abs.key})`);
      console.log(`✅ Quote USDC: ${opts.amount} Base -> Abstract via ${q?.tool || 'unknown'}`);
      console.log(`✅ Bridge: ${q?.bridgeUsed || 'unknown'}`);
      
      if (q?.estimate) {
        console.log(`💰 Estimation: ${q.estimate.fromAmount} -> ${q.estimate.toAmount}`);
      }

    } catch (e: any) {
      logger.error({ 
        msg: e.message, 
        status: e?.response?.status, 
        data: e?.response?.data,
        stack: opts.verbose ? e.stack : undefined
      }, "Diagnostic échoué ❌");
      
      if (e?.response?.status === 429) {
        console.log("\n💡 SOLUTION: Rate limit Li.Fi - attendez quelques minutes ou ajoutez une clé API");
      } else if (e?.response?.status === 404) {
        console.log("\n💡 SOLUTION: Route non trouvée - vérifiez les adresses de tokens dans .env");
      }
      
      process.exit(1);
    }
  });

// Parse si appelé directement
if (import.meta.url === `file://${process.argv[1]}`) {
  program.parseAsync().catch(console.error);
}

export { program as diagnoseProgram };
