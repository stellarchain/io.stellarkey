import { Transaction, TransactionBuilder, type xdr } from '@stellar/stellar-sdk';
import {
  reviewPrivateBalanceTransaction,
  type PrivateBalanceTransactionManifest,
} from '../runtime/transaction-review';
import { PRIVATE_RELAY_MAX_PLAINTEXT_BYTES } from './protocol';

export interface PrivateRelayPreparedEnvelope {
  preparedEnvelopeXdr: string;
  accountSequence: string;
  /** Helper-reported simulation height; never canonical chain evidence. */
  simulationLedger: number;
}

/**
 * The operation, account, time bounds and fee policy are local intent. Sequence,
 * footprint and resource estimates come from the chosen helper: they can affect
 * liveness and public metadata and are NOT an independently verified simulation.
 * The helper still re-simulates this exact envelope before manual signing.
 */
export function reviewPrivateRelayPreparedEnvelope(input: {
  response: PrivateRelayPreparedEnvelope;
  operation: xdr.Operation;
  manifest: PrivateBalanceTransactionManifest;
  source: string;
  timeBounds: { minTime: string; maxTime: string };
  classicFeeStroops: bigint;
  maximumResourceFeeStroops: bigint;
}) {
  const response = input.response;
  if (
    typeof response.preparedEnvelopeXdr !== 'string' || response.preparedEnvelopeXdr.length > PRIVATE_RELAY_MAX_PLAINTEXT_BYTES ||
    typeof response.accountSequence !== 'string' ||
    !/^(?:0|[1-9][0-9]{0,18})$/u.test(response.accountSequence) ||
    BigInt(response.accountSequence) >= 0x7fff_ffff_ffff_ffffn ||
    !Number.isSafeInteger(response.simulationLedger) || response.simulationLedger < 1 || response.simulationLedger > 0xffff_ffff
  ) throw new Error('Private relay prepared envelope metadata is invalid');
  const parsed = TransactionBuilder.fromXdr(response.preparedEnvelopeXdr, input.manifest.networkPassphrase);
  if (!(parsed instanceof Transaction)) throw new Error('Private relay prepared envelope must be an ordinary transaction');
  const envelope = parsed.toEnvelope();
  if (envelope.type !== 'envelopeTypeTx' || envelope.value.tx.ext.type !== 'sorobanData') {
    throw new Error('Private relay prepared envelope is missing resource data');
  }
  const review = reviewPrivateBalanceTransaction({
    envelopeXdr: response.preparedEnvelopeXdr,
    operation: input.operation,
    manifest: input.manifest,
    source: input.source,
    sequence: (BigInt(response.accountSequence) + 1n).toString(),
    timeBounds: input.timeBounds,
    // Preserve exactly the helper-provided data while independently constraining
    // the transaction's intent and costs below; this is not a second simulation.
    simulationTransactionDataXdr: envelope.value.tx.ext.value.toXDR('base64'),
    maximumClassicFeeStroops: input.classicFeeStroops,
    maximumResourceFeeStroops: input.maximumResourceFeeStroops,
  });
  if (review.method === 'deposit' || review.classicFeeStroops !== input.classicFeeStroops) {
    throw new Error('Private relay prepared method or classic fee changed');
  }
  return review;
}
