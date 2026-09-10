import type { Event, VerifiedEvent } from 'nostr-tools/pure';
import { matchFilters } from 'nostr-tools/filter';
import {
  parseBoundedPrivateRelayEvent,
  PRIVATE_RELAY_KNOWN_EVENT_CAPACITY,
  PRIVATE_RELAY_MAX_FRAME_BYTES,
  PRIVATE_RELAY_RECONNECT_BACKOFF_MS,
} from './nostr';
import type {
  PrivateRelayFilter,
  PrivateRelaySubscription,
  PrivateRelayTransportAdapter,
} from './transport';

/** One content topic for the whole protocol: every wallet subscribes to the
 * same topic and filters locally, so peers learn nothing from topic choice. */
export const WAKU_PRIVATE_RELAY_CONTENT_TOPIC = '/stellarkey/1/private-relay-v3/json';

/** The two Waku light-client services a session depends on. They stand in for
 * relay URLs in connection status ("2 of 2"), since peers are discovered. */
export const WAKU_PRIVATE_RELAY_ENDPOINTS = ['waku:lightpush', 'waku:filter'] as const;
export const WAKU_PRIVATE_RELAY_PEER_TIMEOUT_MS = 20_000;
export const WAKU_PRIVATE_RELAY_DEFAULT_CLUSTER_ID = 1;
/** Auto-sharding with the network's shard count; self-hosted nodes must match. */
export const WAKU_PRIVATE_RELAY_SHARDS = 8;
export const WAKU_PRIVATE_RELAY_KEEP_ALIVE_MS = 5_000;
export const WAKU_PRIVATE_RELAY_PUBLISH_ATTEMPTS = 3;
export const WAKU_PRIVATE_RELAY_PUBLISH_RETRY_MS = 1_000;
/** Filter is best-effort with no store-and-forward: a message pushed while the
 * light client's subscription is briefly renewing is lost. A Store query over
 * the retained history recovers it. The nodes are self-hosted or trusted, so
 * retaining the padded, encrypted events on them is within the same trust. */
export const WAKU_PRIVATE_RELAY_BACKFILL_INTERVAL_MS = 2_500;
export const WAKU_PRIVATE_RELAY_BACKFILL_LOOKBACK_MS = 300_000;
export const WAKU_PRIVATE_RELAY_BACKFILL_OVERLAP_MS = 4_000;

export function validateWakuPrivateRelayEndpoints(urls: readonly string[]): string[] {
  if (urls.length !== WAKU_PRIVATE_RELAY_ENDPOINTS.length ||
    WAKU_PRIVATE_RELAY_ENDPOINTS.some((endpoint, index) => urls[index] !== endpoint)) {
    throw new Error('Waku relay mode uses its fixed light-push and filter services');
  }
  return [...WAKU_PRIVATE_RELAY_ENDPOINTS];
}

/** The SDK surface this adapter touches, kept structural so tests can supply a fake. */
export interface WakuDecodedMessage { payload: Uint8Array }
export interface WakuLightNode {
  start(): Promise<void>;
  stop(): Promise<void>;
  waitForPeers(protocols?: readonly string[], timeoutMs?: number): Promise<void>;
  createEncoder(params: { contentTopic: string; ephemeral?: boolean }): unknown;
  createDecoder(params: { contentTopic: string }): unknown;
  isConnected(): boolean;
  getConnectedPeers(): Promise<Array<{ protocols?: readonly string[] }>>;
  lightPush: {
    multicodec?: readonly string[] | string;
    send(encoder: unknown, message: { payload: Uint8Array }, options?: { autoRetry?: boolean }): Promise<{
      successes?: readonly unknown[];
      failures?: readonly unknown[];
    }>;
  };
  filter: {
    multicodec?: readonly string[] | string;
    subscribe(decoder: unknown, callback: (message: WakuDecodedMessage) => void | Promise<void>): Promise<boolean>;
    unsubscribe(decoder: unknown): Promise<boolean>;
  };
  /** Optional: a light node with a Store-capable peer can re-fetch retained
   * history to recover messages Filter missed. Absent on a store-less node. */
  store?: {
    queryWithOrderedCallback(
      decoders: unknown[],
      callback: (message: WakuDecodedMessage) => void | Promise<void>,
      options?: { timeStart?: Date; timeEnd?: Date; includeData?: boolean; paginationForward?: boolean },
    ): Promise<void>;
  };
}
/** Stream muxer factories the light node offers; loaded next to the SDK. */
export type WakuMuxerLoader = () => Promise<unknown[]>;

export interface WakuSdk {
  createLightNode(options: {
    defaultBootstrap?: boolean;
    bootstrapPeers?: string[];
    networkConfig?: { clusterId: number; numShardsInCluster: number };
    libp2p?: { filterMultiaddrs?: boolean; streamMuxers?: unknown[] };
    numPeersToUse?: number;
    filter?: { keepAliveIntervalMs?: number; pingsBeforePeerRenewed?: number; numPeersToUse?: number };
    lightPush?: { numPeersToUse?: number };
  }): Promise<WakuLightNode>;
  Protocols?: { LightPush?: string; Filter?: string };
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function abortError(): DOMException {
  return new DOMException('Private relay cancelled.', 'AbortError');
}

function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(abortError());
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function codecs(value: readonly string[] | string | undefined): string[] {
  return typeof value === 'string' ? [value] : [...(value ?? [])];
}

interface Listener {
  filters: readonly PrivateRelayFilter[];
  onEvent(event: Event): void;
}

/**
 * Carries the same signed relay events over Waku Light Push and Filter. The
 * light node is created on first use and torn down on close, so the SDK loads
 * only for wallets that chose this transport.
 */
export class WakuPrivateRelayAdapter implements PrivateRelayTransportAdapter {
  private readonly loadSdk: () => Promise<WakuSdk>;
  private readonly loadMuxers: WakuMuxerLoader;
  private readonly bootstrapPeers: readonly string[];
  private readonly clusterId: number;
  private readonly peerTimeoutMs: number;
  private readonly retryBackoffMs: readonly number[];
  private nodePromise: Promise<WakuLightNode> | null = null;
  private readonly listeners = new Set<Listener>();
  private readonly knownIds = new Set<string>();
  private wakuDecoder: unknown = null;
  private subscribed = false;
  private subscribing: Promise<void> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private storeDecoder: unknown = null;
  private backfillTimer: ReturnType<typeof setTimeout> | null = null;
  private backfilling = false;
  /** Watermark (epoch ms) for the next Store query; 0 until the first backfill. */
  private backfillSince = 0;
  private closed = false;
  /** Services a peer has already served; identify data can lag behind a successful wait. */
  private readonly served = new Set<'lightpush' | 'filter'>();

  constructor(options: {
    loadSdk?: () => Promise<WakuSdk>;
    loadMuxers?: WakuMuxerLoader;
    /** Multiaddrs of self-hosted nodes; empty uses the public network bootstrap. */
    bootstrapPeers?: readonly string[];
    /** The cluster those nodes serve; 1 is The Waku Network. */
    clusterId?: number;
    peerTimeoutMs?: number;
    retryBackoffMs?: readonly number[];
  } = {}) {
    this.loadSdk = options.loadSdk ?? (() => import('@waku/sdk') as unknown as Promise<WakuSdk>);
    // The SDK offers mplex alone; go-libp2p service nodes (go-waku) speak only
    // yamux, so offer both. Public nwaku fleets accept either.
    this.loadMuxers = options.loadMuxers ?? (async () => {
      const [{ yamux }, { mplex }] = await Promise.all([import('@chainsafe/libp2p-yamux'), import('@libp2p/mplex')]);
      return [yamux(), mplex()];
    });
    this.bootstrapPeers = options.bootstrapPeers ?? [];
    this.clusterId = options.clusterId ?? WAKU_PRIVATE_RELAY_DEFAULT_CLUSTER_ID;
    this.peerTimeoutMs = options.peerTimeoutMs ?? WAKU_PRIVATE_RELAY_PEER_TIMEOUT_MS;
    this.retryBackoffMs = options.retryBackoffMs ?? PRIVATE_RELAY_RECONNECT_BACKOFF_MS;
  }

  private node(): Promise<WakuLightNode> {
    if (this.closed) return Promise.reject(new Error('Private relay transport is closed'));
    this.nodePromise ??= Promise.all([this.loadSdk(), this.loadMuxers()]).then(async ([sdk, streamMuxers]) => {
      // Self-hosted or trusted nodes only: the public Waku Network is never
      // dialled (it rate-limits proof-less publishing under RLN). With no peer
      // configured the node connects to nothing and relaying is simply
      // unavailable. Configured peers are a known, reliable set, so use as many
      // as given (up to two) and do not renew a peer on a single missed ping,
      // which would tear the one filter subscription down and up on every gap.
      const peersToUse = Math.max(1, Math.min(this.bootstrapPeers.length, 2));
      const node = await sdk.createLightNode({
        defaultBootstrap: false,
        ...(this.bootstrapPeers.length ? { bootstrapPeers: [...this.bootstrapPeers] } : {}),
        // The SDK dials only wss by default; a plain-ws peer is accepted solely
        // on this device (the address validator enforces loopback for ws).
        libp2p: { streamMuxers, ...(this.bootstrapPeers.some(peer => /\/ws\/p2p\//u.test(peer)) ? { filterMultiaddrs: false } : {}) },
        networkConfig: { clusterId: this.clusterId, numShardsInCluster: WAKU_PRIVATE_RELAY_SHARDS },
        numPeersToUse: peersToUse,
        // A relay exchange lasts seconds, so keep the ping interval short, but
        // renew a peer only after several misses so a healthy self-hosted node
        // is not torn down needlessly (Filter has no store-and-forward).
        filter: { keepAliveIntervalMs: WAKU_PRIVATE_RELAY_KEEP_ALIVE_MS, pingsBeforePeerRenewed: 3, numPeersToUse: peersToUse },
        lightPush: { numPeersToUse: peersToUse },
      });
      await node.start();
      return node;
    });
    return this.nodePromise;
  }

  /** Peers are discovered after start; like a relay socket, a send or a
   * subscription waits for a serving peer instead of failing on a cold node. */
  private async ready(node: WakuLightNode, which: 'lightpush' | 'filter', signal?: AbortSignal): Promise<void> {
    const sdk = await this.loadSdk().catch(() => null);
    const protocol = which === 'lightpush' ? sdk?.Protocols?.LightPush ?? 'lightpush' : sdk?.Protocols?.Filter ?? 'filter';
    await raceAbort(node.waitForPeers([protocol], this.peerTimeoutMs), signal);
    this.served.add(which);
  }

  async publish(
    urls: readonly string[],
    event: VerifiedEvent,
    signal?: AbortSignal,
  ): Promise<Map<string, boolean>> {
    const rejected = () => new Map(urls.map(url => [url, false]));
    const payload = encoder.encode(JSON.stringify({
      id: event.id, pubkey: event.pubkey, sig: event.sig, kind: event.kind,
      created_at: event.created_at, tags: event.tags, content: event.content,
    }));
    if (payload.byteLength > PRIVATE_RELAY_MAX_FRAME_BYTES) return rejected();
    const node = await raceAbort(this.node(), signal);
    // Not ephemeral: the Store-capable node must retain the event so a peer that
    // missed the Filter push can recover it. Retention is bounded and the nodes
    // are the user's own or trusted; the event stays padded and encrypted.
    const wakuEncoder = node.createEncoder({ contentTopic: WAKU_PRIVATE_RELAY_CONTENT_TOPIC, ephemeral: false });
    try {
      // A light-push peer can drop between two messages of one exchange. Wait
      // for a serving peer again and retry a few times before giving up.
      for (let attempt = 0; attempt < WAKU_PRIVATE_RELAY_PUBLISH_ATTEMPTS; attempt += 1) {
        await this.ready(node, 'lightpush', signal);
        const result = await raceAbort(node.lightPush.send(wakuEncoder, { payload }, { autoRetry: true }), signal);
        if ((result.successes?.length ?? 0) > 0) return new Map(urls.map(url => [url, true]));
        this.served.delete('lightpush');
        await raceAbort(new Promise(resolve => setTimeout(resolve, WAKU_PRIVATE_RELAY_PUBLISH_RETRY_MS)), signal);
      }
      return rejected();
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
      return rejected();
    }
  }

  private deliver(message: WakuDecodedMessage): void {
    if (this.closed) return;
    let raw: string;
    try { raw = decoder.decode(message.payload); } catch { return; }
    const event = parseBoundedPrivateRelayEvent(raw);
    if (!event || this.knownIds.has(event.id)) return;
    if (this.knownIds.size >= PRIVATE_RELAY_KNOWN_EVENT_CAPACITY) this.knownIds.delete(this.knownIds.values().next().value!);
    this.knownIds.add(event.id);
    for (const listener of [...this.listeners]) {
      if (!matchFilters([...listener.filters], event)) continue;
      // A consumer exception must not break delivery to the other listeners.
      try { listener.onEvent(event); } catch { /* The consumer owns its action error. */ }
    }
  }

  private ensureSubscribed(attempt = 0): void {
    if (this.closed || this.subscribed || this.subscribing || this.listeners.size === 0) return;
    this.subscribing = (async () => {
      const node = await this.node();
      if (this.closed || this.listeners.size === 0) return;
      await this.ready(node, 'filter');
      if (this.closed || this.listeners.size === 0) return;
      this.wakuDecoder ??= node.createDecoder({ contentTopic: WAKU_PRIVATE_RELAY_CONTENT_TOPIC });
      const ok = await node.filter.subscribe(this.wakuDecoder, message => this.deliver(message));
      if (!ok) throw new Error('Waku filter subscription was not accepted');
      this.subscribed = true;
    })().catch(() => {
      if (this.closed) return;
      const delay = this.retryBackoffMs[Math.min(attempt, this.retryBackoffMs.length - 1)]!;
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.ensureSubscribed(attempt + 1);
      }, delay);
    }).finally(() => { this.subscribing = null; });
  }

  /** Best-effort recovery: re-fetch retained events since the last watermark and
   * feed them through the same dedupe path, catching anything Filter dropped. */
  private async backfill(): Promise<void> {
    if (this.closed || this.backfilling || this.listeners.size === 0) return;
    this.backfilling = true;
    try {
      const node = await this.node();
      if (this.closed || this.listeners.size === 0 || !node.store) return;
      if (this.backfillSince === 0) this.backfillSince = Date.now() - WAKU_PRIVATE_RELAY_BACKFILL_LOOKBACK_MS;
      const runStart = Date.now();
      this.storeDecoder ??= node.createDecoder({ contentTopic: WAKU_PRIVATE_RELAY_CONTENT_TOPIC });
      await node.store.queryWithOrderedCallback([this.storeDecoder], message => { this.deliver(message); },
        { timeStart: new Date(this.backfillSince), includeData: true, paginationForward: true });
      // Advance only after a query returned; keep a margin so a message still in
      // flight at query time is re-scanned rather than skipped next run.
      this.backfillSince = runStart - WAKU_PRIVATE_RELAY_BACKFILL_OVERLAP_MS;
    } catch { /* No Store peer yet, or a transient query failure; the next tick retries. */ }
    finally {
      this.backfilling = false;
      this.scheduleBackfill();
    }
  }

  private scheduleBackfill(delay = WAKU_PRIVATE_RELAY_BACKFILL_INTERVAL_MS): void {
    if (this.closed || this.backfillTimer || this.backfilling || this.listeners.size === 0) return;
    this.backfillTimer = setTimeout(() => {
      this.backfillTimer = null;
      void this.backfill();
    }, delay);
  }

  subscribe(
    _urls: readonly string[],
    filters: readonly PrivateRelayFilter[],
    onEvent: (event: Event) => void,
  ): PrivateRelaySubscription {
    const listener: Listener = { filters, onEvent };
    this.listeners.add(listener);
    this.ensureSubscribed();
    this.scheduleBackfill(0);
    let closed = false;
    return {
      close: () => {
        if (closed) return;
        closed = true;
        this.listeners.delete(listener);
      },
    };
  }

  async waitUntilConnected(
    urls: readonly string[],
    signal?: AbortSignal,
  ): Promise<Map<string, boolean>> {
    if (signal?.aborted) throw abortError();
    const node = await raceAbort(this.node(), signal);
    try {
      await Promise.all([this.ready(node, 'lightpush', signal), this.ready(node, 'filter', signal)]);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    }
    return this.connectionStatus(urls);
  }

  async connectionStatus(urls: readonly string[]): Promise<Map<string, boolean>> {
    if (this.closed || !this.nodePromise) return new Map(urls.map(url => [url, false]));
    const node = await this.nodePromise;
    const peers = await node.getConnectedPeers().catch(() => []);
    const connected = node.isConnected();
    // A service counts as connected once a peer served it and the node still
    // holds connections, or when a connected peer advertises its codec.
    const supports = (which: 'lightpush' | 'filter', wanted: string[]) => (connected && this.served.has(which)) ||
      peers.some(peer => (peer.protocols ?? []).some(protocol => wanted.includes(protocol)));
    const status = new Map<string, boolean>();
    for (const url of urls) {
      status.set(url, url === WAKU_PRIVATE_RELAY_ENDPOINTS[0] ? supports('lightpush', codecs(node.lightPush.multicodec))
        : url === WAKU_PRIVATE_RELAY_ENDPOINTS[1] ? supports('filter', codecs(node.filter.multicodec)) : false);
    }
    return status;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (this.backfillTimer) clearTimeout(this.backfillTimer);
    this.backfillTimer = null;
    this.listeners.clear();
    this.knownIds.clear();
    const pending = this.nodePromise;
    this.nodePromise = null;
    void pending?.then(async node => {
      if (this.subscribed && this.wakuDecoder) await node.filter.unsubscribe(this.wakuDecoder).catch(() => undefined);
      await node.stop();
    }).catch(() => undefined);
  }
}
