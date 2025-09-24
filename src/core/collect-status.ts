// Statuts de collecte des frais LP
export type CollectStatus = 
  | 'collect_skipped'    // staticCall 0/0 → aucune tx envoyée
  | 'collect_executed'   // tx envoyée et minée avec succès
  | 'collect_failed';    // erreur pendant estimateGas / tx / parsing

// Résultat normalisé de collectFees
export interface CollectResult {
  executed: boolean;
  expected0: bigint;
  expected1: bigint;
  amount0: bigint;
  amount1: bigint;
  txHash?: string | null;
  gasUsed?: string;
  status: CollectStatus;
  reinvested0?: bigint;
  reinvested1?: bigint;
  reinvestTxHash?: string | null;
  cashedOutEth?: bigint;
  swapTxHash?: string | null;
  unwrapTxHash?: string | null;
  skippedReason?: string;
}
