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
import { SimplePool } from 'nostr-tools/pool';

const NOW = 1_800_000_000;

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

test('the production Nostr pool keeps subscriptions reconnectable after a dropped socket', () => {
  const source = readFileSync(
    new URL('../src/features/private-balance/relay/nostr.ts', import.meta.url),
    'utf8',
  );
  assert.match(source, /enableReconnect:\s*true/);
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
  const relay = { resubscribeBackoff: [] };
  const pool = {
    ensureRelay: () => ++attempts === 1 ? new Promise(resolve => { finishOld = resolve; }) : Promise.resolve(relay),
    subscribeMany: () => { subscriptions += 1; return { close() {} }; },
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
