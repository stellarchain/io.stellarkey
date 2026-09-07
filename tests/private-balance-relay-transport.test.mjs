import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPrivateRelayEphemeralIdentity,
  decryptPrivateRelayPayload,
  encryptPrivateRelayPayload,
  signPrivateRelayEvent,
  verifyPrivateRelayEvent,
} from '../src/features/private-balance/relay/crypto.ts';
import {
  BoundedPrivateRelayTransport,
  validatePrivateRelayUrls,
} from '../src/features/private-balance/relay/transport.ts';
import {
  connectPrivateRelayWithDeadline,
  createResilientPrivateRelaySubscription,
  firstAcceptedPrivateRelayPublish,
  PRIVATE_RELAY_RECONNECT_BACKOFF_MS,
  PRIVATE_RELAY_TOPIC,
  NostrPrivateRelayAdapter,
  privateRelayConnectionOutcomes,
} from '../src/features/private-balance/relay/nostr.ts';
import { readFileSync } from 'node:fs';
import * as nostrTransport from '../src/features/private-balance/relay/nostr.ts';
import { AbstractSimplePool, SimplePool } from 'nostr-tools/pool';
import { finalizeEvent, generateSecretKey, verifyEvent } from 'nostr-tools/pure';

const NOW = 1_800_000_000;

// Only the wire is synthetic. EventTarget implements native listener ordering,
// including stopImmediatePropagation before the SDK's onmessage callback.
function socketFixture() {
  const sockets = [];
  class Socket extends EventTarget {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    readyState = 0;
    requests = [];
    constructor(url) {
      super();
      this.url = url;
      for (const name of ['open', 'close', 'error', 'message']) {
        let handler = null;
        Object.defineProperty(this, `on${name}`, {
          get: () => handler,
          set: next => {
            if (handler) this.removeEventListener(name, handler);
            handler = next;
            if (handler) this.addEventListener(name, handler);
          },
        });
      }
      sockets.push(this);
      queueMicrotask(() => {
        if (this.readyState !== 0) return;
        this.readyState = 1;
        this.dispatchEvent(new Event('open'));
      });
    }
    send(raw) {
      const data = JSON.parse(raw);
      if (data[0] === 'REQ') this.requests.push(data);
    }
    emit(raw) { this.dispatchEvent(new MessageEvent('message', { data: raw })); }
    close() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      this.dispatchEvent(new Event('close'));
    }
  }
  return { Socket, sockets };
}

const settle = () => new Promise(resolve => setImmediate(resolve));
const syntheticEvent = index => ({
  id: index.toString(16).padStart(64, '0'), pubkey: '11'.repeat(32), sig: '00'.repeat(64),
  kind: 24_333, created_at: NOW, tags: [['t', PRIVATE_RELAY_TOPIC]], content: '',
});
const wireEvent = (socket, event, requestIndex = 0) => JSON.stringify(['EVENT', socket.requests[requestIndex][1], event]);

async function actualAdapter(onEvent, urls = ['wss://synthetic.invalid/'], filters = [{ kinds: [24_333] }]) {
  const { Socket, sockets } = socketFixture();
  const previous = globalThis.WebSocket;
  globalThis.WebSocket = Socket;
  const adapter = new NostrPrivateRelayAdapter();
  let pool;
  try { pool = await adapter.pool(); } finally { globalThis.WebSocket = previous; }
  const subscription = adapter.subscribe(urls, filters, onEvent);
  await settle();
  return { adapter, pool, sockets, subscription, async close() {
    subscription.close();
    adapter.close(urls);
    await settle();
  } };
}

test('installed pool retains more invalid early IDs than the application replay capacity', async () => {
  const { Socket, sockets } = socketFixture();
  const pool = new AbstractSimplePool({ verifyEvent, websocketImplementation: Socket });
  const subscription = pool.subscribeMany(['wss://synthetic.invalid/'], { kinds: [24_333] }, { onevent() {} });
  await settle();
  try {
    const relay = await pool.ensureRelay('wss://synthetic.invalid/');
    const sdkSubscription = [...relay.openSubs.values()][0];
    const ids = Array.from({ length: 1_024 }, (_, index) => syntheticEvent(index + 1));
    for (const event of ids) sockets[0].emit(wireEvent(sockets[0], event));
    const retained = ids.filter(event => sdkSubscription.alreadyHaveEvent(event.id)).length;
    assert.equal(retained, 1_024, 'structural baseline: upstream IDs exceed the 512-entry application capacity');
  } finally { await subscription.close(); pool.close(['wss://synthetic.invalid/']); }
});

test('actual adapter bounds verified ID retention across relays and filters with FIFO eviction', async t => {
  const key = generateSecretKey();
  const events = Array.from({ length: 600 }, (_, index) => finalizeEvent({ ...syntheticEvent(index), content: String(index) }, key));
  key.fill(0);
  let deliveries = 0;
  let verifications = 0;
  const h = await actualAdapter(() => { deliveries += 1; }, ['wss://one.invalid/', 'wss://two.invalid/'], [{ kinds: [24_333] }, { '#t': [PRIVATE_RELAY_TOPIC] }]);
  try {
    for (const relay of h.pool.relays.values()) {
      const verify = relay.verifyEvent;
      t.mock.method(relay, 'verifyEvent', (...args) => { verifications += 1; return verify(...args); });
    }
    for (const event of events) h.sockets[0].emit(wireEvent(h.sockets[0], event));
    assert.equal(deliveries, 600);
    const relay = await h.pool.ensureRelay('wss://one.invalid/');
    const sdkSubscription = [...relay.openSubs.values()][0];
    const retained = events.filter(event => sdkSubscription.alreadyHaveEvent(event.id)).length;
    assert.equal(retained, 512, 'structural retention must be bounded in the actual SDK subscription path');
    assert.equal(h.pool.seenOn.size, 0, 'relay tracking must not add another retention path');
    assert.equal(verifications, 600);
    for (let index = 0; index < 2_000; index += 1) {
      h.sockets[1].emit(wireEvent(h.sockets[1], events.at(-1), index % 2));
    }
    assert.equal(deliveries, 600, 'one logical subscription shares duplicate suppression across relays and filters');
    assert.equal(verifications, 600, '2,000 retained duplicates do not repeat signature work');
    h.sockets[1].emit(wireEvent(h.sockets[1], events[0]));
    assert.equal(deliveries, 601, 'evicted transport IDs are eligible again; payment authority is separate');
    h.subscription.close();
    assert.equal(sdkSubscription.alreadyHaveEvent(events[0].id), false, 'close releases the retained IDs');
  } finally { await h.close(); }
});

test('actual adapter never lets an invalid early ID poison a later valid signed delivery', async () => {
  const key = generateSecretKey();
  const valid = finalizeEvent(syntheticEvent(1), key);
  key.fill(0);
  let deliveries = 0;
  const h = await actualAdapter(() => { deliveries += 1; });
  try {
    for (let index = 1; index <= 1_024; index += 1) h.sockets[0].emit(wireEvent(h.sockets[0], syntheticEvent(index)));
    const relay = await h.pool.ensureRelay('wss://synthetic.invalid/');
    const sdkSubscription = [...relay.openSubs.values()][0];
    const retained = Array.from({ length: 1_024 }, (_, index) => syntheticEvent(index + 1))
      .filter(event => sdkSubscription.alreadyHaveEvent(event.id)).length;
    assert.equal(retained, 0, 'invalid IDs never enter delivery bookkeeping');
    h.sockets[0].emit(wireEvent(h.sockets[0], { ...valid, kind: 1 }));
    h.sockets[0].emit(wireEvent(h.sockets[0], { ...valid, sig: '00'.repeat(64) }));
    h.sockets[0].emit(wireEvent(h.sockets[0], valid));
    assert.equal(deliveries, 1);
  } finally { await h.close(); }
});

test('actual adapter rejects oversized and excessive structure before JSON parsing or verification', async t => {
  const h = await actualAdapter(() => {});
  let parsed = 0;
  let verified = 0;
  let logged = 0;
  const parse = JSON.parse;
  const relay = await h.pool.ensureRelay('wss://synthetic.invalid/');
  const verify = relay.verifyEvent;
  const oversized = wireEvent(h.sockets[0], { ...syntheticEvent(1), content: 'x'.repeat(128 * 1024) });
  const oversizedUtf8 = wireEvent(h.sockets[0], { ...syntheticEvent(2), content: '雪'.repeat(30_000) });
  const deep = `[${'['.repeat(30)}0${']'.repeat(30)}]`;
  const wide = `[${'0,'.repeat(4_000)}0]`;
  t.mock.method(JSON, 'parse', (...args) => { parsed += 1; return parse(...args); });
  t.mock.method(relay, 'verifyEvent', (...args) => { verified += 1; return verify(...args); });
  t.mock.method(console, 'warn', () => { logged += 1; });
  t.mock.method(console, 'debug', () => { logged += 1; });
  try {
    for (let index = 0; index < 100; index += 1) {
      h.sockets[0].emit(oversized);
      h.sockets[0].emit(oversizedUtf8);
      h.sockets[0].emit(deep);
      h.sockets[0].emit(wide);
    }
    assert.deepEqual({ parsed, verified, logged }, { parsed: 0, verified: 0, logged: 0 });
  } finally { t.mock.restoreAll(); await h.close(); }
});

test('actual adapter canonicalizes ordinary JSON and excludes malformed ingress and raw SDK logging', async t => {
  let deliveries = 0;
  let logged = 0;
  let verified = 0;
  const key = generateSecretKey();
  const valid = finalizeEvent({ ...syntheticEvent(1), content: 'synthetic \\"id\\":[]{} \\ 雪' }, key);
  key.fill(0);
  const h = await actualAdapter(() => { deliveries += 1; throw new Error('Synthetic consumer failure'); });
  const relay = await h.pool.ensureRelay('wss://synthetic.invalid/');
  const verify = relay.verifyEvent;
  t.mock.method(relay, 'verifyEvent', (...args) => { verified += 1; return verify(...args); });
  t.mock.method(console, 'warn', () => { logged += 1; });
  t.mock.method(console, 'debug', () => { logged += 1; });
  try {
    const id = h.sockets[0].requests[0][1];
    const malformed = [
      'not json', JSON.stringify(['NOTICE', 'Synthetic notice']),
      `  ${JSON.stringify(['EVENT', 'missing', null])}`,
      JSON.stringify(['EVENT', 'missing', null]).replace('EVENT', 'EV\\u0045NT'),
      JSON.stringify(['EVENT', 'x'.repeat(100), valid]),
      JSON.stringify(['EVENT', id, { ...valid, tags: [null] }]),
      JSON.stringify(['EVENT', id, { ...valid, tags: Array.from({ length: 65 }, () => ['t', 'synthetic']) }]),
      JSON.stringify(['EVENT', id, { ...valid, content: 'x'.repeat(41 * 1024) }]),
      JSON.stringify(['EVENT', id, { ...valid, kind: 1.5 }]),
      JSON.stringify(['EVENT', id, null]),
      new Uint8Array(10),
    ];
    for (let index = 0; index < 100; index += 1) for (const raw of malformed) h.sockets[0].emit(raw);
    const reordered = { content: valid.content, tags: valid.tags, sig: valid.sig, created_at: valid.created_at,
      pubkey: valid.pubkey, id: valid.id, kind: valid.kind, extra: { id: '00'.repeat(32) } };
    const raw = ` \n ${JSON.stringify(['EVENT', id, reordered], null, 2)}`.replace('EVENT', 'EV\\u0045NT');
    h.sockets[0].emit(raw);
    h.sockets[0].emit(raw);
    assert.deepEqual({ deliveries, logged, verified }, { deliveries: 1, logged: 0, verified: 1 });
  } finally { t.mock.restoreAll(); await h.close(); }
});

test('actual adapter reconnects original filters without advancing past invalid future timestamps', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let deliveries = 0;
  const filter = { kinds: [24_333], since: NOW - 30 };
  const h = await actualAdapter(() => { deliveries += 1; }, ['wss://synthetic.invalid/'], [filter]);
  const key = generateSecretKey();
  const valid = finalizeEvent(syntheticEvent(1), key);
  const seen = finalizeEvent({ ...syntheticEvent(2), content: 'Synthetic earlier delivery' }, key);
  key.fill(0);
  try {
    const first = h.sockets[0];
    first.emit(wireEvent(first, seen));
    assert.equal(deliveries, 1);
    first.emit(wireEvent(first, { ...valid, sig: '00'.repeat(64), created_at: NOW + 100_000 }));
    first.emit(wireEvent(first, { ...valid, kind: 1, created_at: NOW + 200_000 }));
    first.close();
    t.mock.timers.tick(1_000);
    await settle();
    assert.equal(h.sockets.length, 2, 'one reconnect owner creates exactly one replacement');
    const next = h.sockets[1];
    assert.equal(next.requests.length, 1);
    assert.equal(next.requests[0][2].since, NOW - 30, 'invalid input must not mutate the replay cursor');
    next.emit(wireEvent(next, seen));
    assert.equal(deliveries, 1, 'reconnecting retains verified duplicate suppression');
    next.emit(wireEvent(next, valid));
    assert.equal(deliveries, 2);
    h.subscription.close();
    next.close();
    t.mock.timers.tick(60_000);
    await settle();
    assert.equal(h.sockets.length, 2, 'closing the logical subscription cancels reconnects');
  } finally { await h.close(); }
});

test('actual adapter retries a relay CLOSED control on the same healthy socket', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let deliveries = 0;
  const h = await actualAdapter(() => { deliveries += 1; });
  const key = generateSecretKey();
  const valid = finalizeEvent(syntheticEvent(1), key);
  key.fill(0);
  try {
    const socket = h.sockets[0];
    socket.emit(JSON.stringify(['CLOSED', socket.requests[0][1], 'Synthetic closure']));
    t.mock.timers.tick(1_000);
    await settle();
    assert.equal(h.sockets.length, 1);
    assert.equal(socket.requests.length, 2);
    socket.emit(wireEvent(socket, valid, 1));
    assert.equal(deliveries, 1);
  } finally { await h.close(); }
});

test('actual adapter resets reconnect backoff after each established quiet recovery', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = await actualAdapter(() => {});
  try {
    for (let index = 0; index < 8; index += 1) {
      h.sockets.at(-1).close();
      t.mock.timers.tick(999);
      await settle();
      assert.equal(h.sockets.length, index + 1);
      t.mock.timers.tick(1);
      await settle();
      assert.equal(h.sockets.length, index + 2, 'a recovered open subscription restarts at the one-second retry');
      assert.equal(h.sockets.at(-1).requests.length, 1);
    }
  } finally { await h.close(); }
});

test('failed connection setup and immediate subscription rejection retain increasing bounded backoff', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const immediateClose of [false, true]) {
    let attempts = 0;
    const subscription = createResilientPrivateRelaySubscription({
      urls: ['wss://synthetic.invalid/'], filters: [{}], retryBackoffMs: [10, 20, 30], onEvent() {},
      subscribe: (_url, _filter, handlers) => {
        attempts += 1;
        if (!immediateClose) throw new Error('Synthetic startup failure');
        handlers.onClose();
        return { close() {} };
      },
    });
    try {
      await settle();
      for (const [index, delay] of [10, 20, 30, 30].entries()) {
        t.mock.timers.tick(delay - 1);
        await settle();
        assert.equal(attempts, index + 1);
        t.mock.timers.tick(1);
        await settle();
        assert.equal(attempts, index + 2);
      }
    } finally { subscription.close(); }
  }
});

test('actual adapter accepts the maximum padded NIP-44 payload with signed identity and control replies', async () => {
  const alice = await createPrivateRelayEphemeralIdentity();
  const bob = await createPrivateRelayEphemeralIdentity();
  const plaintext = '{}'.padEnd(24 * 1024, ' ');
  const content = await encryptPrivateRelayPayload(alice.secretKey, bob.publicKey, plaintext);
  const valid = finalizeEvent({ ...syntheticEvent(1), content }, alice.secretKey);
  const deliveries = [];
  const h = await actualAdapter(event => { deliveries.push(event); });
  try {
    assert.ok(content.length > 32 * 1024);
    h.sockets[0].emit(` \n ${wireEvent(h.sockets[0], valid)} \t`);
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].pubkey === alice.publicKey, true);
    assert.equal(await decryptPrivateRelayPayload(bob.secretKey, alice.publicKey, deliveries[0].content) === plaintext, true);
    const relay = await h.pool.ensureRelay('wss://synthetic.invalid/');
    const sub = [...relay.openSubs.values()][0];
    h.sockets[0].emit(JSON.stringify(['EOSE', sub.id]));
    assert.equal(sub.eosed, true);
    const pending = h.adapter.publish(['wss://synthetic.invalid/'], valid);
    await settle();
    h.sockets[0].emit(JSON.stringify(['OK', valid.id, true, 'Synthetic accepted']));
    assert.equal((await pending).get('wss://synthetic.invalid/'), true);
    const rejected = h.adapter.publish(['wss://synthetic.invalid/'], valid);
    await settle();
    h.sockets[0].emit(JSON.stringify(['OK', valid.id, false, 'Synthetic rejected']));
    assert.equal((await rejected).get('wss://synthetic.invalid/'), false);
  } finally { alice.secretKey.fill(0); bob.secretKey.fill(0); await h.close(); }
});

test('NIP-44 v2 payloads authenticate two ephemeral identities', async () => {
  const alice = await createPrivateRelayEphemeralIdentity();
  const bob = await createPrivateRelayEphemeralIdentity();
  const plaintext = '{"version":2,"type":"request"}';
  const encrypted = await encryptPrivateRelayPayload(alice.secretKey, bob.publicKey, plaintext);
  assert.notEqual(encrypted, plaintext);
  assert.equal(await decryptPrivateRelayPayload(bob.secretKey, alice.publicKey, encrypted), plaintext);
  await assert.rejects(
    decryptPrivateRelayPayload(bob.secretKey, alice.publicKey, `${encrypted.slice(0, -2)}AA`),
    /invalid|authenticate|payload/iu,
  );

  const event = await signPrivateRelayEvent(alice.secretKey, {
    kind: 24_333,
    created_at: NOW,
    tags: [['t', PRIVATE_RELAY_TOPIC]],
    content: encrypted,
  });
  assert.equal(await verifyPrivateRelayEvent(event), true);
  assert.equal(event.pubkey, alice.publicKey);
  alice.secretKey.fill(0);
  bob.secretKey.fill(0);
});

test('recommended relay mode requires two distinct secure relay origins', () => {
  assert.deepEqual(
    validatePrivateRelayUrls(['wss://relay.one', 'wss://relay.two/path']),
    ['wss://relay.one/', 'wss://relay.two/path'],
  );
  assert.throws(() => validatePrivateRelayUrls(['wss://relay.one']), /two/iu);
  assert.throws(
    () => validatePrivateRelayUrls(['wss://relay.one', 'wss://relay.one/']),
    /two/iu,
  );
  assert.throws(
    () => validatePrivateRelayUrls(['https://relay.one', 'wss://relay.two']),
    /wss/iu,
  );
});

test('bounded transport closes every relay subscription on abort', async () => {
  const closed = [];
  const adapter = {
    publish: async () => new Map([
      ['wss://relay.one/', true],
      ['wss://relay.two/', true],
    ]),
    subscribe: (...args) => {
      void args;
      return { close: () => closed.push('closed') };
    },
    waitUntilConnected: async urls => new Map(urls.map((url, index) => [url, index === 0])),
    connectionStatus: async urls => new Map(urls.map((url, index) => [url, index === 0])),
    close: urls => closed.push(...urls),
  };
  const transport = new BoundedPrivateRelayTransport(
    ['wss://relay.one', 'wss://relay.two'],
    adapter,
  );
  const controller = new AbortController();
  const subscription = transport.subscribe([{}], () => {}, controller.signal);
  controller.abort();
  assert.equal(closed.length, 1);
  subscription.close();
  transport.close();
  assert.ok(closed.includes('wss://relay.one/'));
  assert.ok(closed.includes('wss://relay.two/'));
});

test('bounded transport reports at-least-one relay readiness without weakening the two-origin policy', async () => {
  const adapter = {
    publish: async () => new Map(),
    subscribe: () => ({ close() {} }),
    waitUntilConnected: async urls => new Map(urls.map((url, index) => [url, index === 1])),
    connectionStatus: async urls => new Map(urls.map((url, index) => [url, index === 1])),
    close() {},
  };
  const transport = new BoundedPrivateRelayTransport(
    ['wss://relay.one', 'wss://relay.two'],
    adapter,
  );

  assert.deepEqual(await transport.waitUntilConnected(), { connected: 1, total: 2 });
  assert.deepEqual(await transport.connectionStatus(), { connected: 1, total: 2 });
});

test('the production Nostr pool keeps connection health checks enabled', () => {
  const source = readFileSync(
    new URL('../src/features/private-balance/relay/nostr.ts', import.meta.url),
    'utf8',
  );
  assert.match(source, /enablePing:\s*true/);
});

test('a dropped helper connection retries promptly with bounded backoff', () => {
  assert.deepEqual(PRIVATE_RELAY_RECONNECT_BACKOFF_MS, [1_000, 2_000, 5_000, 10_000, 20_000, 30_000, 60_000]);
});

test('a subscription rejected during startup retries and receives later events', async () => {
  let attempts = 0;
  let recoveredEvent = null;
  const subscription = createResilientPrivateRelaySubscription({
    urls: ['wss://relay.one/'],
    filters: [{}],
    retryBackoffMs: [5],
    onEvent: event => { recoveredEvent = event; },
    subscribe: (_url, _filter, handlers) => {
      attempts += 1;
      if (attempts === 1) {
        queueMicrotask(() => handlers.onClose());
      } else {
        queueMicrotask(() => handlers.onEvent({ id: 'recovered' }));
      }
      return { close() {} };
    },
  });

  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(attempts, 2);
  assert.deepEqual(recoveredEvent, { id: 'recovered' });
  subscription.close();
});

test('closing a rejected subscription cancels its pending retry', async () => {
  let attempts = 0;
  const subscription = createResilientPrivateRelaySubscription({
    urls: ['wss://relay.one/'],
    filters: [{}],
    retryBackoffMs: [25],
    onEvent() {},
    subscribe: (_url, _filter, handlers) => {
      attempts += 1;
      queueMicrotask(() => handlers.onClose());
      return { close() {} };
    },
  });
  await new Promise(resolve => setTimeout(resolve, 5));
  subscription.close();
  await new Promise(resolve => setTimeout(resolve, 35));
  assert.equal(attempts, 1);
});

test('aborting an in-flight relay connection closes it and rejects promptly', async () => {
  const closed = [];
  const pool = {
    ensureRelay: () => new Promise(() => {}),
    close: urls => closed.push(...urls),
  };
  const controller = new AbortController();
  const pending = connectPrivateRelayWithDeadline(
    pool,
    'wss://relay.one/',
    controller.signal,
    10_000,
  );
  controller.abort();

  await assert.rejects(
    Promise.race([
      pending,
      new Promise((_, reject) => setTimeout(() => reject(new Error('connection abort timed out')), 100)),
    ]),
    error => error instanceof DOMException && error.name === 'AbortError',
  );
  assert.deepEqual(closed, ['wss://relay.one/']);
});

test('a cancelled non-owning connection wait cannot close a selected connection on late completion', async () => {
  const closed = [];
  let finishOld;
  let attempt = 0;
  const relay = { resubscribeBackoff: [] };
  const pool = {
    ensureRelay: () => ++attempt === 1 ? new Promise(resolve => { finishOld = resolve; }) : Promise.resolve(relay),
    close: urls => closed.push(...urls),
  };
  const controller = new AbortController();
  const old = connectPrivateRelayWithDeadline(pool, 'wss://relay.one/', controller.signal, 10_000, { closeOnFailure: false });
  const cancelled = assert.rejects(old, { name: 'AbortError' });
  controller.abort();
  await cancelled;
  await connectPrivateRelayWithDeadline(pool, 'wss://relay.one/', new AbortController().signal, 10_000, { closeOnFailure: false });
  finishOld(relay);
  await Promise.resolve();
  assert.deepEqual(closed, [], 'the session, not an obsolete subscription waiter, owns the socket');
  pool.close(['wss://relay.one/']);
  assert.equal(closed.length, 1);
});

test('a non-owning subscription connection timeout leaves socket cleanup to the session', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let closed = 0;
  let finish;
  const pool = { ensureRelay: () => new Promise(resolve => { finish = resolve; }), close: () => { closed += 1; } };
  const pending = connectPrivateRelayWithDeadline(pool, 'wss://relay.one/', new AbortController().signal, 20, { closeOnFailure: false });
  const failed = assert.rejects(pending, /timed out/);
  t.mock.timers.tick(20);
  await failed;
  finish({ resubscribeBackoff: [] });
  await Promise.resolve();
  assert.equal(closed, 0);
});

test('the Nostr adapter keeps a selected subscription alive after cancelled discovery connects late', async () => {
  const closed = [];
  let finishOld;
  let attempts = 0;
  let subscriptions = 0;
  const relay = { resubscribeBackoff: [], subscribe: () => { subscriptions += 1; return { close() {} }; } };
  const pool = {
    ensureRelay: () => ++attempts === 1 ? new Promise(resolve => { finishOld = resolve; }) : Promise.resolve(relay),
    close: urls => closed.push(...urls),
  };
  const adapter = new NostrPrivateRelayAdapter();
  // Replace only the external pool boundary; exercise real adapter lifecycle.
  adapter.poolPromise = Promise.resolve(pool);
  const discovery = adapter.subscribe(['wss://relay.one/'], [{}], () => {});
  await new Promise(resolve => setImmediate(resolve));
  discovery.close();
  const selected = adapter.subscribe(['wss://relay.one/'], [{}], () => {});
  await new Promise(resolve => setImmediate(resolve));
  finishOld(relay);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(subscriptions, 1);
  assert.deepEqual(closed, []);
  selected.close();
  adapter.close(['wss://relay.one/']);
  await Promise.resolve();
  assert.deepEqual(closed, ['wss://relay.one/']);
});

test('connection-owned socket deadlines let the real pool retry and close only its stalled sockets', async t => {
  assert.equal(typeof nostrTransport.boundedPrivateRelayWebSocket, 'function');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const sockets = [];
  class SyntheticWebSocket extends EventTarget {
    static CONNECTING = 0;
    static OPEN = 1;
    readyState = 0;
    constructor() { super(); sockets.push(this); }
    close() {
      this.readyState = 3;
      this.dispatchEvent(new Event('close'));
      this.onclose?.({ message: 'Synthetic connection deadline' });
    }
    send() {}
  }
  const pool = new SimplePool({
    enablePing: false, enableReconnect: false,
    websocketImplementation: nostrTransport.boundedPrivateRelayWebSocket(SyntheticWebSocket, 20),
  });
  try {
    for (let index = 0; index < 3; index += 1) {
      const pending = connectPrivateRelayWithDeadline(pool, 'wss://synthetic.invalid/', new AbortController().signal, 30, { closeOnFailure: false });
      const failed = assert.rejects(pending);
      t.mock.timers.tick(20);
      await failed;
    }
    assert.equal(sockets.length, 3, 'each retry must get a fresh connection attempt');
    assert.ok(sockets.every(socket => socket.readyState === 3), 'no orphaned CONNECTING sockets');
  } finally { pool.close(['wss://synthetic.invalid/']); }
});

test('an established socket clears its setup deadline and remains owned by the session', t => {
  assert.equal(typeof nostrTransport.boundedPrivateRelayWebSocket, 'function');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let closed = 0;
  class SyntheticWebSocket extends EventTarget {
    static CONNECTING = 0;
    readyState = 0;
    close() { closed += 1; }
  }
  const Socket = nostrTransport.boundedPrivateRelayWebSocket(SyntheticWebSocket, 20);
  const socket = new Socket('wss://synthetic.invalid/');
  socket.onopen = () => {};
  socket.readyState = 1;
  socket.dispatchEvent(new Event('open'));
  t.mock.timers.tick(100);
  assert.equal(closed, 0);
  socket.close();
  assert.equal(closed, 1);
});

test('a socket opening after the library detached it cannot survive as an orphan or close its replacement', async t => {
  assert.equal(typeof nostrTransport.boundedPrivateRelayWebSocket, 'function');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const sockets = [];
  class SyntheticWebSocket extends EventTarget {
    static CONNECTING = 0;
    readyState = 0;
    constructor() { super(); sockets.push(this); }
    open() { this.readyState = 1; this.dispatchEvent(new Event('open')); this.onopen?.(); }
    close() { this.readyState = 3; this.dispatchEvent(new Event('close')); this.onclose?.({ message: 'Synthetic close' }); }
    send() {}
  }
  const pool = new SimplePool({ enablePing: false, enableReconnect: false,
    websocketImplementation: nostrTransport.boundedPrivateRelayWebSocket(SyntheticWebSocket, 20) });
  try {
    const abandoned = pool.ensureRelay('wss://synthetic.invalid/', { connectionTimeout: 10 });
    const rejected = assert.rejects(abandoned);
    t.mock.timers.tick(10);
    await rejected;
    assert.equal(sockets[0].onopen, null);
    const replacement = pool.ensureRelay('wss://synthetic.invalid/');
    sockets[1].open();
    await replacement;
    sockets[0].open();
    t.mock.timers.tick(30);
    assert.equal(sockets[0].readyState, 3, 'late unowned connection closes itself');
    assert.equal(sockets[1].readyState, 1, 'current selected connection survives');
  } finally { pool.close(['wss://synthetic.invalid/']); }
  assert.equal(sockets[1].readyState, 3, 'session owns normal connection cleanup');
});

test('Nostr connection status preserves root relay URL identity', () => {
  assert.deepEqual(
    [...privateRelayConnectionOutcomes(
      ['wss://relay.one/', 'wss://relay.two/path/'],
      new Map([
        ['wss://relay.one/', true],
        ['wss://relay.two/path', true],
      ]),
    )],
    [
      ['wss://relay.one/', true],
      ['wss://relay.two/path/', true],
    ],
  );
});

test('relay publishing unblocks when the first configured relay accepts', async () => {
  let acceptSlowRelay;
  const slowRelay = new Promise(resolve => { acceptSlowRelay = resolve; });

  const outcome = await Promise.race([
    firstAcceptedPrivateRelayPublish(
      ['wss://relay.one/', 'wss://relay.two/'],
      [Promise.resolve(), slowRelay],
    ),
    new Promise(resolve => setTimeout(() => resolve('timed-out'), 100)),
  ]);

  assert.ok(outcome instanceof Map);
  assert.deepEqual([...outcome], [['wss://relay.one/', true]]);
  acceptSlowRelay();
});

test('relay publishing reports failure only after every configured relay rejects', async () => {
  const outcome = await firstAcceptedPrivateRelayPublish(
    ['wss://relay.one/', 'wss://relay.two/'],
    [Promise.reject(new Error('one failed')), Promise.reject(new Error('two failed'))],
  );

  assert.deepEqual([...outcome], [
    ['wss://relay.one/', false],
    ['wss://relay.two/', false],
  ]);
});
