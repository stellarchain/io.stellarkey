import {
  Address,
  FeeBumpTransaction,
  Operation,
  scValToNative,
  Transaction,
  TransactionBuilder,
  type xdr,
} from '@stellar/stellar-sdk';

const HEX_32 = /^[0-9a-f]{64}$/u;
const HEX_4 = /^[0-9a-f]{8}$/u;
const MAX_RELAY_REVIEW_WINDOW_SECONDS = 5 * 60;

export interface PrivateRelayReviewedOutput {
  commitment: Uint8Array;
  recipientEnvelope: Uint8Array;
}

export interface PrivateRelayJobReview {
  transaction: Transaction;
  transactionHash: string;
  method: 'transfer' | 'withdraw';
  source: string;
  assetIndex: number;
  actionNonce: Uint8Array;
  outputs: [PrivateRelayReviewedOutput, PrivateRelayReviewedOutput, PrivateRelayReviewedOutput];
  classicFeeStroops: bigint;
  resourceFeeStroops: bigint;
  expiresAt: number;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function bytes(value: unknown, length: number, name: string): Uint8Array {
  if (!(value instanceof Uint8Array) || value.length !== length) {
    throw new Error(`Private relay ${name} is malformed`);
  }
  return value.slice();
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Private relay ${name} is malformed`);
  }
  return value as Record<string, unknown>;
}

function output(value: unknown, index: number): PrivateRelayReviewedOutput {
  const fields = object(value, `output ${index}`);
  return {
    commitment: bytes(fields.commitment, 32, `output ${index} commitment`),
    recipientEnvelope: bytes(fields.recipient_envelope, 181, `output ${index} envelope`),
  };
}

function sorobanResourceFee(transaction: Transaction): bigint {
  const envelope = transaction.toEnvelope();
  if (envelope.type !== 'envelopeTypeTx' || envelope.value.tx.ext.type !== 'sorobanData') {
    throw new Error('Private relay transaction is missing Soroban resource data');
  }
  return BigInt(envelope.value.tx.ext.value.resourceFee.toString());
}

export type PrivateRelayOperationReview = Pick<PrivateRelayJobReview, 'method' | 'assetIndex' | 'actionNonce' | 'outputs'>;

/** Validate the locally selected pool action before any helper RPC request. */
export function reviewPrivateRelayOperation(input: {
  operation: xdr.Operation;
  poolContractId: string;
  assetIndex: number;
  actionDiversifier: string;
  expectedMethod?: 'transfer' | 'withdraw';
}): PrivateRelayOperationReview {
  if (!HEX_4.test(input.actionDiversifier)) throw new Error('Private relay action diversifier is invalid');
  if (!Number.isSafeInteger(input.assetIndex) || input.assetIndex < 0 || input.assetIndex > 255) {
    throw new Error('Private relay asset index is invalid');
  }
  const operation = Operation.fromXDRObject(input.operation);
  if (operation.type !== 'invokeHostFunction' || operation.source !== undefined ||
    operation.func.type !== 'hostFunctionTypeInvokeContract') {
    throw new Error('Private relay transaction must invoke the private pool directly');
  }
  if ((operation.auth?.length ?? 0) !== 0) throw new Error('Private relay transaction contains authorization entries');
  const invocation = operation.func.invokeContract;
  if (Address.fromScAddress(invocation.contractAddress).toString() !== input.poolContractId) {
    throw new Error('Private relay transaction targets another contract');
  }
  const method = invocation.functionName.toString();
  if (method !== 'transfer' && method !== 'withdraw') throw new Error('Private relay helper only signs a private transfer or withdraw');
  if (input.expectedMethod && method !== input.expectedMethod) throw new Error('Private relay method does not match the selected request');
  if (invocation.args.length !== 2) throw new Error('Private relay pool invocation is malformed');
  const action = object(scValToNative(invocation.args[0]), 'action');
  const actionNonce = bytes(action.action_nonce, 32, 'action nonce');
  const outputs = [output(action.output_0, 0), output(action.output_1, 1), output(action.output_2, 2)] as PrivateRelayJobReview['outputs'];
  for (const candidate of outputs) {
    if (bytesToHex(candidate.recipientEnvelope.slice(1, 5)) !== input.actionDiversifier) {
      throw new Error('Private relay action does not use the selected lane diversifier');
    }
  }
  if (typeof action.public_value !== 'bigint') throw new Error('Private relay public value is malformed');
  if (method === 'transfer' && action.public_value !== 0n) throw new Error('Private relay transfer exposes an unexpected public value');
  if (method === 'withdraw' && action.asset_index !== input.assetIndex) throw new Error('Private relay withdrawal uses another asset');
  return { method, assetIndex: input.assetIndex, actionNonce, outputs };
}

/**
 * Parses an untrusted peer job without relying on sender-provided labels.
 * Only one unsigned transfer/withdraw invocation to the selected pool, from
 * the helper account, inside a short time and fee window is accepted.
 */
export function reviewPrivateRelayJob(input: {
  unsignedEnvelopeXdr: string;
  transactionHash: string;
  networkPassphrase: string;
  expectedSource: string;
  poolContractId: string;
  assetIndex: number;
  actionDiversifier: string;
  maximumClassicFeeStroops: bigint;
  maximumResourceFeeStroops: bigint;
  nowSeconds?: number;
}): PrivateRelayJobReview {
  if (!HEX_32.test(input.transactionHash)) throw new Error('Private relay transaction hash is invalid');
  if (!HEX_4.test(input.actionDiversifier)) throw new Error('Private relay action diversifier is invalid');
  if (!Number.isSafeInteger(input.assetIndex) || input.assetIndex < 0) {
    throw new Error('Private relay asset index is invalid');
  }
  if (input.maximumClassicFeeStroops < 1n || input.maximumResourceFeeStroops < 0n) {
    throw new Error('Private relay fee policy is invalid');
  }
  const parsed = TransactionBuilder.fromXdr(input.unsignedEnvelopeXdr, input.networkPassphrase);
  if (parsed instanceof FeeBumpTransaction || !(parsed instanceof Transaction)) {
    throw new Error('Private relay transaction envelope is unsupported');
  }
  if (parsed.signatures.length !== 0) throw new Error('Private relay job must be unsigned');
  if (parsed.source !== input.expectedSource) throw new Error('Private relay source is not this account');
  const transactionHash = bytesToHex(parsed.hash());
  if (transactionHash !== input.transactionHash) throw new Error('Private relay transaction hash changed');
  if (parsed.memo.type !== 'none') throw new Error('Private relay transaction must not contain a memo');
  if (parsed.operations.length !== 1) throw new Error('Private relay transaction must contain one operation');
  if (
    parsed.ledgerBounds !== undefined ||
    parsed.minAccountSequence !== undefined ||
    parsed.minAccountSequenceAge !== undefined ||
    parsed.minAccountSequenceLedgerGap !== undefined ||
    (parsed.extraSigners?.length ?? 0) !== 0
  ) {
    throw new Error('Private relay transaction contains unsupported preconditions');
  }
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const minTime = Number(parsed.timeBounds?.minTime ?? '-1');
  const expiresAt = Number(parsed.timeBounds?.maxTime ?? '0');
  if (
    !Number.isSafeInteger(now) ||
    minTime !== 0 ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= now ||
    expiresAt > now + MAX_RELAY_REVIEW_WINDOW_SECONDS
  ) {
    throw new Error('Private relay transaction time window is invalid');
  }

  const envelope = parsed.toEnvelope();
  if (envelope.type !== 'envelopeTypeTx') throw new Error('Private relay envelope is unsupported');
  const operationReview = reviewPrivateRelayOperation({ ...input, operation: envelope.value.tx.operations[0] });

  const resourceFeeStroops = sorobanResourceFee(parsed);
  const totalFeeStroops = BigInt(parsed.fee);
  const classicFeeStroops = totalFeeStroops - resourceFeeStroops;
  if (resourceFeeStroops < 0n || resourceFeeStroops > input.maximumResourceFeeStroops) {
    throw new Error('Private relay resource fee exceeds policy');
  }
  if (classicFeeStroops < 1n || classicFeeStroops > input.maximumClassicFeeStroops) {
    throw new Error('Private relay classic fee exceeds policy');
  }
  return {
    transaction: parsed,
    transactionHash,
    ...operationReview,
    source: parsed.source,
    classicFeeStroops,
    resourceFeeStroops,
    expiresAt,
  };
}
