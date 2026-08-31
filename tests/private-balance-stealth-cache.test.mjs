import assert from 'node:assert/strict';
import test from 'node:test';
import {
  commitStealthDiscoveryCache,
  createEmptyStealthDiscoveryCache,
  loadStealthDiscoveryCache,
  markStealthPaymentSweeping,
  reconcileStealthPaymentSweeps,
  stealthDiscoveryRecordKey,
} from '../src/features/private-balance/runtime/stealth-cache.ts';

class MemoryDriver {
  records = new Map();

  async read(key) {
    return this.records.get(key) ?? null;
  }

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

const context = {
  networkId: '01'.repeat(32),
  realmId: '02'.repeat(32),
  poolId: '03'.repeat(32),
  accountId: 'account-1',
  deploymentBindingHash: '04'.repeat(32),
};
const key = new Uint8Array(32).fill(5);

test('stealth discovery cache is encrypted and round-trips verified owned payments', async () => {
  const driver = new MemoryDriver();
  const state = {
    ...createEmptyStealthDiscoveryCache(1_000),
    cursor: '4294967297',
    latestLedger: 100,
    updatedAt: 2_000,
    payments: [{
      transactionHash: '06'.repeat(32),
      pagingToken: '4294967297',
      ephemeralPublicKey: '07'.repeat(32),
      destinationPublicKey: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      amountStroops: '10000000',
      ledger: 100,
      createdAt: 1_500,
      status: 'unspent',
    }],
  };

  await commitStealthDiscoveryCache(context, key, state, null, driver);
  const raw = [...driver.records.values()].join('');
  assert.doesNotMatch(raw, /4294967297|GAAAA|10000000|060606/i);
  assert.match([...driver.records.keys()][0], /^private:cache:v1:/u);

  assert.deepEqual(await loadStealthDiscoveryCache(context, key, driver), state);
});

test('stealth discovery cache authenticates context, ciphertext, and revisions', async () => {
  const driver = new MemoryDriver();
  const initial = createEmptyStealthDiscoveryCache(1_000);
  await commitStealthDiscoveryCache(context, key, initial, null, driver);

  await assert.rejects(
    commitStealthDiscoveryCache(context, key, initial, null, driver),
    /another wallet session/i,
  );
  await assert.rejects(
    loadStealthDiscoveryCache(context, new Uint8Array(32).fill(9), driver),
    /decrypt|authenticate/i,
  );

  const recordKey = stealthDiscoveryRecordKey(context);
  const envelope = JSON.parse(driver.records.get(recordKey));
  envelope.crypto.ciphertext = `${envelope.crypto.ciphertext.slice(0, -2)}AA`;
  driver.records.set(recordKey, JSON.stringify(envelope));
  await assert.rejects(
    loadStealthDiscoveryCache(context, key, driver),
    /decrypt|authenticate/i,
  );
});

test('empty stealth cache uses a one-year lower bound and contains no legacy state', () => {
  const now = Date.UTC(2026, 7, 30);
  const state = createEmptyStealthDiscoveryCache(now);
  assert.equal(state.lowerBoundCreatedAt, Date.UTC(2025, 7, 30));
  assert.equal(state.cursor, null);
  assert.equal(state.latestLedger, 0);
  assert.deepEqual(state.payments, []);
  assert.equal('legacyCursor' in state, false);
});

test('empty stealth cache uses the wallet birthday when it is newer than the recovery floor', () => {
  const now = Date.UTC(2026, 7, 30);
  const walletCreatedAt = Date.UTC(2026, 7, 29, 12);
  const state = createEmptyStealthDiscoveryCache(now, walletCreatedAt);
  assert.equal(state.lowerBoundCreatedAt, walletCreatedAt);
});

test('stealth sweep journal advances only from signed intent to canonical action', async () => {
  const driver = new MemoryDriver();
  const payment = {
    transactionHash: '06'.repeat(32),
    pagingToken: '4294967297',
    ephemeralPublicKey: '07'.repeat(32),
    destinationPublicKey: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    amountStroops: '10000000',
    ledger: 100,
    createdAt: 1_500,
    status: 'unspent',
  };
  await commitStealthDiscoveryCache(context, key, {
    ...createEmptyStealthDiscoveryCache(1_000),
    cursor: payment.pagingToken,
    latestLedger: payment.ledger,
    updatedAt: 2_000,
    payments: [payment],
  }, null, driver);

  const sweep = {
    transactionHash: '08'.repeat(32),
    actionField: '09'.repeat(32),
  };
  let state = await markStealthPaymentSweeping(
    context,
    key,
    payment,
    sweep,
    driver,
    2_100,
  );
  assert.equal(state.payments[0].status, 'sweeping');
  assert.equal(state.payments[0].sweptTransactionHash, sweep.transactionHash);
  assert.equal(state.payments[0].sweepActionField, sweep.actionField);

  state = await reconcileStealthPaymentSweeps(
    context,
    key,
    new Set(),
    new Set([sweep.actionField]),
    driver,
    2_200,
  );
  assert.equal(state.payments[0].status, 'sweeping');

  state = await reconcileStealthPaymentSweeps(
    context,
    key,
    new Set([sweep.actionField]),
    new Set(),
    driver,
    2_300,
  );
  assert.equal(state.payments[0].status, 'swept');
});

test('stealth sweep journal safely releases a non-canonical action after recovery', async () => {
  const driver = new MemoryDriver();
  const payment = {
    transactionHash: '16'.repeat(32),
    pagingToken: '4294967298',
    ephemeralPublicKey: '17'.repeat(32),
    destinationPublicKey: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    amountStroops: '20000000',
    ledger: 101,
    createdAt: 1_600,
    status: 'unspent',
  };
  await commitStealthDiscoveryCache(context, key, {
    ...createEmptyStealthDiscoveryCache(1_000),
    cursor: payment.pagingToken,
    latestLedger: payment.ledger,
    updatedAt: 2_000,
    payments: [payment],
  }, null, driver);
  await markStealthPaymentSweeping(context, key, payment, {
    transactionHash: '18'.repeat(32),
    actionField: '19'.repeat(32),
  }, driver, 2_100);

  const state = await reconcileStealthPaymentSweeps(
    context,
    key,
    new Set(),
    new Set(),
    driver,
    2_200,
  );
  assert.equal(state.payments[0].status, 'unspent');
  assert.equal(state.payments[0].sweptTransactionHash, undefined);
  assert.equal(state.payments[0].sweepActionField, undefined);
});
