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
const RESTORATION_RESOURCE_MARGIN_PERCENT = 80n;
const MAX_ARCHIVE_RESTORATION_BATCH = 200;
const HEX_32 = /^[0-9a-f]{64}$/;

interface PrivateArchiveRestorationRpc {
  getAccount(address: string): Promise<Awaited<ReturnType<SorobanRpc.Server['getAccount']>>>;
  simulateTransaction(
    transaction: ReturnType<TransactionBuilder['build']>,
  ): Promise<SorobanRpc.Api.SimulateTransactionResponse>;
}

interface PrivateArchiveRestorationDiscoveryRpc {
  getLedgerEntries(
    ...keys: ReturnType<typeof deriveArchiveRecordLedgerKey>[]
  ): Promise<{
    entries: Array<{
      key: ReturnType<typeof deriveArchiveRecordLedgerKey>;
      liveUntilLedgerSeq?: number;
    }>;
    latestLedger: number;
  }>;
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
  actionIndices: readonly number[];
  ledgerKeysXdr: readonly string[];
  envelopeXdr: string;
  transactionHash: string;
  source: string;
  classicFeeStroops: bigint;
  resourceFeeStroops: bigint;
  expiresAt: number;
}

export interface PreparedPrivateArchiveRestoration {
  actionIndices: readonly number[];
  review: PrivateArchiveRestorationReview;
  simulationLedger: number;
}

export interface PrivateArchiveRestorationProgress {
  startActionIndex: number;
  nextActionIndex: number;
  endActionIndexExclusive: number;
  restoredCount: number;
  totalCount: number;
  confirmedBatchSize: number;
}

export interface PrivateArchiveRestorationRange {
  startActionIndex: number;
  endActionIndexExclusive: number;
  probedEndActionIndexExclusive: number;
  latestLedger: number;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function abortError(): Error {
  return new DOMException('Private history restoration cancelled.', 'AbortError');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function abortableSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timeout);
      reject(abortError());
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
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
  expectedKeys: readonly ReturnType<typeof deriveArchiveRecordLedgerKey>[],
): void {
  const data = sorobanData(transaction);
  const readOnly = data.getReadOnly();
  const readWrite = data.getReadWrite();
  if (
    readOnly.length !== 0 ||
    readWrite.length !== expectedKeys.length ||
    readWrite.some((key, index) => !sameKey(key, expectedKeys[index]))
  ) {
    throw new Error('Archive restoration must contain the exact locally derived archive restoration footprint.');
  }
}

export async function findContiguousPrivateArchiveRestorationRange(input: {
  rpc: PrivateArchiveRestorationDiscoveryRpc;
  poolContractId: string;
  startActionIndex: number;
  endActionIndexExclusive: number;
  signal?: AbortSignal;
}): Promise<PrivateArchiveRestorationRange> {
  if (
    !Number.isInteger(input.startActionIndex) ||
    !Number.isInteger(input.endActionIndexExclusive) ||
    input.startActionIndex < 0 ||
    input.endActionIndexExclusive <= input.startActionIndex ||
    input.endActionIndexExclusive > 0x1_0000_0000
  ) {
    throw new Error('Archive restoration discovery range is invalid.');
  }
  const probedEndActionIndexExclusive = Math.min(
    input.endActionIndexExclusive,
    input.startActionIndex + MAX_ARCHIVE_RESTORATION_BATCH,
  );
  const expectedKeys = Array.from(
    { length: probedEndActionIndexExclusive - input.startActionIndex },
    (_, offset) => deriveArchiveRecordLedgerKey(
      input.poolContractId,
      input.startActionIndex + offset,
    ),
  );
  const expectedKeySet = new Set(expectedKeys.map(key => key.toXDR('base64')));
  throwIfAborted(input.signal);
  const response = await input.rpc.getLedgerEntries(...expectedKeys);
  throwIfAborted(input.signal);
  if (
    !Number.isInteger(response.latestLedger) ||
    response.latestLedger < 0 ||
    response.latestLedger > 0xffff_ffff
  ) {
    throw new Error('RPC returned an invalid ledger during restoration discovery.');
  }
  const seenKeys = new Set<string>();
  const liveKeys = new Set<string>();
  for (const entry of response.entries) {
    const encoded = entry.key.toXDR('base64');
    if (!expectedKeySet.has(encoded) || seenKeys.has(encoded)) {
      throw new Error('RPC returned an unexpected archive record during restoration discovery.');
    }
    seenKeys.add(encoded);
    if (entry.liveUntilLedgerSeq !== undefined) {
      if (
        !Number.isInteger(entry.liveUntilLedgerSeq) ||
        entry.liveUntilLedgerSeq < 0 ||
        entry.liveUntilLedgerSeq > 0xffff_ffff
      ) {
        throw new Error('RPC returned an invalid archive record lifetime during restoration discovery.');
      }
      if (entry.liveUntilLedgerSeq === 0) continue;
    }
    liveKeys.add(encoded);
  }
  let endActionIndexExclusive = input.startActionIndex;
  while (
    endActionIndexExclusive < probedEndActionIndexExclusive &&
    !liveKeys.has(expectedKeys[endActionIndexExclusive - input.startActionIndex].toXDR('base64'))
  ) {
    endActionIndexExclusive += 1;
  }
  return Object.freeze({
    startActionIndex: input.startActionIndex,
    endActionIndexExclusive,
    probedEndActionIndexExclusive,
    latestLedger: response.latestLedger,
  });
}

function reviewRestoration(input: {
  transaction: Transaction;
  source: string;
  actionIndices: readonly number[];
  expectedKeys: readonly ReturnType<typeof deriveArchiveRecordLedgerKey>[];
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
  assertExactRestoreFootprint(transaction, input.expectedKeys);
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
  return Object.freeze({
    actionIndices: Object.freeze([...input.actionIndices]),
    ledgerKeysXdr: Object.freeze(input.expectedKeys.map(key => key.toXDR('base64'))),
    envelopeXdr: transaction.toXdr(),
    transactionHash: bytesToHex(transaction.hash()),
    source: input.source,
    classicFeeStroops,
    resourceFeeStroops,
    expiresAt: input.expiresAt,
  });
}

export async function preparePrivateArchiveRestoration(input: {
  rpc: PrivateArchiveRestorationRpc;
  manifest: Pick<PrivateBalanceManifest, 'networkPassphrase' | 'poolContractId'>;
  source: string;
  startActionIndex: number;
  actionCount: number;
  maximumActionCount: number;
  classicFeeStroops: bigint;
  maximumResourceFeeStroops: bigint;
  nowSeconds?: number;
  signal?: AbortSignal;
}): Promise<PreparedPrivateArchiveRestoration> {
  if (
    !Number.isInteger(input.startActionIndex) ||
    input.startActionIndex < 0 ||
    input.startActionIndex > 0xffff_ffff
  ) {
    throw new Error('Archive restoration start action index is invalid.');
  }
  if (
    !Number.isInteger(input.actionCount) ||
    input.actionCount < 1 ||
    input.actionCount > 0x1_0000_0000 ||
    input.startActionIndex >= input.actionCount
  ) {
    throw new Error('Archive restoration start is outside the canonical action count.');
  }
  if (
    !Number.isInteger(input.maximumActionCount) ||
    input.maximumActionCount < 1 ||
    input.startActionIndex + input.maximumActionCount > input.actionCount
  ) {
    throw new Error('Archive restoration range exceeds the canonical action count.');
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
  const maximumActionCount = Math.min(
    input.maximumActionCount,
    MAX_ARCHIVE_RESTORATION_BATCH,
  );
  const safeResourceFeeStroops =
    input.maximumResourceFeeStroops * RESTORATION_RESOURCE_MARGIN_PERCENT / 100n;
  throwIfAborted(input.signal);
  const account = await input.rpc.getAccount(input.source);
  throwIfAborted(input.signal);

  const actionIndices = (count: number): readonly number[] => Object.freeze(
    Array.from({ length: count }, (_, offset) => input.startActionIndex + offset),
  );
  const keysFor = (indices: readonly number[]) => indices.map(actionIndex =>
    deriveArchiveRecordLedgerKey(input.manifest.poolContractId, actionIndex));
  const buildRaw = (expectedKeys: readonly ReturnType<typeof deriveArchiveRecordLedgerKey>[]) =>
    new TransactionBuilder(account, {
      fee: input.classicFeeStroops.toString(),
      networkPassphrase: input.manifest.networkPassphrase,
      timebounds: { minTime: 0, maxTime: expiresAt },
    })
      .setSorobanData(new SorobanDataBuilder().setFootprint([], [...expectedKeys]).build())
      .addOperation(Operation.restoreFootprint({}))
      .build();

  type SafeSimulation = {
    safe: true;
    count: number;
    expectedKeys: ReturnType<typeof deriveArchiveRecordLedgerKey>[];
    raw: ReturnType<TransactionBuilder['build']>;
    simulation: SorobanRpc.Api.SimulateTransactionSuccessResponse;
  };
  type UnsafeSimulation = { safe: false; reason: string };
  const simulate = async (count: number): Promise<SafeSimulation | UnsafeSimulation> => {
    throwIfAborted(input.signal);
    const indices = actionIndices(count);
    const expectedKeys = keysFor(indices);
    const raw = buildRaw(expectedKeys);
    const simulation = await input.rpc.simulateTransaction(raw);
    throwIfAborted(input.signal);
    if (SorobanRpc.Api.isSimulationError(simulation)) {
      return { safe: false, reason: `Archive restoration simulation failed: ${simulation.error}` };
    }
    if (SorobanRpc.Api.isSimulationRestore(simulation)) {
      throw new Error('Archive restoration simulation requested a nested restoration.');
    }
    if (!SorobanRpc.Api.isSimulationSuccess(simulation)) {
      throw new Error('Archive restoration simulation returned an unsupported response.');
    }
    if (
      !Number.isInteger(simulation.latestLedger) ||
      simulation.latestLedger < 0 ||
      simulation.latestLedger > 0xffff_ffff
    ) {
      throw new Error('Archive restoration simulation ledger is invalid.');
    }
    const simulatedFootprint = new SorobanDataBuilder(simulation.transactionData.build());
    if (
      simulatedFootprint.getReadOnly().length !== 0 ||
      simulatedFootprint.getReadWrite().length !== expectedKeys.length ||
      simulatedFootprint.getReadWrite().some(
        (key, index) => !sameKey(key, expectedKeys[index]),
      )
    ) {
      throw new Error('RPC did not preserve the exact locally derived archive restoration footprint.');
    }
    const resourceFee = BigInt(simulation.minResourceFee);
    if (resourceFee < 0n) {
      throw new Error('Archive restoration simulated resource fee is invalid.');
    }
    if (resourceFee > safeResourceFeeStroops) {
      return {
        safe: false,
        reason: 'Archive restoration simulated resource fee exceeds the 80% safety margin.',
      };
    }
    return { safe: true, count, expectedKeys, raw, simulation };
  };

  let selected = await simulate(1);
  if (!selected.safe) throw new Error(selected.reason);
  let firstUnsafeCount: number | null = null;
  while (selected.count < maximumActionCount) {
    const candidateCount = Math.min(maximumActionCount, selected.count * 2);
    const candidate = await simulate(candidateCount);
    if (!candidate.safe) {
      firstUnsafeCount = candidateCount;
      break;
    }
    selected = candidate;
  }
  if (firstUnsafeCount !== null) {
    let low = selected.count + 1;
    let high = firstUnsafeCount - 1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const candidate = await simulate(middle);
      if (candidate.safe) {
        selected = candidate;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
  }

  const sizingSimulationLedger = selected.simulation.latestLedger;
  const fresh = await simulate(selected.count);
  if (
    !fresh.safe ||
    fresh.simulation.latestLedger < sizingSimulationLedger
  ) {
    throw new Error('Fresh archive restoration simulation no longer matches the reviewed resource limits.');
  }
  const selectedActionIndices = actionIndices(fresh.count);
  const prepared = SorobanRpc.assembleTransaction(fresh.raw, fresh.simulation).build();
  const review = reviewRestoration({
    transaction: prepared,
    source: input.source,
    actionIndices: selectedActionIndices,
    expectedKeys: fresh.expectedKeys,
    maximumClassicFeeStroops: input.classicFeeStroops,
    maximumResourceFeeStroops: safeResourceFeeStroops,
    expiresAt,
  });
  return Object.freeze({
    actionIndices: selectedActionIndices,
    review,
    simulationLedger: fresh.simulation.latestLedger,
  });
}

export async function restorePrivateArchiveRange<Review>(input: {
  startActionIndex: number;
  endActionIndexExclusive: number;
  prepare(request: {
    startActionIndex: number;
    maximumActionCount: number;
    signal?: AbortSignal;
  }): Promise<{ actionIndices: readonly number[]; review: Review }>;
  submit(review: Review, signal?: AbortSignal): Promise<unknown>;
  onProgress?(progress: PrivateArchiveRestorationProgress): void;
  signal?: AbortSignal;
}): Promise<{ nextActionIndex: number }> {
  if (
    !Number.isInteger(input.startActionIndex) ||
    !Number.isInteger(input.endActionIndexExclusive) ||
    input.startActionIndex < 0 ||
    input.endActionIndexExclusive <= input.startActionIndex ||
    input.endActionIndexExclusive > 0x1_0000_0000
  ) {
    throw new Error('Archive restoration range is invalid.');
  }
  const totalCount = input.endActionIndexExclusive - input.startActionIndex;
  let nextActionIndex = input.startActionIndex;
  while (nextActionIndex < input.endActionIndexExclusive) {
    throwIfAborted(input.signal);
    const prepared = await input.prepare({
      startActionIndex: nextActionIndex,
      maximumActionCount: input.endActionIndexExclusive - nextActionIndex,
      signal: input.signal,
    });
    throwIfAborted(input.signal);
    if (
      prepared.actionIndices.length < 1 ||
      prepared.actionIndices.some(
        (actionIndex, offset) => actionIndex !== nextActionIndex + offset,
      ) ||
      nextActionIndex + prepared.actionIndices.length > input.endActionIndexExclusive
    ) {
      throw new Error('Prepared archive restoration batch is not the requested contiguous prefix.');
    }
    await input.submit(prepared.review, input.signal);
    throwIfAborted(input.signal);
    const confirmedBatchSize = prepared.actionIndices.length;
    nextActionIndex += confirmedBatchSize;
    input.onProgress?.(Object.freeze({
      startActionIndex: input.startActionIndex,
      nextActionIndex,
      endActionIndexExclusive: input.endActionIndexExclusive,
      restoredCount: nextActionIndex - input.startActionIndex,
      totalCount,
      confirmedBatchSize,
    }));
  }
  return { nextActionIndex };
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
  signal?: AbortSignal;
}): Promise<{ transactionHash: string }> {
  throwIfAborted(input.signal);
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
  throwIfAborted(input.signal);
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
  throwIfAborted(input.signal);
  if (submitted.hash.toLowerCase() !== input.review.transactionHash) {
    throw new Error('RPC returned a different archive restoration hash.');
  }
  if (submitted.status !== 'PENDING' && submitted.status !== 'DUPLICATE') {
    throw new Error(`Archive restoration submission was not accepted (${submitted.status}).`);
  }
  const sleep = input.sleep ?? (milliseconds => abortableSleep(milliseconds, input.signal));
  for (const delay of input.delays ?? DEFAULT_CONFIRMATION_DELAYS_MS) {
    if (!Number.isSafeInteger(delay) || delay < 0) {
      throw new Error('Archive restoration confirmation delay is invalid.');
    }
    throwIfAborted(input.signal);
    await sleep(delay);
    throwIfAborted(input.signal);
    const result = await input.rpc.getTransaction(input.review.transactionHash);
    throwIfAborted(input.signal);
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
