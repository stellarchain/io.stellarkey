import type { Filter } from 'nostr-tools/filter';
import type { Event, VerifiedEvent } from 'nostr-tools/pure';

export type PrivateRelayFilter = Filter;

export interface PrivateRelaySubscription {
  close(): void;
}

export interface PrivateRelayConnectionStatus {
  connected: number;
  total: number;
}

export interface PrivateRelayTransportAdapter {
  publish(urls: readonly string[], event: VerifiedEvent, signal?: AbortSignal): Promise<Map<string, boolean>>;
  subscribe(
    urls: readonly string[],
    filters: readonly PrivateRelayFilter[],
    onEvent: (event: Event) => void,
  ): PrivateRelaySubscription;
  waitUntilConnected(urls: readonly string[], signal?: AbortSignal): Promise<Map<string, boolean>>;
  connectionStatus(urls: readonly string[]): Promise<Map<string, boolean>>;
  close(urls: readonly string[]): void;
}

export function validatePrivateRelayUrls(urls: readonly string[]): string[] {
  if (!Array.isArray(urls) || urls.length > 8) {
    throw new Error('Private relay URLs are invalid');
  }
  const result: string[] = [];
  const origins = new Set<string>();
  for (const raw of urls) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Error('Private relay URL is invalid');
    }
    if (url.protocol !== 'wss:') throw new Error('Private relays must use wss');
    url.username = '';
    url.password = '';
    url.hash = '';
    const normalized = url.toString();
    if (origins.has(url.origin)) continue;
    origins.add(url.origin);
    result.push(normalized);
  }
  if (result.length < 2) throw new Error('Privacy relay mode requires two independent relay origins');
  return result;
}

export class BoundedPrivateRelayTransport {
  public readonly urls: readonly string[];
  private readonly adapter: PrivateRelayTransportAdapter;
  private readonly subscriptions = new Set<PrivateRelaySubscription>();
  private closed = false;

  /** `validateEndpoints` names the carriers an adapter accepts: public Nostr
   * relay URLs by default, or a transport's fixed logical endpoints. */
  constructor(
    urls: readonly string[],
    adapter: PrivateRelayTransportAdapter,
    validateEndpoints: (urls: readonly string[]) => string[] = validatePrivateRelayUrls,
  ) {
    this.urls = validateEndpoints(urls);
    this.adapter = adapter;
  }

  async publish(event: VerifiedEvent, signal?: AbortSignal): Promise<void> {
    if (this.closed) throw new Error('Private relay transport is closed');
    if (signal?.aborted) throw new DOMException('Private relay cancelled.', 'AbortError');
    const outcomes = await this.adapter.publish(this.urls, event, signal);
    if (![...outcomes.values()].some(Boolean)) {
      throw new Error('No configured privacy relay accepted the message');
    }
  }

  subscribe(
    filters: readonly PrivateRelayFilter[],
    onEvent: (event: Event) => void,
    signal?: AbortSignal,
  ): PrivateRelaySubscription {
    if (this.closed) throw new Error('Private relay transport is closed');
    if (filters.length < 1 || filters.length > 4) {
      throw new Error('Private relay subscription filter count is invalid');
    }
    const inner = this.adapter.subscribe(this.urls, filters, onEvent);
    let subscriptionClosed = false;
    const abort = () => close();
    const close = () => {
      if (subscriptionClosed) return;
      subscriptionClosed = true;
      signal?.removeEventListener('abort', abort);
      inner.close();
      this.subscriptions.delete(subscription);
    };
    const subscription = { close };
    this.subscriptions.add(subscription);
    if (signal?.aborted) close();
    else signal?.addEventListener('abort', abort, { once: true });
    return subscription;
  }

  private summarizeConnectionStatus(outcomes: ReadonlyMap<string, boolean>): PrivateRelayConnectionStatus {
    return {
      connected: this.urls.reduce((count, url) => count + (outcomes.get(url) ? 1 : 0), 0),
      total: this.urls.length,
    };
  }

  async waitUntilConnected(signal?: AbortSignal): Promise<PrivateRelayConnectionStatus> {
    if (this.closed) throw new Error('Private relay transport is closed');
    if (signal?.aborted) throw new DOMException('Private relay cancelled.', 'AbortError');
    const outcomes = await this.adapter.waitUntilConnected(this.urls, signal);
    const status = this.summarizeConnectionStatus(outcomes);
    if (status.connected === 0) throw new Error('No configured privacy relay is reachable');
    return status;
  }

  async connectionStatus(): Promise<PrivateRelayConnectionStatus> {
    if (this.closed) return { connected: 0, total: this.urls.length };
    return this.summarizeConnectionStatus(await this.adapter.connectionStatus(this.urls));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const subscription of [...this.subscriptions]) subscription.close();
    this.adapter.close(this.urls);
  }
}

export type { Event, VerifiedEvent };
