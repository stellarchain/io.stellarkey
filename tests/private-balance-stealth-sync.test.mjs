import assert from 'node:assert/strict';
import test from 'node:test';
import { StrKey } from '@stellar/stellar-sdk';
import {
  deriveStealthViewingKeys,
  deriveStealthRecipient,
} from '@stellarkey/private-balance';
import { loadStealthDiscoveryCache, createEmptyStealthDiscoveryCache, commitStealthDiscoveryCache } from '../src/features/private-balance/runtime/stealth-cache.ts';
import { syncStealthAnnouncements } from '../src/features/private-balance/runtime/stealth-sync.ts';

class MemoryDriver {
  records = new Map();
  async read(key) { return this.records.get(key) ?? null; }
  async compareAndSet(key, expectedRevision, value) {
    const current = this.records.get(key) ?? null;
    const revision = current === null ? null : JSON.parse(current).revision;
    if (revision !== expectedRevision) return { ok: false, current };
    this.records.set(key, value);
    return { ok: true, current: value };
  }
  async removePrefix(prefix) {
    for (const key of this.records.keys()) if (key.startsWith(prefix)) this.records.delete(key);
  }
}

const bytes = value => new Uint8Array(32).fill(value);
const hex = value => Buffer.from(value).toString('hex');
const context = {
  networkId: '01'.repeat(32),
  realmId: '02'.repeat(32),
  poolId: '03'.repeat(32),
  accountId: 'account-1',
  deploymentBindingHash: '04'.repeat(32),
};
const storageKey = bytes(5);

test('legacy birthday cache resumes its cursor without rejecting older retained announcements', async () => {
  const driver = new MemoryDriver();
  const data = await fixture();
  await commitStealthDiscoveryCache(context, storageKey, {
    ...createEmptyStealthDiscoveryCache(2_000), lowerBoundCreatedAt: 2_000,
  }, null, driver);
  const state = await syncStealthAnnouncements({
    context, storageKey, keys: data.keys, network: 'testnet', storageDriver: driver,
    implementation: 'portable', now: () => 3_000,
    reader: { async readPage(input) {
      assert.equal(input.lowerBoundCreatedAt, 0);
      assert.equal(input.cursor, null);
      return { announcements: [data.firstOwned], nextCursor: data.firstOwned.pagingToken,
        latestLedger: 100, hasMore: false };
    } },
  });
  assert.equal(state.lowerBoundCreatedAt, 0);
  assert.equal(state.payments.length, 1);
});

async function fixture() {
  const keys = deriveStealthViewingKeys(bytes(11), 'testnet', bytes(4));
  const owned = await deriveStealthRecipient(keys, bytes(21), 'testnet', 'portable');
  const second = await deriveStealthRecipient(keys, bytes(22), 'testnet', 'portable');
  const foreignKeys = deriveStealthViewingKeys(bytes(12), 'testnet', bytes(4));
  const foreign = await deriveStealthRecipient(foreignKeys, bytes(23), 'testnet', 'portable');
  const announcement = (token, transactionByte, payment, amount, ledger, createdAt) => ({
    pagingToken: token,
    transactionHash: transactionByte.toString(16).padStart(2, '0').repeat(32),
    ephemeralPublicKey: payment.ephemeralPublicKey,
    destinationPublicKey: payment.publicKey,
    amountStroops: amount,
    ledger,
    createdAt,
  });
  return {
    keys,
    firstOwned: announcement('4294967297', 31, owned, '10000000', 100, 1_500),
    foreign: announcement('8589934593', 32, foreign, '20000000', 101, 1_600),
    secondOwned: announcement('12884901889', 33, second, '30000000', 102, 1_700),
  };
}

test('stealth sync checkpoints pages, filters ownership, and resumes from its cursor', async () => {
  const driver = new MemoryDriver();
  const data = await fixture();
  const calls = [];
  const pages = [
    {
      announcements: [data.firstOwned, data.foreign],
      nextCursor: data.foreign.pagingToken,
      latestLedger: 101,
      hasMore: true,
    },
    {
      announcements: [data.secondOwned],
      nextCursor: data.secondOwned.pagingToken,
      latestLedger: 102,
      hasMore: false,
    },
  ];
  const reader = {
    async readPage(input) {
      calls.push(input);
      return pages.shift() ?? {
        announcements: [],
        nextCursor: input.cursor,
        latestLedger: 102,
        hasMore: false,
      };
    },
  };

  const state = await syncStealthAnnouncements({
    context,
    storageKey,
    keys: data.keys,
    network: 'testnet',
    reader,
    storageDriver: driver,
    implementation: 'portable',
    now: () => 2_000,
    lowerBoundCreatedAt: 1_000,
  });

  assert.equal(calls[0].cursor, null);
  assert.equal(calls[0].lowerBoundCreatedAt, 0);
  assert.equal(calls[1].cursor, data.foreign.pagingToken);
  assert.equal(state.cursor, data.secondOwned.pagingToken);
  assert.equal(state.latestLedger, 102);
  assert.equal(state.revision, 1);
  assert.deepEqual(state.payments.map(payment => ({
    transactionHash: payment.transactionHash,
    destinationPublicKey: payment.destinationPublicKey,
    amountStroops: payment.amountStroops,
  })), [data.firstOwned, data.secondOwned].map(item => ({
    transactionHash: item.transactionHash,
    destinationPublicKey: StrKey.encodeEd25519PublicKey(item.destinationPublicKey),
    amountStroops: item.amountStroops,
  })));
  assert.deepEqual(state.payments.map(payment => payment.ephemeralPublicKey), [
    hex(data.firstOwned.ephemeralPublicKey),
    hex(data.secondOwned.ephemeralPublicKey),
  ]);

  const resumedCalls = [];
  const resumed = await syncStealthAnnouncements({
    context,
    storageKey,
    keys: data.keys,
    network: 'testnet',
    reader: {
      async readPage(input) {
        resumedCalls.push(input);
        return {
          announcements: [],
          nextCursor: input.cursor,
          latestLedger: 103,
          hasMore: false,
        };
      },
    },
    storageDriver: driver,
    implementation: 'portable',
    now: () => 3_000,
  });
  assert.equal(resumedCalls[0].cursor, data.secondOwned.pagingToken);
  assert.equal(resumed.payments.length, 2);
  assert.equal(resumed.latestLedger, 103);
});

test('stealth sync resumes after a later page fails', async () => {
  const driver = new MemoryDriver();
  const data = await fixture();
  let calls = 0;
  await assert.rejects(
    syncStealthAnnouncements({
      context,
      storageKey,
      keys: data.keys,
      network: 'testnet',
      reader: {
        async readPage() {
          calls += 1;
          if (calls === 2) throw new Error('Horizon unavailable');
          return {
            announcements: [data.firstOwned],
            nextCursor: data.firstOwned.pagingToken,
            latestLedger: 100,
            hasMore: true,
          };
        },
      },
      storageDriver: driver,
      implementation: 'portable',
      now: () => 2_000,
    }),
    /Horizon unavailable/i,
  );

  const checkpoint = await loadStealthDiscoveryCache(context, storageKey, driver);
  assert.equal(checkpoint.cursor, data.firstOwned.pagingToken);
  assert.equal(checkpoint.payments.length, 1);
  assert.equal(checkpoint.revision, 0);
});

test('viewing-only matching skips malformed spam and deduplicates owned receipts across pages', async () => {
  const driver = new MemoryDriver();
  const data = await fixture();
  assert.deepEqual(Object.keys(data.keys).sort(), ['deploymentBindingHash', 'network', 'scanPrivateKey', 'scanPublicKey', 'spendPublicKey']);
  let reads = 0;
  const duplicateToken = (BigInt(data.secondOwned.pagingToken) + 1n).toString();
  const result = await syncStealthAnnouncements({ context, storageKey, keys: data.keys,
    network: 'testnet', storageDriver: driver, implementation: 'portable', now: () => 2_000,
    reader: { async readPage() { reads += 1; return reads === 1 ? {
      announcements: [{ ...data.firstOwned, ephemeralPublicKey: new Uint8Array(32) }, data.secondOwned],
      nextCursor: data.secondOwned.pagingToken, latestLedger: 102, hasMore: true,
    } : { announcements: [{ ...data.secondOwned, pagingToken: duplicateToken }],
      nextCursor: duplicateToken, latestLedger: 103, hasMore: false }; } },
  });
  assert.equal(result.payments.length, 1);
  assert.equal(result.payments[0].pagingToken, data.secondOwned.pagingToken);
  assert.equal(result.cursor, duplicateToken);
  assert.equal(reads, 2);
  assert.equal(result.revision, 1);
});

test('viewing-only discovery refuses repeated pages without replacing its authenticated checkpoint', async () => {
  const driver = new MemoryDriver();
  const data = await fixture();
  let reads = 0;
  await assert.rejects(syncStealthAnnouncements({ context, storageKey, keys: data.keys,
    network: 'testnet', storageDriver: driver, implementation: 'portable', now: () => 2_000,
    reader: { async readPage() { reads += 1; return {
      announcements: [data.firstOwned], nextCursor: data.firstOwned.pagingToken,
      latestLedger: 100, hasMore: true,
    }; } },
  }), /not strictly ordered/i);
  assert.equal(reads, 2);
  const checkpoint = await loadStealthDiscoveryCache(context, storageKey, driver);
  assert.equal(checkpoint.revision, 0);
  assert.equal(checkpoint.payments.length, 1);
  assert.equal(checkpoint.cursor, data.firstOwned.pagingToken);
});
