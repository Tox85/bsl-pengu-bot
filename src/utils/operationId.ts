import { createHash } from 'crypto';

/**
 * Generate a unique operation ID for idempotence
 */
export function generateOperationId(
  address: string,
  intent: string,
  params: Record<string, any> = {}
): string {
  const data = {
    address: address.toLowerCase(),
    intent,
    params: JSON.stringify(params, Object.keys(params).sort()),
    timestamp: Math.floor(Date.now() / 1000) // Round to seconds for idempotence
  };

  const hash = createHash('sha256')
    .update(JSON.stringify(data))
    .digest('hex');

  return `op_${hash.substring(0, 16)}`;
}

/**
 * Check if an operation has already been executed
 */
export function isOperationExecuted(
  state: any,
  operationId: string
): boolean {
  if (!state.executedOperations) {
    return false;
  }
  
  return state.executedOperations.includes(operationId);
}

/**
 * Mark an operation as executed
 */
export function markOperationExecuted(
  state: any,
  operationId: string
): void {
  if (!state.executedOperations) {
    state.executedOperations = [];
  }
  
  if (!state.executedOperations.includes(operationId)) {
    state.executedOperations.push(operationId);
  }
}

/**
 * Common operation intents
 */
export const OPERATION_INTENTS = {
  BRIDGE: 'bridge',
  SWAP: 'swap',
  LP_CREATE: 'lp_create',
  LP_COLLECT: 'lp_collect',
  WITHDRAW: 'withdraw',
  DISTRIBUTE: 'distribute'
} as const;

export type OperationIntent = typeof OPERATION_INTENTS[keyof typeof OPERATION_INTENTS];

