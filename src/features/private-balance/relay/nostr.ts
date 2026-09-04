import type { Event, VerifiedEvent } from 'nostr-tools/pure';
import type {
  PrivateRelayFilter,
  PrivateRelaySubscription,
  PrivateRelayTransportAdapter,
} from './transport';

export const PRIVATE_RELAY_EVENT_KIND = 24_333;
export const PRIVATE_RELAY_TOPIC = 'stellarkey-private-relay-v1';

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
      enableReconnect: false,
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

  close(urls: readonly string[]): void {
    void this.poolPromise?.then(pool => pool.close([...urls]));
    this.poolPromise = null;
  }
}
