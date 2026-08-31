import assert from 'node:assert/strict';
import test from 'node:test';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import {
  deriveStealthMetaKeys,
  deriveStealthRecipient,
} from '@stellarkey/private-balance';
import { HorizonStealthAnnouncementReader } from '../src/features/private-balance/runtime/stealth-horizon.ts';

const bytes = value => new Uint8Array(32).fill(value);
const announcer = Keypair.fromRawEd25519Seed(bytes(61)).publicKey();
const sender = Keypair.fromRawEd25519Seed(bytes(62)).publicKey();

async function paymentFixture() {
  const keys = deriveStealthMetaKeys(bytes(11), 'testnet');
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
      assert.equal(parsed.searchParams.get('join'), 'transactions');
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
            transaction: {
              successful: true,
              memo_type: 'hash',
              memo: Buffer.from(fixture.ephemeralPublicKey).toString('base64'),
            },
          }],
        },
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
  assert.equal(page.nextCursor, (500n << 32n | 0xffffffffn).toString());
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
  assert.equal(requests.length, 3);
});

test('Horizon reader skips malformed announcer spam but advances its high-water cursor', async () => {
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
            transaction: { successful: true, memo_type: 'text', memo: 'not-an-ephemeral-key' },
          }],
        },
      };
    }
    throw new Error('Operations must not be fetched for an invalid memo');
  };
  const page = await new HorizonStealthAnnouncementReader({
    network: 'testnet',
    announcerPublicKey: announcer,
    request,
  }).readPage({ cursor: '123', lowerBoundCreatedAt: 0, limit: 200 });

  assert.deepEqual(page.announcements, []);
  assert.equal(page.nextCursor, (500n << 32n | 0xffffffffn).toString());
});

test('Horizon reader binary-searches the first ledger inside the one-year window', async () => {
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
  const page = await new HorizonStealthAnnouncementReader({
    network: 'testnet',
    announcerPublicKey: announcer,
    request,
  }).readPage({ cursor: null, lowerBoundCreatedAt: 5_000, limit: 200 });

  assert.ok(requestedLedgers.length <= 4);
  assert.equal(paymentsCursor, (4n << 32n | 0xffffffffn).toString());
  assert.equal(page.nextCursor, (10n << 32n | 0xffffffffn).toString());
  assert.equal(page.latestLedger, 10);
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
  assert.equal(page.nextCursor, (500n << 32n | 0xffffffffn).toString());
  assert.equal(page.latestLedger, latestSequence);
});
