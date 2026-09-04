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
  createResilientPrivateRelaySubscription,
  firstAcceptedPrivateRelayPublish,
  PRIVATE_RELAY_RECONNECT_BACKOFF_MS,
  privateRelayConnectionOutcomes,
} from '../src/features/private-balance/relay/nostr.ts';
import { readFileSync } from 'node:fs';

const NOW = 1_800_000_000;

test('NIP-44 v2 payloads authenticate two ephemeral identities', async () => {
  const alice = await createPrivateRelayEphemeralIdentity();
  const bob = await createPrivateRelayEphemeralIdentity();
  const plaintext = '{"version":1,"type":"request"}';
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
    tags: [['t', 'stellarkey-private-relay-v1']],
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
