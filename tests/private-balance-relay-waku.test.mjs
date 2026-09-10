import assert from 'node:assert/strict';
import test from 'node:test';
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure';
import {
  WAKU_PRIVATE_RELAY_CONTENT_TOPIC,
  WAKU_PRIVATE_RELAY_ENDPOINTS,
  WakuPrivateRelayAdapter,
  validateWakuPrivateRelayEndpoints,
} from '../src/features/private-balance/relay/waku.ts';
import { BoundedPrivateRelayTransport } from '../src/features/private-balance/relay/transport.ts';
import { PRIVATE_RELAY_EVENT_KIND, PRIVATE_RELAY_TOPIC } from '../src/features/private-balance/relay/nostr.ts';
import { describePrivateRelayNetwork, privateRelayNetwork, validateWakuClusterId, validateWakuPeerAddresses } from '../src/features/private-balance/relay/network.ts';
import { PrivateRelayMessenger, createPrivateRelayTransport } from '../src/features/private-balance/relay/session.ts';
import { DEFAULT_PRIVATE_RELAY_PREFERENCES, loadPrivateRelayPreferences, savePrivateRelayPreferences } from '../src/features/private-balance/relay/preferences.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function signedEvent(overrides = {}) {
  return finalizeEvent({
    kind: PRIVATE_RELAY_EVENT_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['t', PRIVATE_RELAY_TOPIC]],
    content: 'hello',
    ...overrides,
  }, generateSecretKey());
}

/** A fake light node: records calls, lets tests deliver payloads to the filter callback. */
function fakeSdk(options = {}) {
  const calls = { created: [], started: 0, stopped: 0, sent: [], subscribed: 0, unsubscribed: 0, waited: [], storeQueries: [] };
  const storeMessages = [];
  let filterCallback = null;
  const node = {
    async start() { calls.started += 1; },
    async stop() { calls.stopped += 1; },
    async waitForPeers(protocols, timeoutMs) {
      calls.waited.push({ protocols, timeoutMs });
      if (options.peersFail) throw new Error('no peers');
      if (options.peersDelayMs) await new Promise(resolve => setTimeout(resolve, options.peersDelayMs));
    },
    createEncoder(params) { return { params }; },
    createDecoder(params) { return { params }; },
    isConnected() { return options.connected ?? true; },
    async getConnectedPeers() { return options.peers ?? [{ protocols: ['/vac/waku/lightpush/3.0.0', '/vac/waku/filter-subscribe/2.0.0-beta1'] }]; },
    lightPush: {
      multicodec: ['/vac/waku/lightpush/3.0.0'],
      async send(wakuEncoder, message, sendOptions) {
        calls.sent.push({ encoder: wakuEncoder, message, sendOptions });
        if (options.sendThrows) throw new Error('boom');
        return options.sendResult ?? { successes: ['peer'], failures: [] };
      },
    },
    filter: {
      multicodec: '/vac/waku/filter-subscribe/2.0.0-beta1',
      async subscribe(_decoder, callback) {
        calls.subscribed += 1;
        if (options.subscribeFails && calls.subscribed <= options.subscribeFails) return false;
        filterCallback = callback;
        return true;
      },
      async unsubscribe() { calls.unsubscribed += 1; return true; },
    },
    ...(options.store === false ? {} : { store: {
      async queryWithOrderedCallback(_decoders, callback, queryOptions) {
        calls.storeQueries.push(queryOptions);
        if (options.storeThrows) throw new Error('no store peer');
        for (const payload of [...storeMessages]) {
          await callback({ payload: typeof payload === 'string' ? encoder.encode(payload) : payload });
        }
      },
    } }),
  };
  const sdk = {
    Protocols: { LightPush: 'lightpush', Filter: 'filter' },
    async createLightNode(createOptions) { calls.created.push(createOptions); return node; },
  };
  return {
    sdk, calls, node, storeMessages,
    deliver(payload) { assert.ok(filterCallback, 'the adapter subscribed to the filter'); return filterCallback({ payload: typeof payload === 'string' ? encoder.encode(payload) : payload }); },
    get subscribedCallback() { return filterCallback; },
  };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 10));

test('the fixed Waku endpoints are the only accepted carriers for that transport', () => {
  assert.deepEqual(validateWakuPrivateRelayEndpoints([...WAKU_PRIVATE_RELAY_ENDPOINTS]), ['waku:lightpush', 'waku:filter']);
  assert.throws(() => validateWakuPrivateRelayEndpoints(['wss://relay.one', 'wss://relay.two']), /Waku/u);
  assert.throws(() => validateWakuPrivateRelayEndpoints(['waku:filter', 'waku:lightpush']), /Waku/u);
  assert.match(WAKU_PRIVATE_RELAY_CONTENT_TOPIC, /^\/stellarkey\/1\/private-relay-v3\/json$/u);
});

test('publishing sends one retained message on the shared content topic and reports light-push acceptance', async () => {
  const fake = fakeSdk();
  const adapter = new WakuPrivateRelayAdapter({ loadSdk: async () => fake.sdk, loadMuxers: async () => ['yamux', 'mplex'] });
  const event = signedEvent();
  const outcome = await adapter.publish([...WAKU_PRIVATE_RELAY_ENDPOINTS], event);
  assert.deepEqual([...outcome.values()], [true, true]);
  assert.equal(fake.calls.started, 1);
  assert.deepEqual(fake.calls.created, [{
    defaultBootstrap: false, libp2p: { streamMuxers: ['yamux', 'mplex'] }, networkConfig: { clusterId: 1, numShardsInCluster: 8 }, numPeersToUse: 1,
    filter: { keepAliveIntervalMs: 30_000, pingsBeforePeerRenewed: 3, numPeersToUse: 1 }, lightPush: { numPeersToUse: 1 },
  }], 'no public bootstrap; a store-less default node connects to nothing until a service node is configured');
  assert.equal(fake.calls.sent.length, 1);
  assert.deepEqual(fake.calls.sent[0].encoder.params, { contentTopic: WAKU_PRIVATE_RELAY_CONTENT_TOPIC, ephemeral: false });
  assert.deepEqual(fake.calls.sent[0].sendOptions, { autoRetry: true });
  const wire = JSON.parse(decoder.decode(fake.calls.sent[0].message.payload));
  assert.deepEqual(Object.keys(wire), ['id', 'pubkey', 'sig', 'kind', 'created_at', 'tags', 'content']);
  assert.equal(wire.id, event.id);
  adapter.close();
  await flush();
  assert.equal(fake.calls.stopped, 1);
});

test('a rejected or failing light push is reported as not accepted, never thrown as a transport error', async () => {
  for (const options of [{ sendResult: { successes: [], failures: [{ error: 'No peer available' }] } }, { sendThrows: true }]) {
    const fake = fakeSdk(options);
    const adapter = new WakuPrivateRelayAdapter({ loadSdk: async () => fake.sdk, loadMuxers: async () => [] });
    const t = Date.now();
    const outcome = await adapter.publish([...WAKU_PRIVATE_RELAY_ENDPOINTS], signedEvent());
    assert.deepEqual([...outcome.values()], [false, false]);
    if (!options.sendThrows) {
      assert.equal(fake.calls.sent.length, 3, 'a peerless send is retried after waiting for a peer again');
      assert.ok(Date.now() - t >= 2_000, 'retries are spaced out');
    }
    adapter.close();
  }
});

test('a send that fails once succeeds on the retry after a fresh peer wait', async () => {
  const fake = fakeSdk();
  let calls = 0;
  fake.node.lightPush.send = async () => (++calls === 1 ? { successes: [], failures: [{ error: 'No peer available' }] } : { successes: ['peer'], failures: [] });
  const adapter = new WakuPrivateRelayAdapter({ loadSdk: async () => fake.sdk, loadMuxers: async () => [] });
  const outcome = await adapter.publish([...WAKU_PRIVATE_RELAY_ENDPOINTS], signedEvent());
  assert.deepEqual([...outcome.values()], [true, true]);
  assert.equal(calls, 2);
  assert.equal(fake.calls.waited.length, 2, 'the retry waits for a light-push peer again');
  adapter.close();
});

test('an oversized event is refused locally before any peer sees it', async () => {
  const fake = fakeSdk();
  const adapter = new WakuPrivateRelayAdapter({ loadSdk: async () => fake.sdk, loadMuxers: async () => [] });
  const outcome = await adapter.publish([...WAKU_PRIVATE_RELAY_ENDPOINTS], signedEvent({ content: 'x'.repeat(70_000) }));
  assert.deepEqual([...outcome.values()], [false, false]);
  assert.equal(fake.calls.sent.length, 0);
  adapter.close();
});

test('an aborted publish rejects with AbortError and ignores the late light-push result', async () => {
  const fake = fakeSdk({ peersDelayMs: 0 });
  fake.node.lightPush.send = () => new Promise(() => {});
  const adapter = new WakuPrivateRelayAdapter({ loadSdk: async () => fake.sdk, loadMuxers: async () => [] });
  const controller = new AbortController();
  const attempt = adapter.publish([...WAKU_PRIVATE_RELAY_ENDPOINTS], signedEvent(), controller.signal);
  await flush();
  controller.abort();
  await assert.rejects(attempt, error => error.name === 'AbortError');
  adapter.close();
});

test('subscribers receive only bounded signed events matching their Nostr filters, delivered once', async () => {
  const fake = fakeSdk();
  const adapter = new WakuPrivateRelayAdapter({ loadSdk: async () => fake.sdk, loadMuxers: async () => [] });
  const broadcast = [];
  const direct = [];
  const me = signedEvent().pubkey;
  adapter.subscribe([...WAKU_PRIVATE_RELAY_ENDPOINTS], [{ kinds: [PRIVATE_RELAY_EVENT_KIND], '#t': [PRIVATE_RELAY_TOPIC] }], event => broadcast.push(event.id));
  adapter.subscribe([...WAKU_PRIVATE_RELAY_ENDPOINTS], [{ kinds: [PRIVATE_RELAY_EVENT_KIND], '#t': [PRIVATE_RELAY_TOPIC], '#p': [me] }], event => direct.push(event.id));
  await flush();
  assert.equal(fake.calls.subscribed, 1, 'both listeners share one filter subscription');
  const open = signedEvent();
  const addressed = signedEvent({ tags: [['t', PRIVATE_RELAY_TOPIC], ['p', me]] });
  const otherTopic = signedEvent({ tags: [['t', 'something-else']] });
  const wrongKind = signedEvent({ kind: 1 });
  for (const event of [open, addressed, otherTopic, wrongKind, open]) await fake.deliver(JSON.stringify(event));
  await fake.deliver('not json');
  await fake.deliver(JSON.stringify({ ...open, sig: 'zz' }));
  await fake.deliver(new Uint8Array([0xff, 0xfe]));
  assert.deepEqual(broadcast, [open.id, addressed.id]);
  assert.deepEqual(direct, [addressed.id]);
  adapter.close();
});

test('Store backfill recovers an event that Filter never delivered and never double-delivers', async () => {
  const fake = fakeSdk();
  const adapter = new WakuPrivateRelayAdapter({ loadSdk: async () => fake.sdk, loadMuxers: async () => [] });
  const seen = [];
  adapter.subscribe([...WAKU_PRIVATE_RELAY_ENDPOINTS], [{ kinds: [PRIVATE_RELAY_EVENT_KIND], '#t': [PRIVATE_RELAY_TOPIC] }], event => seen.push(event.id));
  // A message the light client missed on Filter, sitting in the node's store.
  const missed = signedEvent();
  fake.storeMessages.push(JSON.stringify(missed));
  await flush();
  assert.ok(fake.calls.storeQueries.length >= 1, 'the adapter queried the store after subscribing');
  assert.ok(fake.calls.storeQueries[0].timeStart instanceof Date, 'the query is bounded to a recent window');
  assert.deepEqual(seen, [missed.id], 'the missed event is recovered from the store');
  // The same event later arriving on Filter, and another backfill, do not repeat it.
  await fake.deliver(JSON.stringify(missed));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(seen, [missed.id], 'dedupe spans both carriers');
  adapter.close();
});

test('a store-less node and a failing store query leave live delivery working', async () => {
  for (const options of [{ store: false }, { storeThrows: true }]) {
    const fake = fakeSdk(options);
    const adapter = new WakuPrivateRelayAdapter({ loadSdk: async () => fake.sdk, loadMuxers: async () => [] });
    const seen = [];
    adapter.subscribe([...WAKU_PRIVATE_RELAY_ENDPOINTS], [{}], event => seen.push(event.id));
    await flush();
    const event = signedEvent();
    await fake.deliver(JSON.stringify(event));
    assert.deepEqual(seen, [event.id], 'filter delivery is unaffected when the store is absent or failing');
    adapter.close();
  }
});

test('a consumer exception never blocks delivery to other listeners', async () => {
  const fake = fakeSdk();
  const adapter = new WakuPrivateRelayAdapter({ loadSdk: async () => fake.sdk, loadMuxers: async () => [] });
  const seen = [];
  adapter.subscribe([...WAKU_PRIVATE_RELAY_ENDPOINTS], [{}], () => { throw new Error('consumer bug'); });
  adapter.subscribe([...WAKU_PRIVATE_RELAY_ENDPOINTS], [{}], event => seen.push(event.id));
  await flush();
  const event = signedEvent();
  await fake.deliver(JSON.stringify(event));
  assert.deepEqual(seen, [event.id]);
  adapter.close();
});

test('a refused filter subscription retries with bounded backoff and closing a listener stops delivery', async () => {
  const fake = fakeSdk({ subscribeFails: 2 });
  const adapter = new WakuPrivateRelayAdapter({ loadSdk: async () => fake.sdk, loadMuxers: async () => [], retryBackoffMs: [5, 5] });
  const seen = [];
  const subscription = adapter.subscribe([...WAKU_PRIVATE_RELAY_ENDPOINTS], [{}], event => seen.push(event.id));
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(fake.calls.subscribed, 3, 'two refusals then success');
  const first = signedEvent();
  await fake.deliver(JSON.stringify(first));
  subscription.close();
  await fake.deliver(JSON.stringify(signedEvent()));
  assert.deepEqual(seen, [first.id]);
  adapter.close();
  await flush();
  assert.equal(fake.calls.unsubscribed, 1);
  assert.equal(fake.calls.stopped, 1);
});

test('readiness waits for light-push and filter peers and reports each service separately', async () => {
  const fake = fakeSdk({ peers: [{ protocols: ['/vac/waku/lightpush/3.0.0'] }] });
  const adapter = new WakuPrivateRelayAdapter({ loadSdk: async () => fake.sdk, loadMuxers: async () => [], peerTimeoutMs: 1234 });
  const status = await adapter.waitUntilConnected([...WAKU_PRIVATE_RELAY_ENDPOINTS]);
  assert.deepEqual(fake.calls.waited, [{ protocols: ['lightpush'], timeoutMs: 1234 }, { protocols: ['filter'], timeoutMs: 1234 }]);
  await adapter.publish([...WAKU_PRIVATE_RELAY_ENDPOINTS], signedEvent());
  assert.deepEqual(fake.calls.waited.at(-1), { protocols: ['lightpush'], timeoutMs: 1234 }, 'a send waits for a light-push peer first');
  assert.deepEqual([...status.entries()], [['waku:lightpush', true], ['waku:filter', true]], 'a served protocol counts even before identify data lists its codec');
  adapter.close();
  assert.deepEqual([...(await adapter.connectionStatus([...WAKU_PRIVATE_RELAY_ENDPOINTS])).values()], [false, false], 'closed adapters report nothing connected');
});

test('no peers within the deadline reports every service unavailable instead of throwing', async () => {
  const fake = fakeSdk({ peersFail: true, peers: [] });
  const adapter = new WakuPrivateRelayAdapter({ loadSdk: async () => fake.sdk, loadMuxers: async () => [] });
  const status = await adapter.waitUntilConnected([...WAKU_PRIVATE_RELAY_ENDPOINTS]);
  assert.deepEqual([...status.values()], [false, false]);
  const outcome = await adapter.publish([...WAKU_PRIVATE_RELAY_ENDPOINTS], signedEvent());
  assert.deepEqual([...outcome.values()], [false, false], 'a send with no light-push peer is not accepted');
  assert.equal(fake.calls.sent.length, 0);
  adapter.close();
});

test('the bounded transport accepts the Waku services and keeps at-least-one readiness semantics', async () => {
  const fake = fakeSdk({ peers: [{ protocols: ['/vac/waku/filter-subscribe/2.0.0-beta1'] }], connected: false });
  const transport = new BoundedPrivateRelayTransport(
    [...WAKU_PRIVATE_RELAY_ENDPOINTS],
    new WakuPrivateRelayAdapter({ loadSdk: async () => fake.sdk, loadMuxers: async () => [] }),
    validateWakuPrivateRelayEndpoints,
  );
  assert.deepEqual(await transport.waitUntilConnected(), { connected: 1, total: 2 });
  await transport.publish(signedEvent());
  transport.close();
  assert.throws(() => new BoundedPrivateRelayTransport(['wss://relay.one', 'wss://relay.two'], new WakuPrivateRelayAdapter(), validateWakuPrivateRelayEndpoints), /Waku/u);
});

const PEER = '/dns4/node.example/tcp/8000/wss/p2p/16Uiu2HAkykgaECHswi3YKJ5dMLbq2kPVCo89fcyTd38UcQD6ej5W';

test('self-hosted Waku peers replace the public bootstrap and select the cluster', async () => {
  const fake = fakeSdk();
  const adapter = new WakuPrivateRelayAdapter({ loadSdk: async () => fake.sdk, loadMuxers: async () => ['yamux', 'mplex'], bootstrapPeers: [PEER], clusterId: 3 });
  await adapter.publish([...WAKU_PRIVATE_RELAY_ENDPOINTS], signedEvent());
  assert.deepEqual(fake.calls.created[0].defaultBootstrap, false);
  assert.deepEqual(fake.calls.created[0].bootstrapPeers, [PEER]);
  assert.deepEqual(fake.calls.created[0].networkConfig, { clusterId: 3, numShardsInCluster: 8 });
  // One configured peer: use just it, and do not renew the filter subscription
  // on a single missed ping (that churn drops in-flight exchange messages).
  assert.equal(fake.calls.created[0].numPeersToUse, 1);
  assert.deepEqual(fake.calls.created[0].filter, { keepAliveIntervalMs: 30_000, pingsBeforePeerRenewed: 3, numPeersToUse: 1 });
  assert.deepEqual(fake.calls.created[0].lightPush, { numPeersToUse: 1 });
  assert.equal(fake.calls.created[0].libp2p.filterMultiaddrs, undefined, 'secure peers keep the SDK default wss-only dialling');
  assert.equal(fake.calls.created[0].libp2p.streamMuxers.length, 2, 'yamux and mplex are both offered');
  adapter.close();
  const local = fakeSdk();
  const loopback = new WakuPrivateRelayAdapter({ loadSdk: async () => local.sdk, loadMuxers: async () => [], bootstrapPeers: ['/ip4/127.0.0.1/tcp/8000/ws/p2p/16Uiu2HAkykgaECHswi3YKJ5dMLbq2kPVCo89fcyTd38UcQD6ej5W'] });
  await loopback.publish([...WAKU_PRIVATE_RELAY_ENDPOINTS], signedEvent());
  assert.equal(local.calls.created[0].libp2p.filterMultiaddrs, false, 'a loopback ws peer relaxes the multiaddr filter');
  loopback.close();
  const transport = createPrivateRelayTransport({ transport: 'waku', peers: [PEER], clusterId: 3 });
  assert.deepEqual(transport.urls, ['waku:lightpush', 'waku:filter']);
  transport.close();
});

test('Waku peer addresses must be browser-dialable multiaddrs and clusters whole numbers', () => {
  assert.deepEqual(validateWakuPeerAddresses([PEER, ' ', PEER]), [PEER], 'blank entries are dropped and duplicates collapse');
  assert.deepEqual(validateWakuPeerAddresses(['/ip4/127.0.0.1/tcp/8000/ws/p2p/16Uiu2HAkykgaECHswi3YKJ5dMLbq2kPVCo89fcyTd38UcQD6ej5W']).length, 1, 'plain ws is fine on this device');
  assert.throws(() => validateWakuPeerAddresses(['/dns4/node.example/tcp/8000/ws/p2p/16Uiu2HAkykgaECHswi3YKJ5dMLbq2kPVCo89fcyTd38UcQD6ej5W']), /wss/u);
  assert.throws(() => validateWakuPeerAddresses(['wss://node.example']), /multiaddr/u);
  assert.throws(() => validateWakuPeerAddresses(['/dns4/node.example/tcp/8000/wss']), /multiaddr/u);
  assert.throws(() => validateWakuPeerAddresses([PEER, PEER + 'a', PEER + 'b', PEER + 'c', PEER + 'd']), /invalid/u);
  assert.equal(validateWakuClusterId('3'), 3);
  assert.equal(validateWakuClusterId(1), 1);
  assert.throws(() => validateWakuClusterId(-1), /cluster/u);
  assert.throws(() => validateWakuClusterId('one'), /cluster/u);
});

test('the network descriptor resolves every input to a Waku network', () => {
  // A legacy relay-URL list or an explicit Nostr network yields a peerless Waku
  // network: the wallet relays exclusively over Waku.
  assert.deepEqual(privateRelayNetwork(['wss://a.example', 'wss://b.example']), { transport: 'waku', peers: [], clusterId: 1 });
  assert.deepEqual(privateRelayNetwork({ transport: 'waku', relayUrls: ['wss://a.example'] }), { transport: 'waku', peers: [], clusterId: 1 });
  assert.deepEqual(privateRelayNetwork({ transport: 'waku', relayUrls: [], wakuPeers: [PEER], wakuClusterId: 3 }), { transport: 'waku', peers: [PEER], clusterId: 3 });
  assert.deepEqual(privateRelayNetwork({ relayUrls: ['wss://a.example'] }), { transport: 'waku', peers: [], clusterId: 1 });
  assert.match(describePrivateRelayNetwork({ transport: 'waku', peers: [PEER], clusterId: 3 }).observers, /you configured/u);
  assert.equal(describePrivateRelayNetwork('waku').connection(2, 2), 'Connected to 2 of 2 Waku services');
  assert.match(describePrivateRelayNetwork('waku').observers, /IP address and timing/u);
});

test('the session factory builds a Waku transport without touching the SDK until first use', async () => {
  const transport = createPrivateRelayTransport({ transport: 'waku' });
  assert.deepEqual(transport.urls, ['waku:lightpush', 'waku:filter']);
  assert.deepEqual(await transport.connectionStatus(), { connected: 0, total: 2 });
  transport.close();
  // A legacy relay-URL list also builds a Waku transport now.
  const legacy = createPrivateRelayTransport(['wss://relay.one', 'wss://relay.two']);
  assert.deepEqual(legacy.urls, ['waku:lightpush', 'waku:filter']);
  legacy.close();
});

test('two messengers exchange an encrypted reply over a shared fake Waku node', async () => {
  const fake = fakeSdk();
  const shared = new WakuPrivateRelayAdapter({ loadSdk: async () => fake.sdk, loadMuxers: async () => [] });
  // Both ends share the node; delivery loops every published message back through the filter callback.
  fake.node.lightPush.send = async (_encoder, message) => { setTimeout(() => fake.deliver(message.payload), 0); return { successes: ['peer'], failures: [] }; };
  const transportFor = () => new BoundedPrivateRelayTransport([...WAKU_PRIVATE_RELAY_ENDPOINTS], shared, validateWakuPrivateRelayEndpoints);
  const sender = await PrivateRelayMessenger.create({ transport: 'waku' }, transportFor());
  const helper = await PrivateRelayMessenger.create({ transport: 'waku' }, transportFor());
  const received = [];
  helper.subscribe({ encrypted: true, onMessage: received_ => received.push(received_.message) });
  await flush();
  const expiresAt = Math.floor(Date.now() / 1000) + 60;
  await sender.publish({ version: 3, type: 'rejected', requestId: 'a'.repeat(64), quoteId: 'b'.repeat(64), nonce: 'c'.repeat(64), expiresAt, reason: 'busy' }, helper.publicKey);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(received.length, 1);
  assert.equal(received[0].type, 'rejected');
  assert.equal(received[0].reason, 'busy');
  sender.close();
  helper.close();
});

test('preferences persist Waku settings and load older or invalid transports as Waku', () => {
  const store = new Map();
  globalThis.window = {
    localStorage: { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) },
    dispatchEvent() { return true; },
  };
  try {
    assert.equal(DEFAULT_PRIVATE_RELAY_PREFERENCES.transport, 'waku');
    assert.equal(loadPrivateRelayPreferences().transport, 'waku');
    store.set('stellarkey.private-relay.preferences.v1', JSON.stringify({ useRelay: true, transport: 'carrier-pigeon', relayUrls: ['wss://a.example', 'wss://b.example'], feeAtomic: '10000' }));
    assert.equal(loadPrivateRelayPreferences().transport, 'waku');
    const saved = savePrivateRelayPreferences({ ...loadPrivateRelayPreferences(), transport: 'waku' });
    assert.equal(saved.transport, 'waku');
    assert.deepEqual([saved.wakuPeers, saved.wakuClusterId], [[], 1]);
    assert.equal(loadPrivateRelayPreferences().transport, 'waku');
    const custom = savePrivateRelayPreferences({ ...loadPrivateRelayPreferences(), wakuPeers: [PEER], wakuClusterId: 7 });
    assert.deepEqual([custom.wakuPeers, custom.wakuClusterId], [[PEER], 7]);
    assert.deepEqual([loadPrivateRelayPreferences().wakuPeers, loadPrivateRelayPreferences().wakuClusterId], [[PEER], 7]);
    store.set('stellarkey.private-relay.preferences.v1', JSON.stringify({ transport: 'waku', wakuPeers: ['nonsense'], wakuClusterId: 'x', relayUrls: ['wss://a.example', 'wss://b.example'], feeAtomic: '10000' }));
    assert.deepEqual([loadPrivateRelayPreferences().wakuPeers, loadPrivateRelayPreferences().wakuClusterId], [[], 1], 'invalid persisted peers never dial');
    assert.throws(() => savePrivateRelayPreferences({ ...loadPrivateRelayPreferences(), wakuPeers: ['nonsense'] }), /multiaddr/u);
    // A stored 'nostr' transport loads as Waku; save coerces any transport to Waku.
    store.set('stellarkey.private-relay.preferences.v1', JSON.stringify({ transport: 'nostr', wakuPeers: [PEER], wakuClusterId: 7 }));
    assert.equal(loadPrivateRelayPreferences().transport, 'waku');
    assert.equal(savePrivateRelayPreferences({ ...loadPrivateRelayPreferences(), transport: 'nostr' }).transport, 'waku');
  } finally {
    delete globalThis.window;
  }
});
