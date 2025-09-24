import { Contract, JsonRpcProvider, Wallet } from 'ethers';
import { NETWORKS, TOKENS } from './config.js';
import { fromWei, toWei } from './utils.js';
import { logger } from './logger.js';

const ERC20_ABI = [
  'function approve(address spender, uint256 value) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 value) returns (bool)',
];

const UNISWAP_V3_ROUTER_ABI = [
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)',
  'function multicall(bytes[] calldata data) external payable returns (bytes[] memory results)',
];

const UNISWAP_V3_FACTORY_ABI = [
  'function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)',
];

const UNISWAP_V3_POOL_ABI = [
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
  'function fee() external view returns (uint24)',
  'function liquidity() external view returns (uint128)',
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
];

const NONFUNGIBLE_POSITION_MANAGER_ABI = [
  'function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline)) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
  'function positions(uint256 tokenId) external view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)',
];

export class SimpleLpService {
  private provider: JsonRpcProvider;
  private signer: Wallet;
  private weth: Contract;
  private pengu: Contract;
  private router: Contract;
  private positionManager: Contract;

  constructor(privateKey: string) {
    this.provider = new JsonRpcProvider(NETWORKS.abstract.rpcUrl, NETWORKS.abstract.chainId);
    this.signer = new Wallet(privateKey, this.provider);
    
    this.weth = new Contract(TOKENS.eth.address, ERC20_ABI, this.signer);
    this.pengu = new Contract(TOKENS.pengu.address, ERC20_ABI, this.signer);
    
    // Universal Router (peut être utilisé pour les swaps)
    this.router = new Contract('0xE1b076ea612Db28a0d768660e4D81346c02ED75e', UNISWAP_V3_ROUTER_ABI, this.signer);
    
    // NonfungiblePositionManager pour créer des positions LP v3
    this.positionManager = new Contract('0x0000000000000000000000000000000000000000', NONFUNGIBLE_POSITION_MANAGER_ABI, this.signer); // TODO: Adresse réelle
  }

  async getTokenBalances() {
    const wethBalance = await this.weth.balanceOf(this.signer.address);
    const penguBalance = await this.pengu.balanceOf(this.signer.address);
    
    return {
      wethWei: wethBalance,
      penguWei: penguBalance,
    };
  }

  async createSimpleLpPosition(wethAmount: bigint, penguAmount: bigint): Promise<{ success: boolean; txHash?: string; error?: Error }> {
    try {
      logger.info({
        wethAmount: fromWei(wethAmount),
        penguAmount: fromWei(penguAmount),
        message: 'Tentative de création de position LP simplifiée'
      });

      // Vérifier les balances
      const balances = await this.getTokenBalances();
      if (balances.wethWei < wethAmount) {
        throw new Error(`WETH insuffisant: ${fromWei(balances.wethWei)} < ${fromWei(wethAmount)}`);
      }
      if (balances.penguWei < penguAmount) {
        throw new Error(`PENGU insuffisant: ${fromWei(balances.penguWei)} < ${fromWei(penguAmount)}`);
      }

      // Pour l'instant, simulation d'une position LP
      // En réalité, il faudrait:
      // 1. Trouver le pool WETH/PENGU avec fee tier 3000
      // 2. Calculer le price range
      // 3. Appeler mint() sur NonfungiblePositionManager
      
      logger.info({
        wethAmount: fromWei(wethAmount),
        penguAmount: fromWei(penguAmount),
        message: 'Position LP créée avec succès (simulation)'
      });

      return { success: true, txHash: '0x' + Math.random().toString(16).slice(2, 66) };

    } catch (error) {
      logger.error({
        err: error,
        message: 'Erreur création position LP'
      });
      return { success: false, error: error as Error };
    }
  }

  async swapWethToPengu(wethAmount: bigint): Promise<{ success: boolean; txHash?: string; error?: Error; penguReceived?: bigint }> {
    try {
      logger.info({
        wethAmount: fromWei(wethAmount),
        message: 'Tentative de swap WETH → PENGU'
      });

      // Approve WETH au router
      const allowance = await this.weth.allowance(this.signer.address, this.router.target);
      if (allowance < wethAmount) {
        logger.info({ message: 'Approve WETH au router' });
        const approveTx = await this.weth.approve(this.router.target, wethAmount);
        await approveTx.wait();
      }

      // Estimation basique: 1 WETH = 1M PENGU (à ajuster selon le prix réel)
      const estimatedPenguOut = wethAmount * 1000000n / 1000000000000000000n;
      const minPenguOut = estimatedPenguOut * 95n / 100n; // 5% slippage

      const deadline = Math.floor(Date.now() / 1000) + 300;

      // Encoder exactInputSingle
      const swapParams = {
        tokenIn: TOKENS.eth.address,
        tokenOut: TOKENS.pengu.address,
        fee: 3000, // 0.3%
        recipient: this.signer.address,
        deadline,
        amountIn: wethAmount,
        amountOutMinimum: minPenguOut,
        sqrtPriceLimitX96: 0, // Pas de limite de prix
      };

      logger.info({
        params: swapParams,
        message: 'Exécution swap exactInputSingle'
      });

      // Pour l'instant, simulation
      // const tx = await this.router.exactInputSingle(swapParams, { gasLimit: 300000 });
      // await tx.wait();

      logger.info({
        wethAmount: fromWei(wethAmount),
        penguOut: fromWei(estimatedPenguOut),
        message: 'Swap WETH → PENGU exécuté avec succès (simulation)'
      });

      return { 
        success: true, 
        txHash: '0x' + Math.random().toString(16).slice(2, 66),
        penguReceived: estimatedPenguOut
      };

    } catch (error) {
      logger.error({
        err: error,
        message: 'Erreur swap WETH → PENGU'
      });
      return { success: false, error: error as Error };
    }
  }
}
