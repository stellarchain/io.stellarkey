import { xdr, type Account, type Transaction } from '@stellar/stellar-sdk';
import { prepareReviewedPrivateBalanceTransaction } from '../runtime/action-transaction';
import type { PrivateBalanceTransactionManifest } from '../runtime/transaction-review';
import { encodePrivateRelayMessage, type PrivateRelayJob } from './protocol';
import { reviewPrivateRelayOperation, type PrivateRelayOperationReview } from './review';
import type { PrivateRelayPreparedEnvelope } from './prepared-envelope';

export function assertPrivateRelayAccountSequence(transaction: Transaction, account: Account): void {
  if (account.accountId() !== transaction.source) throw new Error('Private relay signing account changed');
  if (BigInt(account.sequenceNumber()) + 1n !== BigInt(transaction.sequence)) {
    throw new Error('Private relay account sequence changed. Prepare and review the payment again.');
  }
}

/** One source-account sequence lease; cleared on rejection, expiry or close. */
export class PrivateRelayPreparationLease {
  private current: { token: { quoteId: string }; pending: boolean; prepared?: PrivateRelayPreparedEnvelope } | null = null;

  begin(quoteId: string): { quoteId: string } | null {
    if (this.current && (this.current.pending || this.current.token.quoteId !== quoteId)) return null;
    const token = { quoteId };
    this.current = { token, pending: true };
    return token;
  }

  complete(token: { quoteId: string }, prepared: PrivateRelayPreparedEnvelope): boolean {
    if (this.current?.token !== token || !this.current.pending) return false;
    this.current = { token, pending: false, prepared: { ...prepared } };
    return true;
  }

  get(quoteId: string): PrivateRelayPreparedEnvelope | undefined {
    return this.current?.token.quoteId === quoteId ? this.current.prepared : undefined;
  }

  cancel(token: { quoteId: string }): void {
    if (this.current?.token === token) this.current = null;
  }

  release(quoteId: string): void {
    if (this.current?.token.quoteId === quoteId) this.current = null;
  }

  clear(): void { this.current = null; }
}

/** Actual signed quote deadlines own helper state, independently of discovery. */
export class PrivateRelayQuoteExpiries {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  watch(quote: { quoteId: string; expiresAt: number }, onExpire: (quoteId: string) => void): void {
    if (!Number.isSafeInteger(quote.expiresAt) || quote.expiresAt <= 0) throw new Error('Private relay quote expiry is invalid');
    this.forget(quote.quoteId);
    const timer = setTimeout(() => {
      if (this.timers.get(quote.quoteId) !== timer) return;
      this.timers.delete(quote.quoteId);
      onExpire(quote.quoteId);
    }, Math.max(0, quote.expiresAt * 1_000 - Date.now()));
    this.timers.set(quote.quoteId, timer);
  }

  forget(quoteId: string): void {
    const timer = this.timers.get(quoteId);
    if (timer !== undefined) clearTimeout(timer);
    this.timers.delete(quoteId);
  }

  clear(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}

export function releasePrivateRelayHelperQuote<Pending extends { quote: { quoteId: string } }>(
  quoteId: string,
  state: {
    negotiations: { delete(quoteId: string): boolean };
    signed: { delete(quoteId: string): boolean };
    preparationLease: PrivateRelayPreparationLease;
    pending: { current: Pending | null };
    onPendingReleased(pending: Pending): void;
  },
): void {
  state.negotiations.delete(quoteId);
  state.signed.delete(quoteId);
  state.preparationLease.release(quoteId);
  const pending = state.pending.current;
  if (pending?.quote.quoteId === quoteId) {
    state.pending.current = null;
    state.onPendingReleased(pending);
  }
}

export interface PrivateRelayPreparationContext {
  job: PrivateRelayJob;
  sourceAccount: string;
  assetIndex: number;
  actionDiversifier: string;
  feeAtomic: string;
  expectedMethod: 'transfer' | 'withdraw';
  quoteExpiresAt: number;
}

export async function preparePrivateRelayJob(input: {
  job: PrivateRelayJob;
  manifest: PrivateBalanceTransactionManifest;
  source: string;
  assetIndex: number;
  actionDiversifier: string;
  expectedMethod: 'transfer' | 'withdraw';
  quoteExpiresAt: number;
  maximumClassicFeeStroops: bigint;
  maximumResourceFeeStroops: bigint;
  verifyFee(review: PrivateRelayOperationReview): Promise<void>;
  createRpc(): NonNullable<Parameters<typeof prepareReviewedPrivateBalanceTransaction>[0]['rpc']>;
  signal?: AbortSignal;
  nowSeconds?: number;
}): Promise<PrivateRelayPreparedEnvelope> {
  const job = { ...input.job };
  const assertCurrent = () => {
    if (input.signal?.aborted) throw new DOMException('Private relay preparation cancelled.', 'AbortError');
    const now = input.nowSeconds ?? Math.floor(Date.now() / 1_000);
    encodePrivateRelayMessage(job, now);
    if (job.expiresAt > input.quoteExpiresAt || job.maxTime <= now ||
      BigInt(job.classicFeeStroops) > input.maximumClassicFeeStroops ||
      BigInt(job.maximumResourceFeeStroops) > input.maximumResourceFeeStroops) {
      throw new Error('Private relay preparation exceeds the accepted time or fee policy');
    }
  };
  assertCurrent();
  const operation = xdr.Operation.fromXDR(job.operationXdr, 'base64');
  const reviewed = reviewPrivateRelayOperation({ ...input, poolContractId: input.manifest.poolContractId, operation });
  await input.verifyFee(reviewed);
  assertCurrent();
  const rpc = input.createRpc();
  let accountSequence: string | null = null;
  const prepared = await prepareReviewedPrivateBalanceTransaction({
    operation, manifest: input.manifest, source: input.source,
    classicFeeStroops: BigInt(job.classicFeeStroops), maximumResourceFeeStroops: BigInt(job.maximumResourceFeeStroops),
    timeBounds: { minTime: '0', maxTime: String(job.maxTime) }, signal: input.signal, nowSeconds: input.nowSeconds,
    rpc: {
      async getAccount(source) {
        assertCurrent();
        const account = await rpc.getAccount(source);
        assertCurrent();
        if (account.accountId() !== input.source) throw new Error('Private relay RPC returned another account');
        accountSequence = account.sequenceNumber();
        return account;
      },
      async simulateTransaction(transaction) {
        assertCurrent();
        const simulation = await rpc.simulateTransaction(transaction);
        assertCurrent();
        return simulation;
      },
    },
  });
  assertCurrent();
  if (accountSequence === null) throw new Error('Private relay account sequence is unavailable');
  return {
    preparedEnvelopeXdr: prepared.review.envelopeXdr, accountSequence, simulationLedger: prepared.simulationLedger,
    transactionHash: prepared.review.transactionHash,
  };
}
