export const NONFUNGIBLE_POSITION_MANAGER_ABI = [
  // lecture d'une position
  {
    "type":"function","name":"positions","stateMutability":"view",
    "inputs":[{"name":"tokenId","type":"uint256"}],
    "outputs":[
      {"name":"nonce","type":"uint96"},
      {"name":"operator","type":"address"},
      {"name":"token0","type":"address"},
      {"name":"token1","type":"address"},
      {"name":"fee","type":"uint24"},
      {"name":"tickLower","type":"int24"},
      {"name":"tickUpper","type":"int24"},
      {"name":"liquidity","type":"uint128"},
      {"name":"feeGrowthInside0LastX128","type":"uint256"},
      {"name":"feeGrowthInside1LastX128","type":"uint256"},
      {"name":"tokensOwed0","type":"uint128"},
      {"name":"tokensOwed1","type":"uint128"}
    ]
  },

  // mint d'une nouvelle position
  {
    "type":"function","name":"mint","stateMutability":"payable",
    "inputs":[{"name":"params","type":"tuple","components":[
      {"name":"token0","type":"address"},
      {"name":"token1","type":"address"},
      {"name":"fee","type":"uint24"},
      {"name":"tickLower","type":"int24"},
      {"name":"tickUpper","type":"int24"},
      {"name":"amount0Desired","type":"uint256"},
      {"name":"amount1Desired","type":"uint256"},
      {"name":"amount0Min","type":"uint256"},
      {"name":"amount1Min","type":"uint256"},
      {"name":"recipient","type":"address"},
      {"name":"deadline","type":"uint256"}
    ]}],
    "outputs":[
      {"name":"tokenId","type":"uint256"},
      {"name":"liquidity","type":"uint128"},
      {"name":"amount0","type":"uint256"},
      {"name":"amount1","type":"uint256"}
    ]
  },

  // augmenter la liquidité
  {
    "type":"function","name":"increaseLiquidity","stateMutability":"payable",
    "inputs":[{"name":"params","type":"tuple","components":[
      {"name":"tokenId","type":"uint256"},
      {"name":"amount0Desired","type":"uint256"},
      {"name":"amount1Desired","type":"uint256"},
      {"name":"amount0Min","type":"uint256"},
      {"name":"amount1Min","type":"uint256"},
      {"name":"deadline","type":"uint256"}
    ]}],
    "outputs":[
      {"name":"liquidity","type":"uint128"},
      {"name":"amount0","type":"uint256"},
      {"name":"amount1","type":"uint256"}
    ]
  },

  // diminuer la liquidité
  {
    "type":"function","name":"decreaseLiquidity","stateMutability":"nonpayable",
    "inputs":[{"name":"params","type":"tuple","components":[
      {"name":"tokenId","type":"uint256"},
      {"name":"liquidity","type":"uint128"},
      {"name":"amount0Min","type":"uint256"},
      {"name":"amount1Min","type":"uint256"},
      {"name":"deadline","type":"uint256"}
    ]}],
    "outputs":[{"name":"amount0","type":"uint256"},{"name":"amount1","type":"uint256"}]
  },

  // collecter les frais
  {
    "type":"function","name":"collect","stateMutability":"nonpayable",
    "inputs":[{"name":"params","type":"tuple","components":[
      {"name":"tokenId","type":"uint256"},
      {"name":"recipient","type":"address"},
      {"name":"amount0Max","type":"uint128"},
      {"name":"amount1Max","type":"uint128"}
    ]}],
    "outputs":[{"name":"amount0","type":"uint256"},{"name":"amount1","type":"uint256"}]
  }
] as const;
