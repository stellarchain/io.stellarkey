import type { PrivateRelayQuote, PrivateRelayRequest } from './protocol';
import type { PrivateRelaySenderSession } from './session';

/** One explicit UI decision. Never automatically selects a quote or carries it to the next step. */
export class PrivateRelayChainChoice {
  private current: {
    quotes: PrivateRelayQuote[];
    update(quotes: readonly PrivateRelayQuote[]): PrivateRelayQuote[] | null;
    choose(quote: PrivateRelayQuote): void;
    cancel(): void;
  } | null = null;

  get pending(): boolean { return this.current !== null; }

  wait(quotes: readonly PrivateRelayQuote[], maximumFeeAtomic: string, signal: AbortSignal,
    options: { streaming?: boolean } = {}): Promise<PrivateRelayQuote> {
    if (this.current) return Promise.reject(new Error('A private relay helper choice is already open.'));
    if (signal.aborted) return Promise.reject(new DOMException('Private relay choice cancelled.', 'AbortError'));
    const filter = (values: readonly PrivateRelayQuote[]) => values.slice(0, 64).filter(quote => /^[1-9][0-9]{0,20}$/.test(quote.feeAtomic) && BigInt(quote.feeAtomic) <= BigInt(maximumFeeAtomic) && quote.expiresAt * 1000 > Date.now()).map(quote => ({ ...quote }));
    const eligible = filter(quotes);
    if (eligible.length === 0 && !options.streaming) return Promise.reject(new Error('No live helper quote fits the approved private fee cap. Review a new chain to change the cap.'));
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + 300_000;
      let timer: ReturnType<typeof setTimeout>;
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
        if (this.current === decision) this.current = null;
      };
      const cancel = () => { cleanup(); reject(new DOMException('Private relay choice cancelled.', 'AbortError')); };
      const armExpiry = (values: readonly PrivateRelayQuote[]) => {
        clearTimeout(timer);
        const expiresAt = values.length ? Math.min(deadline, Math.max(...values.map(quote => quote.expiresAt * 1000))) : deadline;
        timer = setTimeout(() => { cleanup(); reject(new Error('Private relay offers expired. Review the chain again.')); }, Math.max(0, expiresAt - Date.now()));
      };
      const decision = {
        quotes: eligible, cancel,
        choose: (quote: PrivateRelayQuote) => { cleanup(); resolve({ ...quote }); },
        update: (values: readonly PrivateRelayQuote[]) => {
          if (!options.streaming) return null;
          decision.quotes = filter(values);
          armExpiry(decision.quotes);
          return decision.quotes.map(quote => ({ ...quote }));
        },
      };
      armExpiry(eligible);
      this.current = decision;
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) cancel();
    });
  }

  /** Only authenticated discovery snapshots may update an open streaming choice. */
  update(quotes: readonly PrivateRelayQuote[]): PrivateRelayQuote[] | null {
    return this.current?.update(quotes) ?? null;
  }

  choose(quoteId: string): boolean {
    const quote = this.current?.quotes.find(quote => quote.quoteId === quoteId && quote.expiresAt * 1000 > Date.now());
    if (!quote || !this.current) return false;
    this.current.choose(quote);
    return true;
  }

  cancel(): void { this.current?.cancel(); }
}

/** Collection may end before choice, or choice before collection. Only the
 * collection signal is stopped on selection; the chain and session stay live. */
export async function discoverPrivateRelayChainQuote(input: {
  session: PrivateRelaySenderSession;
  choice: PrivateRelayChainChoice;
  networkId: string;
  poolContractId: string;
  maximumFeeAtomic: string;
  excludePeerAccounts?: readonly string[];
  settleWindowMs?: number;
  onQuotes(quotes: readonly PrivateRelayQuote[]): void;
  onSettled?(): void;
}, signal: AbortSignal): Promise<{ request: PrivateRelayRequest; quote: PrivateRelayQuote }> {
  const collection = new AbortController();
  const abort = () => collection.abort();
  if (signal.aborted) collection.abort();
  else signal.addEventListener('abort', abort, { once: true });
  let context: PrivateRelayRequest | null = null;
  const selected = input.choice.wait([], input.maximumFeeAtomic, signal, { streaming: true }).then(quote => {
    if (!context || signal.aborted) throw new DOMException('Private relay choice cancelled.', 'AbortError');
    return { request: context, quote };
  });
  const discovery = input.session.requestQuotes({
    networkId: input.networkId, poolContractId: input.poolContractId, actionKind: 'transfer',
    excludePeerAccounts: input.excludePeerAccounts, settleWindowMs: input.settleWindowMs,
    onQuotes: (quotes, request) => {
      if (collection.signal.aborted || !input.choice.pending) return;
      context = { ...request };
      const eligible = input.choice.update(quotes);
      if (eligible) input.onQuotes(eligible);
    },
  }, collection.signal).then(result => {
    if (collection.signal.aborted) throw new DOMException('Private relay discovery cancelled.', 'AbortError');
    if (input.choice.pending) {
      context = { ...result.request };
      const eligible = input.choice.update(result.quotes);
      if (!eligible?.length) throw new Error('No live helper quote fits the approved private fee cap. Review a new chain to change the cap.');
      input.onQuotes(eligible);
      input.onSettled?.();
    }
    return selected;
  });
  try {
    return await Promise.race([selected, discovery]);
  } finally {
    collection.abort();
    input.choice.cancel();
    signal.removeEventListener('abort', abort);
  }
}
