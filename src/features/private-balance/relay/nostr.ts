import type { Event, VerifiedEvent } from 'nostr-tools/pure';
import { PRIVATE_RELAY_MAX_ENCRYPTED_BYTES } from './protocol';
import type {
  PrivateRelayFilter,
  PrivateRelaySubscription,
  PrivateRelayTransportAdapter,
} from './transport';

export const PRIVATE_RELAY_EVENT_KIND = 24_333;
export const PRIVATE_RELAY_TOPIC = 'stellarkey-private-relay-v2';
export const PRIVATE_RELAY_KNOWN_EVENT_CAPACITY = 512;
export const PRIVATE_RELAY_MAX_FRAME_BYTES = 64 * 1024;
export const PRIVATE_RELAY_RECONNECT_BACKOFF_MS: readonly number[] = Object.freeze([
  1_000,
  2_000,
  5_000,
  10_000,
  20_000,
  30_000,
  60_000,
]);

interface PrivateRelayConnectPool<Relay> {
  ensureRelay(url: string): Promise<Relay>;
  close(urls: string[]): void;
}

export function connectPrivateRelayWithDeadline<Relay>(
  pool: PrivateRelayConnectPool<Relay>,
  url: string,
  signal: AbortSignal,
  timeoutMs = 8_000,
  options: { closeOnFailure?: boolean } = {},
): Promise<Relay> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    return Promise.reject(new Error('Private relay connection deadline is invalid'));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const closeRelay = () => {
      // Subscription waiters borrow the session's socket. An old waiter must
      // never tear down a newer selected-peer exchange on this same URL.
      if (options.closeOnFailure === false) return;
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
    let retryAttempt = attempt;
    const connectionController = new AbortController();
    connectionControllers.add(connectionController);
    const scheduleRetry = () => {
      if (ended) return;
      ended = true;
      if (subscription) activeSubscriptions.delete(subscription);
      if (closed) return;
      const delay = retryBackoffMs[Math.min(retryAttempt, retryBackoffMs.length - 1)]!;
      const timer = setTimeout(() => {
        retryTimers.delete(timer);
        start(url, filter, retryAttempt + 1);
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
        else {
          activeSubscriptions.add(subscription);
          // Match successful-open recovery: a later socket drop starts at the
          // shortest delay, while failed/ended setup keeps backing off.
          retryAttempt = 0;
        }
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

const hexId = /^[0-9a-f]{64}$/u;
const subscriptionId = /^[A-Za-z0-9:_<>-]{1,64}$/u;
const frameEncoder = new TextEncoder();

/** This is a work limit, not a JSON parser: JSON.parse still owns syntax.
 * Strings/escapes do not count as structure. Ordinary events need depth four;
 * eight levels and 2,048 punctuation tokens leave room for relay extensions.
 * These per-frame bounds do not prevent traffic/CPU exhaustion by many frames. */
function boundedFrameStructure(raw: string): boolean {
  let depth = 0;
  let punctuation = 0;
  let inString = false;
  let escaped = false;
  for (const character of raw) {
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
    } else if (character === '"') inString = true;
    else if ('[{}]:,'.includes(character)) {
      if (++punctuation > 2_048) return false;
      if (character === '[' || character === '{') {
        if (++depth > 8) return false;
      } else if (character === ']' || character === '}') depth -= 1;
    }
  }
  return true;
}

function canonicalPrivateRelayFrame(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > PRIVATE_RELAY_MAX_FRAME_BYTES ||
    frameEncoder.encode(raw).byteLength > PRIVATE_RELAY_MAX_FRAME_BYTES || !boundedFrameStructure(raw)) return null;
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return null; }
  if (!Array.isArray(data)) return null;
  const [type, id, payload] = data;
  if (type === 'OK') {
    if (data.length !== 4 || typeof id !== 'string' || !hexId.test(id) || typeof payload !== 'boolean' || typeof data[3] !== 'string') return null;
    return JSON.stringify(['OK', id, payload, payload ? 'Private relay accepted the event' : 'Private relay rejected the event']);
  }
  if (typeof id !== 'string' || !subscriptionId.test(id)) return null;
  if (type === 'EOSE' && data.length === 2) return JSON.stringify(['EOSE', id]);
  if (type === 'CLOSED' && data.length === 3 && typeof payload === 'string') {
    return JSON.stringify(['CLOSED', id, 'Private relay closed the subscription']);
  }
  // NOTICE would log arbitrary text in the SDK. This adapter does not use
  // relay AUTH, COUNT or extensions; do not retain their arbitrary peer data.
  if (type !== 'EVENT' || data.length !== 3 || !payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const event = payload as Record<string, unknown>;
  if (typeof event.id !== 'string' || !hexId.test(event.id) ||
    typeof event.pubkey !== 'string' || !hexId.test(event.pubkey) ||
    typeof event.sig !== 'string' || !/^[0-9a-f]{128}$/u.test(event.sig) ||
    !Number.isSafeInteger(event.kind) || (event.kind as number) < 0 || (event.kind as number) > 65_535 ||
    !Number.isSafeInteger(event.created_at) || (event.created_at as number) < 0 ||
    typeof event.content !== 'string' || frameEncoder.encode(event.content).byteLength > PRIVATE_RELAY_MAX_ENCRYPTED_BYTES ||
    !Array.isArray(event.tags) || event.tags.length > 64 ||
    event.tags.some(tag => !Array.isArray(tag) || tag.length > 8 || tag.some(value => typeof value !== 'string' || value.length > 1_024))) return null;
  // The SDK's fast scanner assumes EVENT is first and a short unescaped
  // subscription ID, then finds the first raw "id" field. Rebuild only signed
  // event fields in that order; whitespace/property ordering remain compatible.
  return JSON.stringify(['EVENT', id, {
    id: event.id, pubkey: event.pubkey, sig: event.sig, kind: event.kind,
    created_at: event.created_at, tags: event.tags, content: event.content,
  }]);
}

/** A physical setup deadline belongs to one socket, never to a subscription
 * waiter or a URL that a newer payment exchange may already be using. */
export function boundedPrivateRelayWebSocket(Socket: typeof WebSocket, timeoutMs = 8_000): typeof WebSocket {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new Error('Private relay socket deadline is invalid');
  }
  return class extends Socket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      // Registered before the SDK assigns onmessage. Native propagation must
      // never deliver the original frame (including malformed/private text).
      this.addEventListener('message', event => {
        event.stopImmediatePropagation();
        if (this.readyState !== Socket.OPEN) return;
        const data = canonicalPrivateRelayFrame(event.data);
        if (data !== null) this.onmessage?.call(this, new MessageEvent('message', { data }));
      });
      const cleanup = () => {
        clearTimeout(timer);
        this.removeEventListener('open', opened);
        this.removeEventListener('error', cleanup);
        this.removeEventListener('close', cleanup);
      };
      const opened = () => {
        cleanup();
        // nostr-tools 2.25.1 can time out earlier and detach its handlers
        // without closing the socket. Never retain that late-opening orphan.
        if (this.onopen === null) this.close();
      };
      const timer = setTimeout(() => {
        cleanup();
        if (this.readyState === Socket.CONNECTING) this.close();
      }, timeoutMs);
      this.addEventListener('open', opened);
      this.addEventListener('error', cleanup);
      this.addEventListener('close', cleanup);
    }
  };
}

export class NostrPrivateRelayAdapter implements PrivateRelayTransportAdapter {
  private poolPromise: Promise<import('nostr-tools/pool').AbstractSimplePool> | null = null;

  private pool() {
    this.poolPromise ??= Promise.all([import('nostr-tools/pool'), import('nostr-tools/pure')]).then(([{ AbstractSimplePool }, { verifyEvent }]) => new AbstractSimplePool({
      verifyEvent,
      maxWaitForConnection: 3_000,
      enablePing: true,
      // The outer subscription retries original filters. SDK-native reconnect
      // advances `since` even for invalid/filter-rejected future events.
      enableReconnect: false,
      websocketImplementation: boundedPrivateRelayWebSocket(WebSocket),
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
    // One logical subscription shares bounded delivery IDs across all relays,
    // filters and reconnects. Never use pool.subscribeMany's unbounded early Set.
    // This is not the messenger replay guard or once-per-quote payment authority.
    const knownIds = new Set<string>();
    void this.pool().then(pool => {
      if (closed) return;
      subscription = createResilientPrivateRelaySubscription({
        urls,
        filters,
        onEvent: event => {
          if (closed || knownIds.has(event.id)) return;
          if (knownIds.size >= PRIVATE_RELAY_KNOWN_EVENT_CAPACITY) knownIds.delete(knownIds.values().next().value!);
          knownIds.add(event.id);
          // A consumer exception must not enter the SDK's raw-event log catch.
          try { onEvent(event); } catch { /* The consumer owns its action error. */ }
        },
        subscribe: async (url, filter, handlers, signal) => {
          const relay = await connectPrivateRelayWithDeadline(pool, url, signal, 8_000, { closeOnFailure: false });
          if (signal.aborted) throw new DOMException('Private relay cancelled.', 'AbortError');
          return relay.subscribe([filter], {
            onevent: handlers.onEvent,
            onclose: handlers.onClose,
            // Membership only: an invalid early ID cannot poison valid delivery.
            alreadyHaveEvent: id => knownIds.has(id),
            eoseTimeout: 8_000,
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
        knownIds.clear();
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
    ).then(() => url));
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
