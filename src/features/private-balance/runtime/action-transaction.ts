import {
  Account,
  TransactionBuilder,
  rpc as SorobanRpc,
  type xdr,
} from '@stellar/stellar-sdk';
import {
  reviewPrivateBalanceTransaction,
  type PrivateBalanceTransactionReview,
  type PrivateBalanceTransactionManifest,
} from './transaction-review';
import { assertDirectPrivateSubmission } from './direct-submission';

const REVIEW_WINDOW_SECONDS = 5 * 60;

interface PrivateActionSimulationRpc {
  getAccount(address: string): Promise<Account>;
  simulateTransaction(
    transaction: ReturnType<TransactionBuilder['build']>,
  ): Promise<SorobanRpc.Api.SimulateTransactionResponse>;
}

export interface PreparedReviewedPrivateBalanceTransaction {
  review: PrivateBalanceTransactionReview;
  timeBounds: { minTime: string; maxTime: string };
  simulationLedger: number;
}

export async function prepareReviewedPrivateBalanceTransaction(input: {
  rpc?: PrivateActionSimulationRpc;
  operation: xdr.Operation;
  manifest: PrivateBalanceTransactionManifest;
  source: string;
  classicFeeStroops: bigint;
  maximumResourceFeeStroops: bigint;
  nowSeconds?: number;
  timeBounds?: { minTime: string; maxTime: string };
  submissionMode?: 'direct';
  signal?: AbortSignal;
}): Promise<PreparedReviewedPrivateBalanceTransaction> {
  assertDirectPrivateSubmission(input);
  if (input.classicFeeStroops < 1n || input.classicFeeStroops > 0xffff_ffffn) {
    throw new Error('Private Balance classic fee is outside the supported range');
  }
  if (input.maximumResourceFeeStroops < 0n) {
    throw new Error('Private Balance resource fee cap is invalid');
  }
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) {
    throw new Error('Private Balance review time is invalid');
  }
  const timeBounds = input.timeBounds ?? {
    minTime: '0',
    maxTime: String(nowSeconds + REVIEW_WINDOW_SECONDS),
  };
  const assertCurrent = () => {
    if (input.signal?.aborted) throw new DOMException('Private preparation cancelled.', 'AbortError');
    const now = input.nowSeconds ?? Math.floor(Date.now() / 1_000);
    if (timeBounds.minTime !== '0' || !/^[1-9][0-9]{0,10}$/u.test(timeBounds.maxTime) ||
      Number(timeBounds.maxTime) <= now || Number(timeBounds.maxTime) > now + REVIEW_WINDOW_SECONDS) {
      throw new Error('Private preparation time bounds are invalid or expired');
    }
  };
  assertCurrent();
  if (!input.rpc) throw new Error('Private Balance simulation RPC is unavailable');
  const account = await input.rpc.getAccount(input.source);
  assertCurrent();
  const raw = new TransactionBuilder(account, {
    fee: input.classicFeeStroops.toString(),
    networkPassphrase: input.manifest.networkPassphrase,
    timebounds: {
      minTime: Number(timeBounds.minTime),
      maxTime: Number(timeBounds.maxTime),
    },
  }).addOperation(input.operation).build();
  const simulation = await input.rpc.simulateTransaction(raw);
  assertCurrent();
  if (SorobanRpc.Api.isSimulationError(simulation)) {
    throw new Error(`Private Balance simulation failed: ${simulation.error}`);
  }
  if (SorobanRpc.Api.isSimulationRestore(simulation)) {
    throw new Error('Private Balance transaction requires ledger-entry restoration before a fresh review.');
  }
  if (!SorobanRpc.Api.isSimulationSuccess(simulation)) {
    throw new Error('Private Balance simulation returned an unsupported response.');
  }
  const resourceFee = BigInt(simulation.minResourceFee);
  if (resourceFee < 0n || resourceFee > input.maximumResourceFeeStroops) {
    throw new Error('Private Balance simulated resource fee exceeds the approved cap.');
  }
  const prepared = SorobanRpc.assembleTransaction(raw, simulation).build();
  const review = reviewPrivateBalanceTransaction({
    envelopeXdr: prepared.toXdr(),
    manifest: input.manifest,
    source: input.source,
    sequence: prepared.sequence,
    timeBounds,
    operation: input.operation,
    simulationTransactionDataXdr: simulation.transactionData.build().toXDR('base64'),
    maximumClassicFeeStroops: input.classicFeeStroops,
    maximumResourceFeeStroops: input.maximumResourceFeeStroops,
  });
  return { review, timeBounds, simulationLedger: simulation.latestLedger };
}
