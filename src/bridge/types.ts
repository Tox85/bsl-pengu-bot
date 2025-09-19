// Types pour l'API Li.Fi
export interface LiFiRoute {
  id: string;
  fromChainId: number;
  toChainId: number;
  fromToken: LiFiToken;
  toToken: LiFiToken;
  fromAmount: string;
  toAmount: string;
  steps: LiFiStep[];
  tags: string[];
  tool: string;
  bridgeUsed: string;
  transactionRequest?: LiFiTransactionRequest;
}

export interface LiFiToken {
  address: string;
  symbol: string;
  decimals: number;
  chainId: number;
  name: string;
  logoURI?: string;
}

export interface LiFiStep {
  id: string;
  type: 'swap' | 'cross' | 'lifi';
  tool: string;
  toolDetails: {
    key: string;
    name: string;
    logoURI: string;
  };
  action: LiFiAction;
  estimate: LiFiEstimate;
  includedSteps: LiFiStep[];
}

export interface LiFiAction {
  fromChainId: number;
  toChainId: number;
  fromToken: LiFiToken;
  toToken: LiFiToken;
  fromAmount: string;
  toAmount: string;
  slippage: number;
  fromAddress: string;
  toAddress: string;
  fromBalance: string;
  toBalance: string;
}

export interface LiFiEstimate {
  fromAmount: string;
  toAmount: string;
  toAmountMin: string;
  approvalAddress: string;
  executionDuration: number;
  feeCosts: LiFiFeeCost[];
  gasCosts: LiFiGasCost[];
}

export interface LiFiFeeCost {
  name: string;
  description: string;
  percentage: string;
  token: LiFiToken;
  amount: string;
  amountUSD: string;
}

export interface LiFiGasCost {
  type: 'l1' | 'l2';
  price: string;
  estimate: string;
  limit: string;
  amount: string;
  amountUSD: string;
  token: LiFiToken;
}

export interface LiFiTransactionRequest {
  data: string;
  to: string;
  value: string;
  from: string;
  gasPrice: string;
  gasLimit: string;
}

export interface LiFiStatus {
  status: 'PENDING' | 'DONE' | 'FAILED';
  bridge: string;
  txHash: string;
  fromChainId: number;
  toChainId: number;
  fromToken: LiFiToken;
  toToken: LiFiToken;
  fromAmount: string;
  toAmount: string;
  sendingTx: {
    hash: string;
    chainId: number;
    blockNumber: number;
    txHash: string;
  };
  receivingTx?: {
    hash: string;
    chainId: number;
    blockNumber: number;
    txHash: string;
  };
}

// Types pour les paramètres de bridge
export interface BridgeParams {
  fromChainId: number;
  toChainId: number;
  fromTokenAddress: string;
  toTokenAddress: string;
  amount: string;
  fromAddress: string;
  toAddress: string;
  slippage: number;
}

// Types pour les résultats de bridge
export interface BridgeResult {
  route: LiFiRoute;
  txHash?: string;
  status?: LiFiStatus;
  success: boolean;
  error?: string;
}
