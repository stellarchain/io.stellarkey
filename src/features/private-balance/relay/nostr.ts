import type { Event, VerifiedEvent } from 'nostr-tools/pure';
import type {
  PrivateRelayFilter,
  PrivateRelaySubscription,
  PrivateRelayTransportAdapter,
} from './transport';

export const PRIVATE_RELAY_EVENT_KIND = 24_333;
export const PRIVATE_RELAY_TOPIC = 'stellarkey-private-relay-v1';
export const PRIVATE_RELAY_RECONNECT_BACKOFF_MS: readonly number[] = Object.freeze([
  1_000,
  2_000,
  5_000,
  10_000,
  20_000,
  30_000,
  60_000,
]);

function nostrPoolUrl(raw: string): string {
  const url = new URL(raw);
  url.pathname = url.pathname.replace(/\/+/gu, '/');
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1);
  }
  url.searchParams.sort();
  url.hash = '';
  return url.toString();
}

export function privateRelayConnectionOutcomes(
  urls: readonly string[],
  connected: ReadonlyMap<string, boolean>,
): Map<string, boolean> {
  return new Map(urls.map(url => [url, connected.get(nostrPoolUrl(url)) === true]));
}

export async function firstAcceptedPrivateRelayPublish(
  urls: readonly string[],
  attempts: readonly Promise<unknown>[],
): Promise<Map<string, boolean>> {
  if (attempts.length !== urls.length) {
    throw new Error('Private relay publish attempt count is invalid');
  }
  try {
    const acceptedUrl = await Promise.any(
      attempts.map((attempt, index) => attempt.then(() => urls[index])),
    );
    return new Map([[acceptedUrl, true]]);
  } catch {
    return new Map(urls.map(url => [url, false]));
  }
}

export class NostrPrivateRelayAdapter implements PrivateRelayTransportAdapter {
  private poolPromise: Promise<import('nostr-tools/pool').SimplePool> | null = null;

  private pool() {
    this.poolPromise ??= import('nostr-tools/pool').then(({ SimplePool }) => new SimplePool({
      enablePing: true,
      enableReconnect: true,
    }));
    return this.poolPromise;
  }

  async publish(
    urls: readonly string[],
    event: VerifiedEvent,
    signal?: AbortSignal,
  ): Promise<Map<string, boolean>> {
    const pool = await this.pool();
    const attempts = pool.publish([...urls], event, { maxWait: 8_000, abort: signal });
    return firstAcceptedPrivateRelayPublish(urls, attempts);
  }

  subscribe(
    urls: readonly string[],
    filters: readonly PrivateRelayFilter[],
    onEvent: (event: Event) => void,
  ): PrivateRelaySubscription {
    let closed = false;
    const closers: Array<{ close(): void }> = [];
    void this.pool().then(pool => {
      if (closed) return;
      for (const filter of filters) {
        closers.push(pool.subscribeMany([...urls], filter, {
          onevent: onEvent,
          maxWait: 8_000,
        }));
      }
    });
    return {
      close() {
        if (closed) return;
        closed = true;
        for (const closer of closers) closer.close();
      },
    };
  }

  async waitUntilConnected(
    urls: readonly string[],
    signal?: AbortSignal,
  ): Promise<Map<string, boolean>> {
    if (signal?.aborted) throw new DOMException('Private relay cancelled.', 'AbortError');
    const pool = await this.pool();
    if (signal?.aborted) throw new DOMException('Private relay cancelled.', 'AbortError');
    const controllers = urls.map(() => new AbortController());
    const abort = () => controllers.forEach(controller => controller.abort());
    signal?.addEventListener('abort', abort, { once: true });
    const attempts = urls.map((url, index) => pool.ensureRelay(url, {
      connectionTimeout: 8_000,
      abort: controllers[index]?.signal,
    }).then(relay => {
      relay.resubscribeBackoff = [...PRIVATE_RELAY_RECONNECT_BACKOFF_MS];
      return url;
    }));
    void Promise.allSettled(attempts).finally(() => signal?.removeEventListener('abort', abort));
    try {
      await Promise.any(attempts);
    } catch {
      return new Map(urls.map(url => [url, false]));
    }
    return this.connectionStatus(urls);
  }

  async connectionStatus(urls: readonly string[]): Promise<Map<string, boolean>> {
    const pool = await this.pool();
    return privateRelayConnectionOutcomes(urls, pool.listConnectionStatus());
  }

  close(urls: readonly string[]): void {
    void this.poolPromise?.then(pool => pool.close([...urls]));
    this.poolPromise = null;
  }
}
