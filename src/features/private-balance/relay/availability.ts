import type {
  PrivateRelayQuote,
  PrivateRelayRequest,
} from './protocol';

interface AvailabilitySession {
  requestQuotes(input: {
    networkId: string;
    poolContractId: string;
    actionKind: 'transfer';
    quoteWindowMs?: number;
    settleWindowMs?: number;
    excludePeerAccounts?: readonly string[];
    onQuotes?: (quotes: readonly PrivateRelayQuote[]) => void;
  }, signal?: AbortSignal): Promise<{
    request: PrivateRelayRequest;
    quotes: PrivateRelayQuote[];
  }>;
  close(): void;
}

type AvailabilitySessionFactory = (
  relayUrls: readonly string[],
) => Promise<AvailabilitySession>;

export interface PrivateRelayAvailability {
  quotes: PrivateRelayQuote[];
  checkedAt: number;
}

export function rankPrivateRelayQuotes(
  quotes: readonly PrivateRelayQuote[],
  currentTimeSeconds = Math.floor(Date.now() / 1_000),
  excludePeerAccounts: readonly string[] = [],
): PrivateRelayQuote[] {
  const excluded = new Set(excludePeerAccounts);
  const byAccount = new Map<string, PrivateRelayQuote>();
  for (const quote of quotes) {
    if (quote.expiresAt <= currentTimeSeconds || excluded.has(quote.peerAccount)) continue;
    const existing = byAccount.get(quote.peerAccount);
    if (!existing || BigInt(quote.feeAtomic) < BigInt(existing.feeAtomic)) {
      byAccount.set(quote.peerAccount, quote);
    }
  }
  return [...byAccount.values()].sort((left, right) => {
    const leftFee = BigInt(left.feeAtomic);
    const rightFee = BigInt(right.feeAtomic);
    if (leftFee < rightFee) return -1;
    if (leftFee > rightFee) return 1;
    return left.peerAccount.localeCompare(right.peerAccount);
  });
}

export async function checkPrivateRelayAvailability(
  input: {
    relayUrls: readonly string[];
    networkId: string;
    poolContractId: string;
    quoteWindowMs?: number;
    settleWindowMs?: number;
    excludePeerAccounts?: readonly string[];
    onQuotes?: (result: PrivateRelayAvailability) => void;
  },
  signal?: AbortSignal,
  createSession?: AvailabilitySessionFactory,
): Promise<PrivateRelayAvailability> {
  const factory = createSession ?? (async relayUrls => {
    const { PrivateRelaySenderSession } = await import('./session');
    return PrivateRelaySenderSession.create(relayUrls);
  });
  const session = await factory(input.relayUrls);
  try {
    const { quotes } = await session.requestQuotes({
      networkId: input.networkId,
      poolContractId: input.poolContractId,
      actionKind: 'transfer',
      quoteWindowMs: input.quoteWindowMs,
      settleWindowMs: input.settleWindowMs,
      excludePeerAccounts: input.excludePeerAccounts,
      onQuotes: quotes => input.onQuotes?.({ quotes: [...quotes], checkedAt: Date.now() }),
    }, signal);
    const checkedAt = Date.now();
    return {
      quotes: rankPrivateRelayQuotes(
        quotes,
        Math.floor(checkedAt / 1_000),
        input.excludePeerAccounts,
      ),
      checkedAt,
    };
  } finally {
    session.close();
  }
}
