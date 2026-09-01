import {
  FeeBumpTransaction,
  Operation,
  SorobanDataBuilder,
  Transaction,
  TransactionBuilder,
  rpc as SorobanRpc,
} from '@stellar/stellar-sdk';
import type { PrivateBalanceManifest } from '../../../lib/private-balance-manifest';
import { deriveArchiveRecordLedgerKey } from './archive-client';

const RESTORE_REVIEW_WINDOW_SECONDS = 5 * 60;
const DEFAULT_CONFIRMATION_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000] as const;
const HEX_32 = /^[0-9a-f]{64}$/;

interface PrivateArchiveRestorationRpc {
  getAccount(address: string): Promise<Awaited<ReturnType<SorobanRpc.Server['getAccount']>>>;
  simulateTransaction(
    transaction: ReturnType<TransactionBuilder['build']>,
  ): Promise<SorobanRpc.Api.SimulateTransactionResponse>;
}

interface PrivateArchiveRestorationSubmissionRpc {
  sendTransaction(transaction: Transaction): Promise<{
    status: 'PENDING' | 'DUPLICATE' | 'TRY_AGAIN_LATER' | 'ERROR';
    hash: string;
  }>;
  getTransaction(hash: string): Promise<{
    status: 'SUCCESS' | 'FAILED' | 'NOT_FOUND';
    txHash?: string;
  }>;
}

export interface PrivateArchiveRestorationReview {
  actionIndex: number;
  envelopeXdr: string;
  transactionHash: string;
  source: string;
  classicFeeStroops: bigint;
  resourceFeeStroops: bigint;
  expiresAt: number;
}

export interface PreparedPrivateArchiveRestoration {
  actionIndex: number;
  review: PrivateArchiveRestorationReview;
  simulationLedger: number;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function sorobanData(transaction: Transaction): SorobanDataBuilder {
  const envelope = transaction.toEnvelope();
  if (envelope.type !== 'envelopeTypeTx' || envelope.value.tx.ext.type !== 'sorobanData') {
    throw new Error('Archive restoration is missing Soroban transaction data.');
  }
  return new SorobanDataBuilder(envelope.value.tx.ext.value);
}

function sameKey(left: { toXDR(format: 'base64'): string }, right: { toXDR(format: 'base64'): string }): boolean {
  return left.toXDR('base64') === right.toXDR('base64');
}

function assertExactRestoreFootprint(
  transaction: Transaction,
  expectedKey: ReturnType<typeof deriveArchiveRecordLedgerKey>,
): void {
  const data = sorobanData(transaction);
  const readOnly = data.getReadOnly();
  const readWrite = data.getReadWrite();
  if (
    readOnly.length !== 0 ||
    readWrite.length !== 1 ||
    !sameKey(readWrite[0], expectedKey)
  ) {
    throw new Error('Archive restoration must contain exactly the requested archive record.');
  }
}

function reviewRestoration(input: {
  transaction: Transaction;
  source: string;
  actionIndex: number;
  expectedKey: ReturnType<typeof deriveArchiveRecordLedgerKey>;
  maximumClassicFeeStroops: bigint;
  maximumResourceFeeStroops: bigint;
  expiresAt: number;
}): PrivateArchiveRestorationReview {
  const transaction = input.transaction;
  if (transaction.signatures.length !== 0) {
    throw new Error('Archive restoration must be reviewed before signing.');
  }
  if (transaction.source !== input.source) {
    throw new Error('Archive restoration source does not match the active account.');
  }
  if (transaction.memo.type !== 'none' || transaction.operations.length !== 1) {
    throw new Error('Archive restoration envelope contains unexpected data.');
  }
  if (transaction.operations[0].type !== 'restoreFootprint') {
    throw new Error('Archive restoration envelope contains an unexpected operation.');
  }
  if (
    transaction.timeBounds?.minTime !== '0' ||
    transaction.timeBounds.maxTime !== String(input.expiresAt) ||
    transaction.ledgerBounds !== undefined ||
    transaction.minAccountSequence !== undefined ||
    transaction.minAccountSequenceAge !== undefined ||
    transaction.minAccountSequenceLedgerGap !== undefined ||
    (transaction.extraSigners?.length ?? 0) !== 0
  ) {
    throw new Error('Archive restoration envelope contains unexpected preconditions.');
  }
  assertExactRestoreFootprint(transaction, input.expectedKey);
  const data = sorobanData(transaction).build();
  const resourceFeeStroops = BigInt(data.resourceFee.toString());
  const totalFeeStroops = BigInt(transaction.fee);
  const classicFeeStroops = totalFeeStroops - resourceFeeStroops;
  if (
    resourceFeeStroops < 0n ||
    resourceFeeStroops > input.maximumResourceFeeStroops ||
    classicFeeStroops < 1n ||
    classicFeeStroops > input.maximumClassicFeeStroops
  ) {
    throw new Error('Archive restoration fee exceeds the reviewed cap.');
  }
  return {
    actionIndex: input.actionIndex,
    envelopeXdr: transaction.toXdr(),
    transactionHash: bytesToHex(transaction.hash()),
    source: input.source,
    classicFeeStroops,
    resourceFeeStroops,
    expiresAt: input.expiresAt,
  };
}

export async function preparePrivateArchiveRestoration(input: {
  rpc: PrivateArchiveRestorationRpc;
  manifest: Pick<PrivateBalanceManifest, 'networkPassphrase' | 'poolContractId'>;
  source: string;
  actionIndex: number;
  classicFeeStroops: bigint;
  maximumResourceFeeStroops: bigint;
  nowSeconds?: number;
}): Promise<PreparedPrivateArchiveRestoration> {
  if (!Number.isInteger(input.actionIndex) || input.actionIndex < 0 || input.actionIndex > 0xffff_ffff) {
    throw new Error('Archive restoration action index is invalid.');
  }
  if (input.classicFeeStroops < 1n || input.classicFeeStroops > 0xffff_ffffn) {
    throw new Error('Archive restoration classic fee is outside the supported range.');
  }
  if (input.maximumResourceFeeStroops < 0n) {
    throw new Error('Archive restoration resource fee cap is invalid.');
  }
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) {
    throw new Error('Archive restoration review time is invalid.');
  }
  const expiresAt = nowSeconds + RESTORE_REVIEW_WINDOW_SECONDS;
  const expectedKey = deriveArchiveRecordLedgerKey(
    input.manifest.poolContractId,
    input.actionIndex,
  );
  const account = await input.rpc.getAccount(input.source);
  const raw = new TransactionBuilder(account, {
    fee: input.classicFeeStroops.toString(),
    networkPassphrase: input.manifest.networkPassphrase,
    timebounds: { minTime: 0, maxTime: expiresAt },
  })
    .setSorobanData(new SorobanDataBuilder().setFootprint([], [expectedKey]).build())
    .addOperation(Operation.restoreFootprint({}))
    .build();
  const simulation = await input.rpc.simulateTransaction(raw);
  if (SorobanRpc.Api.isSimulationError(simulation)) {
    throw new Error(`Archive restoration simulation failed: ${simulation.error}`);
  }
  if (SorobanRpc.Api.isSimulationRestore(simulation)) {
    throw new Error('Archive restoration simulation requested a nested restoration.');
  }
  if (!SorobanRpc.Api.isSimulationSuccess(simulation)) {
    throw new Error('Archive restoration simulation returned an unsupported response.');
  }
  const simulatedData = simulation.transactionData.build();
  const simulatedFootprint = new SorobanDataBuilder(simulatedData);
  if (
    simulatedFootprint.getReadOnly().length !== 0 ||
    simulatedFootprint.getReadWrite().length !== 1 ||
    !sameKey(simulatedFootprint.getReadWrite()[0], expectedKey)
  ) {
    throw new Error('RPC did not preserve the exact archive record restoration footprint.');
  }
  const resourceFee = BigInt(simulation.minResourceFee);
  if (resourceFee < 0n || resourceFee > input.maximumResourceFeeStroops) {
    throw new Error('Archive restoration simulated resource fee exceeds the approved cap.');
  }
  const prepared = SorobanRpc.assembleTransaction(raw, simulation).build();
  const review = reviewRestoration({
    transaction: prepared,
    source: input.source,
    actionIndex: input.actionIndex,
    expectedKey,
    maximumClassicFeeStroops: input.classicFeeStroops,
    maximumResourceFeeStroops: input.maximumResourceFeeStroops,
    expiresAt,
  });
  return { actionIndex: input.actionIndex, review, simulationLedger: simulation.latestLedger };
}

export async function submitPrivateArchiveRestoration(input: {
  review: PrivateArchiveRestorationReview;
  networkPassphrase: string;
  sign(request: {
    envelopeXdr: string;
    expectedTransactionHash: string;
    networkPassphrase: string;
  }): Promise<string>;
  rpc: PrivateArchiveRestorationSubmissionRpc;
  delays?: readonly number[];
  sleep?: (milliseconds: number) => Promise<void>;
  nowSeconds?: number;
}): Promise<{ transactionHash: string }> {
  if (!HEX_32.test(input.review.transactionHash)) {
    throw new Error('Archive restoration transaction hash is invalid.');
  }
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (nowSeconds >= input.review.expiresAt) {
    throw new Error('Archive restoration review expired. Review it again to continue.');
  }
  const signedEnvelopeXdr = await input.sign({
    envelopeXdr: input.review.envelopeXdr,
    expectedTransactionHash: input.review.transactionHash,
    networkPassphrase: input.networkPassphrase,
  });
  const signed = TransactionBuilder.fromXdr(signedEnvelopeXdr, input.networkPassphrase);
  if (signed instanceof FeeBumpTransaction || !(signed instanceof Transaction)) {
    throw new Error('Signed archive restoration envelope is unsupported.');
  }
  if (
    signed.source !== input.review.source ||
    signed.signatures.length === 0 ||
    bytesToHex(signed.hash()) !== input.review.transactionHash ||
    signed.operations.length !== 1 ||
    signed.operations[0].type !== 'restoreFootprint'
  ) {
    throw new Error('Signed archive restoration does not match the reviewed transaction.');
  }
  const submitted = await input.rpc.sendTransaction(signed);
  if (submitted.hash.toLowerCase() !== input.review.transactionHash) {
    throw new Error('RPC returned a different archive restoration hash.');
  }
  if (submitted.status !== 'PENDING' && submitted.status !== 'DUPLICATE') {
    throw new Error(`Archive restoration submission was not accepted (${submitted.status}).`);
  }
  const sleep = input.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  for (const delay of input.delays ?? DEFAULT_CONFIRMATION_DELAYS_MS) {
    if (!Number.isSafeInteger(delay) || delay < 0) {
      throw new Error('Archive restoration confirmation delay is invalid.');
    }
    await sleep(delay);
    const result = await input.rpc.getTransaction(input.review.transactionHash);
    if (result.txHash && result.txHash.toLowerCase() !== input.review.transactionHash) {
      throw new Error('RPC returned a different archive restoration hash during confirmation.');
    }
    if (result.status === 'SUCCESS') {
      return { transactionHash: input.review.transactionHash };
    }
    if (result.status === 'FAILED') {
      throw new Error('Archive restoration failed on Stellar.');
    }
  }
  throw new Error('Archive restoration is still pending. Check again before retrying.');
}
