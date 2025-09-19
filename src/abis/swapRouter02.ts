export const SWAP_ROUTER_02_ABI = [
  // exactInputSingle, struct SANS deadline (IV3SwapRouter / SwapRouter02)
  {
    "type":"function","name":"exactInputSingle","stateMutability":"payable",
    "inputs":[{"name":"params","type":"tuple","components":[
      {"name":"tokenIn","type":"address"},
      {"name":"tokenOut","type":"address"},
      {"name":"fee","type":"uint24"},
      {"name":"recipient","type":"address"},
      {"name":"amountIn","type":"uint256"},
      {"name":"amountOutMinimum","type":"uint256"},
      {"name":"sqrtPriceLimitX96","type":"uint160"}
    ]}],
    "outputs":[{"name":"amountOut","type":"uint256"}]
  },

  // (optionnel) exactOutputSingle pour futures stratégies
  {
    "type":"function","name":"exactOutputSingle","stateMutability":"payable",
    "inputs":[{"name":"params","type":"tuple","components":[
      {"name":"tokenIn","type":"address"},
      {"name":"tokenOut","type":"address"},
      {"name":"fee","type":"uint24"},
      {"name":"recipient","type":"address"},
      {"name":"amountOut","type":"uint256"},
      {"name":"amountInMaximum","type":"uint256"},
      {"name":"sqrtPriceLimitX96","type":"uint160"}
    ]}],
    "outputs":[{"name":"amountIn","type":"uint256"}]
  },

  // utilitaires fréquents
  { "type":"function","name":"refundETH","stateMutability":"payable","inputs":[],"outputs":[] },
  { "type":"function","name":"unwrapWETH9","stateMutability":"payable","inputs":[
      {"name":"amountMinimum","type":"uint256"},{"name":"recipient","type":"address"}],"outputs":[] }
] as const;
