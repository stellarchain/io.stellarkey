import {
  Address,
  FeeBumpTransaction,
  scValToNative,
  Transaction,
  TransactionBuilder,
  type xdr,
} from '@stellar/stellar-sdk';
import type { PrivateBalanceManifest } from '../../../lib/private-balance-manifest';

export interface PrivateBalanceTransactionReviewRequest {
  envelopeXdr: string;
  manifest: Pick<PrivateBalanceManifest, 'networkPassphrase' | 'poolContractId'>;
  assetContractId: string;
  source: string;
  sequence: string;
  timeBounds: { minTime: string; maxTime: string };
  operation: xdr.Operation;
  simulationTransactionDataXdr: string;
  maximumClassicFeeStroops: bigint;
  maximumResourceFeeStroops: bigint;
}

export interface PrivateBalanceTransactionReview {
  envelopeXdr: string;
  transactionHash: string;
  method: 'deposit' | 'transfer' | 'withdraw';
  classicFeeStroops: bigint;
  resourceFeeStroops: bigint;
  expiresAt: number;
}

function sameXdr(left: { toXDR(format?: 'raw' | 'hex' | 'base64'): Uint8Array | string }, right: string): boolean {
  return left.toXDR('base64') === right;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function transactionData(transaction: Transaction): xdr.SorobanTransactionData {
  const envelope = transaction.toEnvelope();
  if (envelope.type !== 'envelopeTypeTx' || envelope.value.tx.ext.type !== 'sorobanData') {
    throw new Error('Private transaction is missing reviewed Soroban simulation data');
  }
  return envelope.value.tx.ext.value;
}

function reviewedOperation(transaction: Transaction): xdr.Operation {
  const envelope = transaction.toEnvelope();
  if (envelope.type !== 'envelopeTypeTx') {
    throw new Error('Private transaction envelope type is unsupported');
  }
  return envelope.value.tx.operations[0];
}

function invokeOperation(operation: xdr.Operation): xdr.InvokeHostFunctionOp {
  if (operation.body.type !== 'invokeHostFunction') {
    throw new Error('Private transaction must contain the reviewed host-function operation');
  }
  return operation.body.invokeHostFunctionOp;
}

function contractCall(operation: xdr.Operation): xdr.InvokeContractArgs {
  const hostFunction = invokeOperation(operation).hostFunction;
  if (hostFunction.type !== 'hostFunctionTypeInvokeContract') {
    throw new Error('Private transaction must invoke one known pool method');
  }
  return hostFunction.invokeContract;
}

function sameNullableXdr(
  left: { toXDR(format?: 'raw' | 'hex' | 'base64'): Uint8Array | string } | null,
  right: { toXDR(format?: 'raw' | 'hex' | 'base64'): Uint8Array | string } | null,
): boolean {
  if (left === null || right === null) return left === right;
  return left.toXDR('base64') === right.toXDR('base64');
}

function validateOperationExceptSimulationAuth(actual: xdr.Operation, expected: xdr.Operation): void {
  const actualInvocation = invokeOperation(actual);
  const expectedInvocation = invokeOperation(expected);
  if ((expectedInvocation.auth?.length ?? 0) !== 0) {
    throw new Error('Locally prepared Private Balance operation unexpectedly contains authorization');
  }
  if (
    !sameNullableXdr(actual.sourceAccount, expected.sourceAccount) ||
    actualInvocation.hostFunction.toXDR('base64') !== expectedInvocation.hostFunction.toXDR('base64')
  ) {
    throw new Error('Private transaction operation does not match the locally prepared action');
  }
}

function contractInvocation(invocation: xdr.SorobanAuthorizedInvocation): xdr.InvokeContractArgs {
  if (invocation.function.type !== 'sorobanAuthorizedFunctionTypeContractFn') {
    throw new Error('Private transaction authorization contains an unsupported function');
  }
  return invocation.function.contractFn;
}

function validateDepositAuthorization(
  auth: xdr.SorobanAuthorizationEntry[],
  invocation: xdr.InvokeContractArgs,
  request: PrivateBalanceTransactionReviewRequest,
): void {
  if (auth.length !== 1 || auth[0].credentials.type !== 'sorobanCredentialsSourceAccount') {
    throw new Error('Private deposit must contain exactly one source-account authorization');
  }
  const root = auth[0].rootInvocation;
  const rootCall = contractInvocation(root);
  if (rootCall.toXDR('base64') !== invocation.toXDR('base64') || root.subInvocations.length !== 1) {
    throw new Error('Private deposit authorization does not match the reviewed pool call');
  }

  const action = scValToNative(invocation.args[0]) as unknown;
  if (!action || typeof action !== 'object' || Array.isArray(action)) {
    throw new Error('Private deposit action is malformed');
  }
  const fields = action as Record<string, unknown>;
  if (
    fields.deposit_source !== request.source ||
    fields.asset !== request.assetContractId ||
    typeof fields.public_value !== 'bigint'
  ) {
    throw new Error('Private deposit source or amount does not match the reviewed action');
  }

  const transferInvocation = root.subInvocations[0];
  const transfer = contractInvocation(transferInvocation);
  const transferArgs = transfer.args.map(value => scValToNative(value) as unknown);
  if (
    Address.fromScAddress(transfer.contractAddress).toString() !== request.assetContractId ||
    transfer.functionName.toString() !== 'transfer' ||
    transferInvocation.subInvocations.length !== 0 ||
    transferArgs.length !== 3 ||
    transferArgs[0] !== request.source ||
    transferArgs[1] !== request.manifest.poolContractId ||
    transferArgs[2] !== fields.public_value
  ) {
    throw new Error('Private deposit authorization contains an unexpected asset transfer');
  }
}

function validateAuthorization(
  operation: xdr.Operation,
  method: PrivateBalanceTransactionReview['method'],
  invocation: xdr.InvokeContractArgs,
  request: PrivateBalanceTransactionReviewRequest,
): void {
  const auth = invokeOperation(operation).auth ?? [];
  if (method === 'deposit') {
    validateDepositAuthorization(auth, invocation, request);
    return;
  }
  if (auth.length !== 0) {
    throw new Error('Private transaction contains unexpected authorization entries');
  }
}

function invokedMethod(transaction: Transaction, poolContractId: string): PrivateBalanceTransactionReview['method'] {
  const operation = transaction.operations[0];
  if (operation.type !== 'invokeHostFunction' || operation.func.type !== 'hostFunctionTypeInvokeContract') {
    throw new Error('Private transaction must invoke one known pool method');
  }
  const invocation = operation.func.invokeContract;
  if (Address.fromScAddress(invocation.contractAddress).toString() !== poolContractId) {
    throw new Error('Private transaction pool contract does not match the manifest');
  }
  const functionName = invocation.functionName.toString();
  if (!['deposit', 'transfer', 'withdraw'].includes(functionName)) {
    throw new Error('Private transaction method is unsupported');
  }
  return functionName as PrivateBalanceTransactionReview['method'];
}

/**
 * Reviews the final, simulated envelope that will be handed to the signing
 * callback. The generated operation and simulation transaction data are
 * compared byte-for-byte with the locally prepared intent.
 */
export function reviewPrivateBalanceTransaction(
  request: PrivateBalanceTransactionReviewRequest,
): PrivateBalanceTransactionReview {
  if (request.maximumClassicFeeStroops < 0n || request.maximumResourceFeeStroops < 0n) {
    throw new Error('Private transaction fee caps must be non-negative');
  }

  const parsed = TransactionBuilder.fromXdr(request.envelopeXdr, request.manifest.networkPassphrase);
  if (parsed instanceof FeeBumpTransaction || !(parsed instanceof Transaction)) {
    throw new Error('Private transaction cannot be fee-bumped');
  }
  if (parsed.signatures.length !== 0) {
    throw new Error('Private transaction must be reviewed before signing');
  }
  if (parsed.source !== request.source) throw new Error('Private transaction source does not match');
  if (parsed.sequence !== request.sequence) throw new Error('Private transaction sequence does not match');
  if (parsed.memo.type !== 'none') throw new Error('Private transaction must not contain a memo');
  if (parsed.operations.length !== 1) throw new Error('Private transaction must contain exactly one operation');
  if (
    parsed.timeBounds?.minTime !== request.timeBounds.minTime ||
    parsed.timeBounds.maxTime !== request.timeBounds.maxTime
  ) {
    throw new Error('Private transaction time bounds do not match');
  }
  if (
    parsed.ledgerBounds !== undefined ||
    parsed.minAccountSequence !== undefined ||
    parsed.minAccountSequenceAge !== undefined ||
    parsed.minAccountSequenceLedgerGap !== undefined ||
    (parsed.extraSigners?.length ?? 0) !== 0
  ) {
    throw new Error('Private transaction contains unexpected preconditions');
  }

  const method = invokedMethod(parsed, request.manifest.poolContractId);
  const actualOperation = reviewedOperation(parsed);
  validateOperationExceptSimulationAuth(actualOperation, request.operation);
  validateAuthorization(
    actualOperation,
    method,
    contractCall(request.operation),
    request,
  );

  const data = transactionData(parsed);
  if (!sameXdr(data, request.simulationTransactionDataXdr)) {
    throw new Error('Private transaction simulation data does not match the reviewed simulation');
  }
  const resourceFeeStroops = BigInt(data.resourceFee.toString());
  const totalFeeStroops = BigInt(parsed.fee);
  const classicFeeStroops = totalFeeStroops - resourceFeeStroops;
  if (resourceFeeStroops < 0n || resourceFeeStroops > request.maximumResourceFeeStroops) {
    throw new Error('Private transaction resource fee exceeds the reviewed cap');
  }
  if (classicFeeStroops < 0n || classicFeeStroops > request.maximumClassicFeeStroops) {
    throw new Error('Private transaction classic fee exceeds the reviewed cap');
  }

  const envelopeXdr = parsed.toXdr();
  return {
    envelopeXdr,
    transactionHash: bytesToHex(parsed.hash()),
    method,
    classicFeeStroops,
    resourceFeeStroops,
    expiresAt: Number(request.timeBounds.maxTime),
  };
}
