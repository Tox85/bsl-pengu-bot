// ABI pour Permit2
export const PERMIT2_ABI = [
  'function approve(address token, address spender, uint160 amount, uint48 expiration) external',
  'function allowance(address owner, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)'
];

// Adresses
export const PERMIT2_ADDRESS = '0x000000000022d473030f116ddee9f6b43ac78ba3';
export const V3_SWAP_ROUTER_02 = '0x7712FA47387542819d4E35A23f8116C90C18767C';

// Constantes
export const MAX_UINT160 = (1n << 160n) - 1n;
export const ONE_YEAR = 365n * 24n * 60n * 60n;
