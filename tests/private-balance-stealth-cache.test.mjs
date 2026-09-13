import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compactStealthDiscoveryPayments,
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

test('cancelled sweep reconciliation cannot return a late cached snapshot', async () => {
  const driver = new MemoryDriver();
  await commitStealthDiscoveryCache(context, key, createEmptyStealthDiscoveryCache(1), null, driver);
  const raw = [...driver.records.values()][0];
  let release;
  driver.read = () => new Promise(resolve => { release = () => resolve(raw); });
  const controller = new AbortController();
  let published = false;
  const settled = reconcileStealthPaymentSweeps(context, key, new Set(), new Set(), driver, 2, { signal: controller.signal })
    .then(() => { published = true; return null; }, error => error);
  controller.abort();
  release();
  const error = await settled;
  assert.equal(published, false);
  assert.equal(error?.name, 'AbortError');
});

test('cancelled sweep reconciliation cannot commit after encryption', async t => {
  const driver = new MemoryDriver();
  await commitStealthDiscoveryCache(context, key, {
    ...createEmptyStealthDiscoveryCache(1), payments: [{
      transactionHash: '06'.repeat(32), pagingToken: '1', ephemeralPublicKey: '07'.repeat(32),
      destinationPublicKey: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', amountStroops: '1',
      ledger: 1, createdAt: 1, status: 'sweeping', sweptTransactionHash: '08'.repeat(32), sweepActionField: '09'.repeat(32),
    }], latestLedger: 1, cursor: '1',
  }, null, driver);
  const before = new Map(driver.records);
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
  t.mock.method(crypto.subtle, 'encrypt', async (...args) => { entered(); await blocked; return encrypt(...args); });
  const controller = new AbortController();
  const settled = reconcileStealthPaymentSweeps(context, key, new Set(['09'.repeat(32)]), new Set(), driver, 2, { signal: controller.signal })
    .then(() => null, error => error);
  await started;
  controller.abort(); release();
  const error = await settled;
  assert.equal(JSON.stringify([...driver.records]) === JSON.stringify([...before]), true, 'encrypted cache remains unchanged');
  assert.equal(error?.name, 'AbortError');
});

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

test('empty stealth cache uses the retained-chain floor and contains no legacy state', () => {
  const now = Date.UTC(2026, 7, 30);
  const state = createEmptyStealthDiscoveryCache(now);
  assert.equal(state.lowerBoundCreatedAt, 0);
  assert.equal(state.cursor, null);
  assert.equal(state.latestLedger, 0);
  assert.deepEqual(state.payments, []);
  assert.equal('legacyCursor' in state, false);
});

test('empty stealth cache rescans retained history after seed-only recovery', () => {
  const now = Date.UTC(2026, 7, 30);
  const walletCreatedAt = Date.UTC(2023, 7, 29, 12);
  const state = createEmptyStealthDiscoveryCache(now, walletCreatedAt);
  assert.equal(
    state.lowerBoundCreatedAt,
    0,
    'seed-only recovery must not inherit the import instant as its discovery floor',
  );
});

test('stealth cache compaction retains every actionable receipt and bounded terminal dedup', () => {
  const payment = (index, status) => ({
    transactionHash: index.toString(16).padStart(64, '0'),
    pagingToken: String(index + 1),
    ephemeralPublicKey: '07'.repeat(32),
    destinationPublicKey: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    amountStroops: '1',
    ledger: 1,
    createdAt: 1,
    status,
  });
  const terminal = Array.from({ length: 10_000 }, (_, index) => payment(index, 'swept'));
  const newest = payment(10_000, 'unspent');
  const compacted = compactStealthDiscoveryPayments([...terminal, newest]);

  assert.equal(compacted.length, 10_000);
  assert.equal(compacted.at(-1), newest);
  assert.equal(compacted.some(entry => entry.transactionHash === terminal[0].transactionHash), false);
  assert.equal(compacted.filter(entry => entry.status === 'unspent').length, 1);

  assert.throws(
    () => compactStealthDiscoveryPayments(
      Array.from({ length: 10_001 }, (_, index) => payment(index, 'unspent')),
    ),
    /10,000 unsettled|move or dismiss/i,
  );
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
