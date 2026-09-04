export interface PrivateProofDisclosure {
  kind: 'deposit' | 'transfer' | 'withdraw' | 'consolidate';
  actionId: string;
  actionField: string;
  assetContractId: string;
  amountStroops: string;
  recipientAddress: string | null;
  publicRecipient: string | null;
  memoHex: string | null;
  privateFeeAtomic: string;
  maximumNetworkFeeStroops: string;
  submissionMode: 'direct' | 'relay';
}
export type AuthorizePrivateProofDisclosure = (request: Readonly<PrivateProofDisclosure>) => Promise<void>;

/** One explicit confirmation tied to the currently displayed local proof. */
export class PrivateProofConsent {
  private pending: { actionId: string; approve(): void; cancel(): void } | null = null;
  wait(actionId: string, signal: AbortSignal): Promise<void> {
    this.cancel();
    return new Promise((resolve, reject) => {
      const cleanup = () => { signal.removeEventListener('abort', pending.cancel); if (this.pending === pending) this.pending = null; };
      const pending = { actionId, approve: () => { cleanup(); resolve(); }, cancel: () => { cleanup(); reject(new DOMException('Private proof sharing cancelled.', 'AbortError')); } };
      this.pending = pending;
      if (signal.aborted) pending.cancel();
      else signal.addEventListener('abort', pending.cancel, { once: true });
    });
  }
  approve(actionId: string): boolean {
    if (this.pending?.actionId !== actionId) return false;
    this.pending.approve(); return true;
  }
  cancel(): void { this.pending?.cancel(); }
}

/** This is the spend authorization boundary, not the later envelope signature.
 * A successful commit must persist exposure AND any chain fee authorization. */
export async function disclosePrivateProof<T>(input: {
  request: PrivateProofDisclosure;
  authorize?: AuthorizePrivateProofDisclosure;
  persistedRelayChainConsent?: boolean;
  signal?: AbortSignal;
  assertContext?(): void;
  commit(): Promise<void>;
  disclose(): Promise<T>;
}): Promise<T> {
  const check = () => { if (input.signal?.aborted) throw new DOMException('Private proof sharing cancelled.', 'AbortError'); input.assertContext?.(); };
  check();
  if (input.request.kind !== 'deposit' && !input.persistedRelayChainConsent) {
    if (!input.authorize) throw new Error('Explicit spend-proof sharing consent is required.');
    await input.authorize(Object.freeze({ ...input.request }));
  }
  check();
  await input.commit();
  // Cancellation after the durable write is conservatively treated as exposure.
  check();
  return input.disclose();
}
