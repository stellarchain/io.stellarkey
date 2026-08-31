import {
  Account,
  TransactionBuilder,
  rpc as SorobanRpc,
  type xdr,
} from '@stellar/stellar-sdk';
import type { PrivateBalanceManifest } from '../../../lib/private-balance-manifest';
import {
  reviewPrivateBalanceTransaction,
  type PrivateBalanceTransactionReview,
} from './transaction-review';

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
  rpc: PrivateActionSimulationRpc;
  operation: xdr.Operation;
  manifest: Pick<PrivateBalanceManifest, 'networkPassphrase' | 'poolContractId'>;
  assetContractId: string;
  source: string;
  classicFeeStroops: bigint;
  maximumResourceFeeStroops: bigint;
  nowSeconds?: number;
}): Promise<PreparedReviewedPrivateBalanceTransaction> {
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
  const timeBounds = {
    minTime: '0',
    maxTime: String(nowSeconds + REVIEW_WINDOW_SECONDS),
  };
  const account = await input.rpc.getAccount(input.source);
  const raw = new TransactionBuilder(account, {
    fee: input.classicFeeStroops.toString(),
    networkPassphrase: input.manifest.networkPassphrase,
    timebounds: {
      minTime: Number(timeBounds.minTime),
      maxTime: Number(timeBounds.maxTime),
    },
  }).addOperation(input.operation).build();
  const simulation = await input.rpc.simulateTransaction(raw);
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
    assetContractId: input.assetContractId,
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
