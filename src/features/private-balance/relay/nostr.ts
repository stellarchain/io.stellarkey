import type { Event, VerifiedEvent } from 'nostr-tools/pure';
import type {
  PrivateRelayFilter,
  PrivateRelaySubscription,
  PrivateRelayTransportAdapter,
} from './transport';

export const PRIVATE_RELAY_EVENT_KIND = 24_333;
export const PRIVATE_RELAY_TOPIC = 'stellarkey-private-relay-v1';

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
    const settled = await Promise.allSettled(attempts);
    return new Map(urls.map((url, index) => [url, settled[index]?.status === 'fulfilled']));
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
