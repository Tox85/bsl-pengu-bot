// ABI pour SwapRouter02 (toutes les signatures)
export const SWAP_ROUTER_02_ABI = [
  // V1 avec deadline (sans payerIsUser)
  'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)',
  
  // V2 avec path bytes
  'function exactInput((bytes path,address recipient,uint256 amountIn,uint256 amountOutMinimum)) external payable returns (uint256 amountOut)',
  
  // V2 avec payerIsUser (version actuelle)
  'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96,bool payerIsUser)) external payable returns (uint256 amountOut)',
  
  // Custom errors pour décoder les reverts
  'error TransferFromFailed()',
  'error TooLittleReceived(uint256 amount)',
  'error InsufficientOutputAmount(uint256 amount)',
  'error InvalidPath()',
  'error Expired()',
  'error Permit2TransferFromFailed()'
];

// Adresse SwapRouter02 sur Abstract
export const SWAP_ROUTER_02_ADDRESS = '0x7712FA47387542819d4E35A23f8116C90C18767C';
