export const UNIV3_POOL_ABI = [
  { "type":"function","name":"slot0","stateMutability":"view","inputs":[],"outputs":[
    {"name":"sqrtPriceX96","type":"uint160"},{"name":"tick","type":"int24"},
    {"name":"observationIndex","type":"uint16"},{"name":"observationCardinality","type":"uint16"},
    {"name":"observationCardinalityNext","type":"uint16"},{"name":"feeProtocol","type":"uint8"},
    {"name":"unlocked","type":"bool"}
  ]},
  { "type":"function","name":"liquidity","stateMutability":"view","inputs":[],"outputs":[{"name":"liquidity","type":"uint128"}] },
  { "type":"function","name":"tickSpacing","stateMutability":"view","inputs":[],"outputs":[{"name":"tickSpacing","type":"int24"}] },
  { "type":"function","name":"fee","stateMutability":"view","inputs":[],"outputs":[{"name":"fee","type":"uint24"}] },
  { "type":"function","name":"token0","stateMutability":"view","inputs":[],"outputs":[{"name":"token0","type":"address"}] },
  { "type":"function","name":"token1","stateMutability":"view","inputs":[],"outputs":[{"name":"token1","type":"address"}] }
] as const;
