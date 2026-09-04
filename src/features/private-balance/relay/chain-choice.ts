import type { PrivateRelayQuote } from './protocol';

/** One explicit UI decision. Never automatically selects a quote or carries it to the next step. */
export class PrivateRelayChainChoice {
  private current: { quotes: PrivateRelayQuote[]; choose(quote: PrivateRelayQuote): void; cancel(): void } | null = null;

  get pending(): boolean { return this.current !== null; }

  wait(quotes: readonly PrivateRelayQuote[], maximumFeeAtomic: string, signal: AbortSignal): Promise<PrivateRelayQuote> {
    if (this.current) return Promise.reject(new Error('A private relay helper choice is already open.'));
    if (signal.aborted) return Promise.reject(new DOMException('Private relay choice cancelled.', 'AbortError'));
    const eligible = quotes.slice(0, 64).filter(quote => /^[1-9][0-9]{0,20}$/.test(quote.feeAtomic) && BigInt(quote.feeAtomic) <= BigInt(maximumFeeAtomic) && quote.expiresAt * 1000 > Date.now()).map(quote => ({ ...quote }));
    if (eligible.length === 0) return Promise.reject(new Error('No live helper quote fits the approved private fee cap. Review a new chain to change the cap.'));
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
        if (this.current === decision) this.current = null;
      };
      const cancel = () => { cleanup(); reject(new DOMException('Private relay choice cancelled.', 'AbortError')); };
      const decision = { quotes: eligible, cancel, choose: (quote: PrivateRelayQuote) => { cleanup(); resolve(quote); } };
      const timer = setTimeout(() => { cleanup(); reject(new Error('Private relay offers expired. Review the chain again.')); }, Math.max(0, Math.min(300_000, Math.max(...eligible.map(quote => quote.expiresAt * 1000)) - Date.now())));
      this.current = decision;
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) cancel();
    });
  }

  choose(quoteId: string): boolean {
    const quote = this.current?.quotes.find(quote => quote.quoteId === quoteId && quote.expiresAt * 1000 > Date.now());
    if (!quote || !this.current) return false;
    this.current.choose(quote);
    return true;
  }

  cancel(): void { this.current?.cancel(); }
}
