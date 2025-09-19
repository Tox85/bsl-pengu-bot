export const UNIV3_FACTORY_ABI = [
  {
    "type":"function","name":"getPool","stateMutability":"view",
    "inputs":[{"name":"tokenA","type":"address"},{"name":"tokenB","type":"address"},{"name":"fee","type":"uint24"}],
    "outputs":[{"name":"pool","type":"address"}]
  },
  {
    "type":"function","name":"feeAmountTickSpacing","stateMutability":"view",
    "inputs":[{"name":"fee","type":"uint24"}],
    "outputs":[{"name":"tickSpacing","type":"int24"}]
  }
] as const;
