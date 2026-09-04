import type { Event, VerifiedEvent } from 'nostr-tools/pure';
import type {
  PrivateRelayFilter,
  PrivateRelaySubscription,
  PrivateRelayTransportAdapter,
} from './transport';

export const PRIVATE_RELAY_EVENT_KIND = 24_333;
export const PRIVATE_RELAY_TOPIC = 'stellarkey-private-relay-v2';
export const PRIVATE_RELAY_RECONNECT_BACKOFF_MS: readonly number[] = Object.freeze([
  1_000,
  2_000,
  5_000,
  10_000,
  20_000,
  30_000,
  60_000,
]);

interface PrivateRelayConnectPool {
  ensureRelay(url: string): Promise<{ resubscribeBackoff: number[] }>;
  close(urls: string[]): void;
}

export function connectPrivateRelayWithDeadline(
  pool: PrivateRelayConnectPool,
  url: string,
  signal: AbortSignal,
  timeoutMs = 8_000,
): Promise<{ resubscribeBackoff: number[] }> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    return Promise.reject(new Error('Private relay connection deadline is invalid'));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const closeRelay = () => {
      try {
        pool.close([url]);
      } catch {
        // Cancellation must still settle even if a third-party close path fails.
      }
    };
    const cleanup = () => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
    };
    const rejectOnce = (cause: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(cause);
    };
    const abort = () => {
      closeRelay();
      rejectOnce(new DOMException('Private relay cancelled.', 'AbortError'));
    };
    const timeout = setTimeout(() => {
      closeRelay();
      rejectOnce(new Error('Private relay connection timed out'));
    }, timeoutMs);
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    void pool.ensureRelay(url).then(relay => {
      if (settled) {
        closeRelay();
        return;
      }
      settled = true;
      cleanup();
      resolve(relay);
    }, cause => rejectOnce(cause));
  });
}

export function createResilientPrivateRelaySubscription(input: {
  urls: readonly string[];
  filters: readonly PrivateRelayFilter[];
  retryBackoffMs?: readonly number[];
  onEvent(event: Event): void;
  subscribe(
    url: string,
    filter: PrivateRelayFilter,
    handlers: { onEvent(event: Event): void; onClose(): void },
    signal: AbortSignal,
  ): PrivateRelaySubscription | Promise<PrivateRelaySubscription>;
}): PrivateRelaySubscription {
  const retryBackoffMs = input.retryBackoffMs ?? PRIVATE_RELAY_RECONNECT_BACKOFF_MS;
  if (retryBackoffMs.length === 0 || retryBackoffMs.some(delay => (
    !Number.isSafeInteger(delay) || delay < 1 || delay > 60_000
  ))) {
    throw new Error('Private relay subscription retry policy is invalid');
  }
  let closed = false;
  const activeSubscriptions = new Set<PrivateRelaySubscription>();
  const connectionControllers = new Set<AbortController>();
  const retryTimers = new Set<ReturnType<typeof setTimeout>>();

  const start = (url: string, filter: PrivateRelayFilter, attempt: number) => {
    if (closed) return;
    let subscription: PrivateRelaySubscription | null = null;
    let ended = false;
    const connectionController = new AbortController();
    connectionControllers.add(connectionController);
    const scheduleRetry = () => {
      if (ended) return;
      ended = true;
      if (subscription) activeSubscriptions.delete(subscription);
      if (closed) return;
      const delay = retryBackoffMs[Math.min(attempt, retryBackoffMs.length - 1)]!;
      const timer = setTimeout(() => {
        retryTimers.delete(timer);
        start(url, filter, attempt + 1);
      }, delay);
      retryTimers.add(timer);
    };
    void Promise.resolve().then(() => input.subscribe(url, filter, {
        onEvent: event => {
          if (!closed) input.onEvent(event);
        },
        onClose: scheduleRetry,
      }, connectionController.signal)).then(nextSubscription => {
        subscription = nextSubscription;
        if (ended || closed) subscription.close();
        else activeSubscriptions.add(subscription);
      }).catch(scheduleRetry).finally(() => {
        connectionControllers.delete(connectionController);
      });
  };

  for (const url of input.urls) {
    for (const filter of input.filters) start(url, filter, 0);
  }
  return {
    close() {
      if (closed) return;
      closed = true;
      for (const controller of connectionControllers) controller.abort();
      connectionControllers.clear();
      for (const timer of retryTimers) clearTimeout(timer);
      retryTimers.clear();
      for (const subscription of activeSubscriptions) subscription.close();
      activeSubscriptions.clear();
    },
  };
}

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
    let subscription: PrivateRelaySubscription | null = null;
    void this.pool().then(pool => {
      if (closed) return;
      subscription = createResilientPrivateRelaySubscription({
        urls,
        filters,
        onEvent,
        subscribe: async (url, filter, handlers, signal) => {
          const relay = await connectPrivateRelayWithDeadline(pool, url, signal);
          relay.resubscribeBackoff = [...PRIVATE_RELAY_RECONNECT_BACKOFF_MS];
          return pool.subscribeMany([url], filter, {
            onevent: handlers.onEvent,
            onclose: handlers.onClose,
            maxWait: 8_000,
          });
        },
      });
      if (closed) subscription.close();
    });
    return {
      close() {
        if (closed) return;
        closed = true;
        subscription?.close();
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
    const attempts = urls.map((url, index) => connectPrivateRelayWithDeadline(
      pool,
      url,
      controllers[index]!.signal,
    ).then(relay => {
      relay.resubscribeBackoff = [...PRIVATE_RELAY_RECONNECT_BACKOFF_MS];
      return url;
    }));
    void Promise.allSettled(attempts).finally(() => signal?.removeEventListener('abort', abort));
    try {
      await Promise.any(attempts);
    } catch {
      if (signal?.aborted) throw new DOMException('Private relay cancelled.', 'AbortError');
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
