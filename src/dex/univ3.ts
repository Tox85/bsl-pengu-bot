/**
 * ABI minimales pour Uniswap v3 sur Abstract
 */

export const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)"
];

export const UNISWAP_V3_QUOTER_V2_ABI = [
  // QuoterV2: params struct = (address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)
  "function quoteExactInputSingle((address,address,uint256,uint24,uint160)) external view returns (uint256 amountOut, uint160 sqrtPriceX96, uint32 initializedTicksCrossed, uint256 gasEstimate)"
];

export const UNISWAP_V3_FACTORY_ABI = [
  "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address)"
];

export const UNISWAP_V3_POOL_ABI = [
  "function liquidity() view returns (uint128)",
  "function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16,uint16,uint16,uint8,bool)"
];

export const UNISWAP_V3_SWAP_ROUTER_02_ABI = [
  "function exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160)) payable returns (uint256)"
];

