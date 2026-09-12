import assert from 'node:assert/strict';
import test from 'node:test';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import {
  deriveStealthMetaKeys,
  deriveStealthRecipient,
} from '@stellarkey/private-balance';
import { HorizonStealthAnnouncementReader } from '../src/features/private-balance/runtime/stealth-horizon.ts';
import { HorizonRequestError } from '../src/lib/horizon.ts';

const bytes = value => new Uint8Array(32).fill(value);
const announcer = Keypair.fromRawEd25519Seed(bytes(61)).publicKey();
const sender = Keypair.fromRawEd25519Seed(bytes(62)).publicKey();

async function paymentFixture() {
  const keys = deriveStealthMetaKeys(bytes(11), 'testnet', bytes(10));
  const payment = await deriveStealthRecipient(keys, bytes(21), 'testnet', 'portable');
  return {
    destination: StrKey.encodeEd25519PublicKey(payment.publicKey),
    ephemeralPublicKey: payment.ephemeralPublicKey,
  };
}

const latestLedgers = {
  _embedded: {
    records: [{ sequence: 500, closed_at: '2026-08-30T12:00:00Z' }],
  },
};

test('Horizon reader validates the stealth transaction shape and separates reserve from amount', async () => {
  const fixture = await paymentFixture();
  const transactionHash = 'ab'.repeat(32);
  const pagingToken = (499n << 32n | 7n).toString();
  const requests = [];
  const request = async url => {
    requests.push(url);
    const parsed = new URL(url);
    if (parsed.pathname === '/ledgers') return latestLedgers;
    if (parsed.pathname === `/accounts/${announcer}/payments`) {
      assert.equal(parsed.searchParams.get('cursor'), '123');
      assert.equal(parsed.searchParams.get('order'), 'asc');
      assert.equal(parsed.searchParams.has('join'), false);
      return {
        _embedded: {
          records: [{
            id: 'announcement-1',
            type: 'payment',
            transaction_hash: transactionHash,
            transaction_successful: true,
            created_at: '2026-08-30T11:59:00Z',
            paging_token: pagingToken,
            from: sender,
            to: announcer,
            asset_type: 'native',
            amount: '0.0000001',
          }],
        },
      };
    }
    if (parsed.pathname === `/transactions/${transactionHash}`) {
      return {
        successful: true,
        memo_type: 'hash',
        memo: Buffer.from(fixture.ephemeralPublicKey).toString('base64'),
      };
    }
    if (parsed.pathname === `/transactions/${transactionHash}/operations`) {
      return {
        _embedded: {
          records: [
            {
              type: 'create_account',
              transaction_successful: true,
              funder: sender,
              account: fixture.destination,
              starting_balance: '1.0000000',
            },
            {
              type: 'payment',
              transaction_successful: true,
              from: sender,
              to: fixture.destination,
              asset_type: 'native',
              amount: '2.5000000',
            },
            {
              type: 'payment',
              transaction_successful: true,
              from: sender,
              to: announcer,
              asset_type: 'native',
              amount: '0.0000001',
            },
          ],
        },
      };
    }
    throw new Error(`Unexpected request ${url}`);
  };

  const reader = new HorizonStealthAnnouncementReader({
    network: 'testnet',
    announcerPublicKey: announcer,
    request,
  });
  const page = await reader.readPage({ cursor: '123', lowerBoundCreatedAt: 0, limit: 200 });

  assert.equal(page.hasMore, false);
  assert.equal(page.latestLedger, 500);
  assert.equal(page.nextCursor, pagingToken);
  assert.equal(page.announcements.length, 1);
  assert.deepEqual(page.announcements[0], {
    pagingToken,
    transactionHash,
    ephemeralPublicKey: fixture.ephemeralPublicKey,
    destinationPublicKey: StrKey.decodeEd25519PublicKey(fixture.destination),
    amountStroops: '25000000',
    ledger: 499,
    createdAt: Date.parse('2026-08-30T11:59:00Z'),
  });
  assert.equal(requests.length, 4);
});

test('Horizon reader skips malformed announcer spam but advances to its returned token', async () => {
  const transactionHash = 'cd'.repeat(32);
  const request = async url => {
    const parsed = new URL(url);
    if (parsed.pathname === '/ledgers') return latestLedgers;
    if (parsed.pathname.includes('/payments')) {
      return {
        _embedded: {
          records: [{
            type: 'payment',
            transaction_hash: transactionHash,
            transaction_successful: true,
            created_at: '2026-08-30T11:59:00Z',
            paging_token: (499n << 32n | 8n).toString(),
            from: sender,
            to: announcer,
            asset_type: 'native',
            amount: '0.0000001',
          }],
        },
      };
    }
    if (parsed.pathname === `/transactions/${transactionHash}`) {
      return { successful: true, memo_type: 'text', memo: 'not-an-ephemeral-key' };
    }
    throw new Error('Operations must not be fetched for an invalid memo');
  };
  const page = await new HorizonStealthAnnouncementReader({
    network: 'testnet',
    announcerPublicKey: announcer,
    request,
  }).readPage({ cursor: '123', lowerBoundCreatedAt: 0, limit: 200 });

  assert.deepEqual(page.announcements, []);
  assert.equal(page.nextCursor, (499n << 32n | 8n).toString());
});

test('Horizon discovery forwards cancellation to the physical fetch', async t => {
  const controller = new AbortController();
  let start;
  const started = new Promise(resolve => { start = resolve; });
  let release;
  let fetchSignal;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    if (fetchSignal) return Response.json({ _embedded: { records: [] } });
    fetchSignal = init.signal;
    start();
    return new Promise(resolve => { release = () => resolve(Response.json(latestLedgers)); });
  });
  const reader = new HorizonStealthAnnouncementReader({ network: 'testnet', announcerPublicKey: announcer });
  const run = reader.readPage({ cursor: '123', lowerBoundCreatedAt: 0, limit: 200, signal: controller.signal })
    .then(() => null, error => error);
  await started;
  controller.abort();
  const cancelledFetch = fetchSignal.aborted;
  // Settle even the intentionally uncooperative fetch before making assertions.
  release();
  const error = await run;
  assert.equal(cancelledFetch, true);
  assert.equal(error?.name, 'AbortError');
});

test('Horizon discovery rejects pre-aborted pages before any request', async () => {
  const controller = new AbortController();
  controller.abort();
  let requests = 0;
  const reader = new HorizonStealthAnnouncementReader({
    network: 'testnet', announcerPublicKey: announcer,
    request: async url => { requests += 1; return new URL(url).pathname === '/ledgers' ? latestLedgers : { _embedded: { records: [] } }; },
  });
  const error = await reader.readPage({ cursor: '123', lowerBoundCreatedAt: 0, limit: 200, signal: controller.signal })
    .then(() => null, failure => failure);
  assert.equal(requests, 0);
  assert.equal(error?.name, 'AbortError');
});

test('Horizon discovery does not retry an oversized page after cancellation', async () => {
  const controller = new AbortController();
  let payments = 0;
  const reader = new HorizonStealthAnnouncementReader({
    network: 'testnet', announcerPublicKey: announcer,
    request: async url => {
      if (new URL(url).pathname === '/ledgers') return latestLedgers;
      payments += 1;
      controller.abort();
      throw new HorizonRequestError('Synthetic oversized page', { kind: 'response_too_large' });
    },
  });
  const error = await reader.readPage({ cursor: '123', lowerBoundCreatedAt: 0, limit: 200, signal: controller.signal })
    .then(() => null, failure => failure);
  assert.equal(payments, 1);
  assert.equal(error?.name, 'AbortError');
});

test('Horizon discovery guards late ledgers and forwards the signal to custom requests', async () => {
  const controller = new AbortController();
  let signal;
  let requests = 0;
  const reader = new HorizonStealthAnnouncementReader({
    network: 'testnet', announcerPublicKey: announcer,
    request: async (url, init) => {
      requests += 1;
      signal ??= init?.signal;
      if (new URL(url).pathname === '/ledgers') {
        controller.abort();
        return latestLedgers;
      }
      return { _embedded: { records: [] } };
    },
  });
  const error = await reader.readPage({ cursor: null, lowerBoundCreatedAt: 0, limit: 200, signal: controller.signal })
    .then(() => null, failure => failure);
  assert.equal(requests, 1, 'no retained-history or payment request follows revocation');
  assert.equal(signal === controller.signal, true);
  assert.equal(error?.name, 'AbortError');
});

test('Horizon cancellation drains the current batch without starting operations or another batch', async () => {
  const controller = new AbortController();
  let started;
  const batchStarted = new Promise(resolve => { started = resolve; });
  const releases = [];
  let transactions = 0;
  let operations = 0;
  const reader = new HorizonStealthAnnouncementReader({
    network: 'testnet', announcerPublicKey: announcer,
    request: async url => {
      const pathname = new URL(url).pathname;
      if (pathname === '/ledgers') return latestLedgers;
      if (pathname.includes('/payments')) return { _embedded: { records: Array.from({ length: 10 }, (_, index) => ({
        type: 'payment', transaction_hash: (index + 1).toString(16).padStart(64, '0'), transaction_successful: true,
        created_at: '2026-08-30T11:59:00Z', paging_token: ((499n << 32n) + BigInt(index + 1)).toString(),
        from: sender, to: announcer, asset_type: 'native', amount: '0.0000001',
      })) } };
      if (pathname.endsWith('/operations')) { operations += 1; return { _embedded: { records: [] } }; }
      transactions += 1;
      if (transactions > 8) return { successful: true, memo_type: 'text', memo: '' };
      return new Promise(resolve => {
        releases.push(() => resolve({ successful: true, memo_type: 'hash', memo: Buffer.from(bytes(9)).toString('base64') }));
        if (releases.length === 8) started();
      });
    },
  });
  let settled = false;
  const run = reader.readPage({ cursor: '123', lowerBoundCreatedAt: 0, limit: 200, signal: controller.signal })
    .then(() => { settled = true; return null; }, error => { settled = true; return error; });
  await batchStarted;
  controller.abort();
  releases[0]();
  // A turn boundary drains the resolved lookup's microtasks, without a timer.
  await new Promise(resolve => setImmediate(resolve));
  const settledBeforeDrain = settled;
  for (const release of releases.slice(1)) release();
  const error = await run;
  assert.equal(settledBeforeDrain, false, 'reader must drain every started lookup');
  assert.equal(transactions, 8);
  assert.equal(operations, 0);
  assert.equal(error?.name, 'AbortError');
});

test('Horizon recovery requests never reveal a birthday through ledger probes or a starting cursor', async () => {
  const requestedLedgers = [];
  let paymentsCursor = null;
  const request = async url => {
    const parsed = new URL(url);
    if (parsed.pathname === '/ledgers') {
      const sequence = parsed.searchParams.get('order') === 'asc' ? 1 : 10;
      return { _embedded: { records: [{ sequence, closed_at: new Date(sequence * 1_000).toISOString() }] } };
    }
    const ledgerMatch = /^\/ledgers\/(\d+)$/u.exec(parsed.pathname);
    if (ledgerMatch) {
      const sequence = Number(ledgerMatch[1]);
      requestedLedgers.push(sequence);
      return { sequence, closed_at: new Date(sequence * 1_000).toISOString() };
    }
    if (parsed.pathname.includes('/payments')) {
      paymentsCursor = parsed.searchParams.get('cursor');
      return { _embedded: { records: [] } };
    }
    throw new Error(`Unexpected request ${url}`);
  };
  const reader = new HorizonStealthAnnouncementReader({
    network: 'testnet',
    announcerPublicKey: announcer,
    request,
  });
  const page = await reader.readPage({ cursor: null, lowerBoundCreatedAt: 5_000, limit: 200 });

  assert.deepEqual(requestedLedgers, []);
  assert.equal(paymentsCursor, '4294967295');
  assert.equal(page.nextCursor, paymentsCursor);
  assert.equal(page.latestLedger, 10);
  for (const birthday of [0, 4_999, 5_001, 100_000]) {
    await reader.readPage({ cursor: null, lowerBoundCreatedAt: birthday, limit: 200 });
    assert.equal(paymentsCursor, page.nextCursor);
    assert.deepEqual(requestedLedgers, []);
  }
  await reader.readPage({ cursor: '123', lowerBoundCreatedAt: 5_000, limit: 200 });
  assert.equal(paymentsCursor, '123', 'a durable forward cursor remains usable');
});

test('Horizon reader never probes ledgers before the retained history boundary', async () => {
  const earliestSequence = 128;
  const latestSequence = 500;
  const requestedLedgers = [];
  let paymentsCursor = null;
  const request = async url => {
    const parsed = new URL(url);
    if (parsed.pathname === '/ledgers') {
      const sequence = parsed.searchParams.get('order') === 'asc'
        ? earliestSequence
        : latestSequence;
      return {
        _embedded: {
          records: [{ sequence, closed_at: new Date(sequence * 1_000).toISOString() }],
        },
      };
    }
    const ledgerMatch = /^\/ledgers\/(\d+)$/u.exec(parsed.pathname);
    if (ledgerMatch) {
      const sequence = Number(ledgerMatch[1]);
      requestedLedgers.push(sequence);
      if (sequence < earliestSequence) {
        throw new Error('Horizon request failed (410): Data Requested Is Before Recorded History');
      }
      return { sequence, closed_at: new Date(sequence * 1_000).toISOString() };
    }
    if (parsed.pathname.includes('/payments')) {
      paymentsCursor = parsed.searchParams.get('cursor');
      return { _embedded: { records: [] } };
    }
    throw new Error(`Unexpected request ${url}`);
  };

  const page = await new HorizonStealthAnnouncementReader({
    network: 'testnet',
    announcerPublicKey: announcer,
    request,
  }).readPage({ cursor: null, lowerBoundCreatedAt: 0, limit: 200 });

  assert.deepEqual(requestedLedgers, []);
  assert.equal(paymentsCursor, (127n << 32n | 0xffffffffn).toString());
  assert.equal(page.nextCursor, paymentsCursor);
  assert.equal(page.latestLedger, latestSequence);
});

test('Horizon reader shrinks an oversized unjoined page and advances only to returned data', async () => {
  const limits = [];
  const returnedToken = (499n << 32n | 9n).toString();
  const request = async url => {
    const parsed = new URL(url);
    if (parsed.pathname === '/ledgers') return latestLedgers;
    if (parsed.pathname.includes('/payments')) {
      assert.equal(parsed.searchParams.has('join'), false);
      const limit = Number(parsed.searchParams.get('limit'));
      limits.push(limit);
      if (limit > 25) {
        throw new HorizonRequestError('Horizon response body exceeded the safe byte limit.', {
          kind: 'response_too_large',
        });
      }
      return {
        _embedded: {
          records: [{
            type: 'payment',
            transaction_hash: 'ef'.repeat(32),
            transaction_successful: true,
            created_at: '2026-08-30T11:59:00Z',
            paging_token: returnedToken,
            from: sender,
            to: announcer,
            asset_type: 'native',
            amount: '1.0000000',
          }],
        },
      };
    }
    throw new Error('Non-announcement records must not trigger transaction lookups');
  };

  const page = await new HorizonStealthAnnouncementReader({
    network: 'testnet',
    announcerPublicKey: announcer,
    request,
  }).readPage({ cursor: '123', lowerBoundCreatedAt: 0, limit: 200 });

  assert.deepEqual(limits, [200, 100, 50, 25]);
  assert.equal(page.nextCursor, returnedToken);
  assert.equal(page.hasMore, false);
});
