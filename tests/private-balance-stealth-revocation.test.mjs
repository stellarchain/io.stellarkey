import assert from 'node:assert/strict';
import test from 'node:test';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import { deriveStealthViewingKeys } from '@stellarkey/private-balance';
import * as vault from '../src/lib/vault.ts';
import { prepareStealthRuntimeMaterial, disposeStealthRuntimeMaterial, syncStealthRuntime } from '../src/features/private-balance/runtime/stealth-runtime.ts';
import { syncStealthAnnouncements } from '../src/features/private-balance/runtime/stealth-sync.ts';
import {
  clearStealthDiscoveryCache, commitStealthDiscoveryCache, createEmptyStealthDiscoveryCache,
} from '../src/features/private-balance/runtime/stealth-cache.ts';
import * as coordination from '../src/features/private-balance/runtime/coordination.ts';

const discovery = await import('../src/features/private-balance/runtime/stealth-discovery-operation.ts')
  .catch(error => { if (error.code === 'ERR_MODULE_NOT_FOUND') return {}; throw error; });

const bytes = value => new Uint8Array(32).fill(value);
const context = {
  networkId: '01'.repeat(32), realmId: '02'.repeat(32), poolId: '03'.repeat(32),
  accountId: 'synthetic-discovery', deploymentBindingHash: '04'.repeat(32),
};
const vaultContext = {
  protocolVersion: 2, networkId: context.networkId, realmId: context.realmId,
  poolContractId: StrKey.encodeContract(bytes(3)), deploymentBindingHash: context.deploymentBindingHash,
};
const password = 'correct horse battery staple';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

class MemoryDriver {
  records = new Map();
  writes = 0;
  async read(key) { return this.records.get(key) ?? null; }
  async compareAndSet(key, expectedRevision, value) {
    const current = this.records.get(key) ?? null;
    if ((current === null ? null : JSON.parse(current).revision) !== expectedRevision) {
      return { ok: false, current };
    }
    this.writes += 1;
    this.records.set(key, value);
    return { ok: true, current: value };
  }
  async removePrefix(prefix) {
    for (const key of this.records.keys()) if (key.startsWith(prefix)) this.records.delete(key);
  }
}

async function unlockedFixture(t) {
  const previousWindow = globalThis.window;
  globalThis.window = { localStorage: new MemoryStorage() };
  vault.lockVault();
  t.after(() => {
    vault.lockVault();
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  });
  return vault.initializeVault(password, { secret: Keypair.random().secret() });
}

function announcement(index = 1) {
  return {
    pagingToken: String(index), transactionHash: '05'.repeat(32),
    ephemeralPublicKey: bytes(9), destinationPublicKey: bytes(7),
    amountStroops: '1', ledger: 1, createdAt: 1,
  };
}

const emptyPage = { announcements: [], nextCursor: '1', latestLedger: 1, hasMore: false };

test('revocation during discovery encryption prevents a fresh-null cache commit', async t => {
  const driver = new MemoryDriver();
  const controller = new AbortController();
  const entered = deferred();
  const release = deferred();
  const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
  t.mock.method(crypto.subtle, 'encrypt', async (...args) => {
    entered.resolve();
    await release.promise;
    return encrypt(...args);
  });
  const run = commitStealthDiscoveryCache(context, bytes(12), createEmptyStealthDiscoveryCache(1), null, driver, {
    signal: controller.signal,
  });
  const settled = run.then(() => null, error => error);
  await entered.promise;
  controller.abort();
  await clearStealthDiscoveryCache(context, driver);
  release.resolve();
  const error = await settled;
  assert.equal(driver.writes, 0, 'cancelled encryption cannot recreate removed cache');
  assert.equal(driver.records.size, 0);
  assert.equal(error?.name, 'AbortError');
});

test('discovery cache propagates authority to a delayed compare-and-set', async () => {
  const entered = deferred();
  const release = deferred();
  const controller = new AbortController();
  const driver = new MemoryDriver();
  const compare = driver.compareAndSet.bind(driver);
  driver.compareAndSet = async (key, revision, value, guard) => {
    entered.resolve();
    await release.promise;
    guard?.signal?.throwIfAborted();
    guard?.assertActive?.();
    return compare(key, revision, value);
  };
  const run = commitStealthDiscoveryCache(context, bytes(12), createEmptyStealthDiscoveryCache(1), null, driver, {
    signal: controller.signal,
  });
  const settled = run.then(() => null, error => error);
  await entered.promise;
  controller.abort();
  release.resolve();
  const error = await settled;
  assert.equal(driver.writes, 0);
  assert.equal(error?.name, 'AbortError');
});

function runtimeInput(driver, createReader) {
  return {
    keys: deriveStealthViewingKeys(bytes(11), 'testnet', bytes(4)), storageKey: bytes(12), context, network: 'testnet',
    walletCreatedAt: 0, announcerPublicKey: StrKey.encodeEd25519PublicKey(bytes(13)),
    storageDriver: driver, implementation: 'portable', now: () => 2, createReader,
  };
}

test('locked discovery rejects a late page without another read or encrypted write', async t => {
  const { account } = await unlockedFixture(t);
  const assertActive = vault.createSessionRevocationGuard();
  const driver = new MemoryDriver();
  const started = deferred();
  const release = deferred();
  let reads = 0;
  let publications = 0;
  const material = await prepareStealthRuntimeMaterial({ accountId: account.id,
    deploymentContext: vaultContext, network: 'testnet', assertActive });
  const ownedScanKey = material.keys.scanPrivateKey;
  const ownedStorageKey = material.storageKey;
  const run = (async () => {
    try {
      return await syncStealthRuntime({
        ...runtimeInput(driver, () => ({
          async readPage() {
            reads += 1;
            if (reads > 1) return emptyPage;
            started.resolve();
            await release.promise; // Deliberately ignores transport abort.
            return { ...emptyPage, announcements: [announcement()], hasMore: true };
          },
        })),
        ...material, assertActive,
      });
    } finally { disposeStealthRuntimeMaterial(material); }
  })().then(() => { publications += 1; return null; }, error => error);
  await started.promise;
  vault.lockVault();
  release.resolve();
  const error = await run;
  assert.equal(reads, 1, 'revoked scan must not request a second page');
  assert.equal(driver.writes, 0, 'revoked scan must not commit its late page');
  assert.equal(publications, 0, 'revoked result must not become usable');
  assert.equal(error?.name, 'VaultLockedError');
  assert.ok(ownedScanKey.every(byte => byte === 0));
  assert.ok(ownedStorageKey.every(byte => byte === 0));
});

test('revoked late page cannot recreate a cleared fresh discovery cache', async t => {
  await unlockedFixture(t);
  const assertActive = vault.createSessionRevocationGuard();
  const driver = new MemoryDriver();
  const started = deferred();
  const release = deferred();
  const run = syncStealthRuntime({
    ...runtimeInput(driver, () => ({
      async readPage() { started.resolve(); await release.promise; return emptyPage; },
    })),
    assertActive,
  }).then(() => null, error => error);
  await started.promise;
  vault.lockVault();
  await clearStealthDiscoveryCache(context, driver);
  release.resolve();
  const error = await run;
  assert.equal(driver.records.size, 0, 'late fresh-cache CAS must not resurrect removed data');
  assert.equal(driver.writes, 0);
  assert.equal(error?.name, 'VaultLockedError');
});

test('pre-aborted runtime does not publish identity or start cache and network reads', async () => {
  const controller = new AbortController();
  controller.abort();
  let identities = 0;
  let cacheReads = 0;
  let networkReads = 0;
  const driver = new MemoryDriver();
  driver.read = async () => { cacheReads += 1; return null; };
  const error = await syncStealthRuntime({
    ...runtimeInput(driver, () => ({ async readPage() { networkReads += 1; return emptyPage; } })),
    signal: controller.signal, onIdentity: () => { identities += 1; },
  }).then(() => null, failure => failure);
  assert.equal(identities, 0);
  assert.equal(cacheReads, 0);
  assert.equal(networkReads, 0);
  assert.equal(error?.name, 'AbortError');
});

test('revocation during an uncooperative cache read prevents the first network request', async () => {
  const controller = new AbortController();
  const started = deferred();
  const release = deferred();
  const driver = new MemoryDriver();
  driver.read = async () => { started.resolve(); await release.promise; return null; };
  let reads = 0;
  const run = syncStealthRuntime({
    ...runtimeInput(driver, () => ({ async readPage() { reads += 1; return emptyPage; } })),
    signal: controller.signal,
  }).then(() => null, failure => failure);
  await started.promise;
  controller.abort();
  release.resolve();
  const error = await run;
  assert.equal(reads, 0);
  assert.equal(driver.writes, 0);
  assert.equal(error?.name, 'AbortError');
});

test('a late encrypted cache read cannot start decryption after revocation', async t => {
  const controller = new AbortController();
  const driver = new MemoryDriver();
  await commitStealthDiscoveryCache(context, bytes(12), createEmptyStealthDiscoveryCache(1), null, driver);
  const read = driver.read.bind(driver);
  const started = deferred();
  const release = deferred();
  driver.read = async key => { started.resolve(); await release.promise; return read(key); };
  let decryptionsAfterAbort = 0;
  const decrypt = globalThis.crypto.subtle.decrypt.bind(globalThis.crypto.subtle);
  t.mock.method(globalThis.crypto.subtle, 'decrypt', (...args) => {
    if (controller.signal.aborted) decryptionsAfterAbort += 1;
    return decrypt(...args);
  });
  const run = syncStealthRuntime({
    ...runtimeInput(driver, () => ({ async readPage() { assert.fail('revoked cache must not start a page'); } })),
    signal: controller.signal,
  }).then(() => null, error => error);
  await started.promise;
  controller.abort();
  release.resolve();
  const error = await run;
  assert.equal(decryptionsAfterAbort, 0, 'late storage result must not start decryption');
  assert.equal(error?.name, 'AbortError');
});

for (const invalid of [false, true]) {
  test(`revocation during ${invalid ? 'invalid' : 'valid'} ownership derivation is not swallowed`, async () => {
    const controller = new AbortController();
    const driver = new MemoryDriver();
    const keys = deriveStealthViewingKeys(bytes(11), 'testnet', bytes(4));
    const originalScanKey = keys.scanPrivateKey;
    let keyReads = 0;
    Object.defineProperty(keys, 'scanPrivateKey', { get() {
      keyReads += 1;
      controller.abort();
      if (invalid) throw new Error('Synthetic malformed key');
      return originalScanKey;
    } });
    let progress = 0;
    try {
      const error = await syncStealthAnnouncements({
        context, storageKey: bytes(12), keys, network: 'testnet', storageDriver: driver,
        signal: controller.signal, implementation: 'portable', now: () => 2,
        onProgress: () => { progress += 1; },
        reader: { async readPage() {
          return { ...emptyPage, nextCursor: '2', announcements: [announcement(1), announcement(2)] };
        } },
      }).then(() => null, failure => failure);
      assert.equal(keyReads, 1, 'a revoked matcher must not start another derivation');
      assert.equal(driver.writes, 0);
      assert.equal(progress, 0);
      assert.equal(error?.name, 'AbortError');
    } finally {
      originalScanKey.fill(0);
      keys.scanPublicKey.fill(0);
      keys.spendPublicKey.fill(0);
      keys.deploymentBindingHash.fill(0);
    }
  });
}

for (const revoke of ['lockVault', 'clearSessionSecrets']) {
  test(`${revoke} notifies the captured session synchronously after secrets are revoked`, async t => {
    await unlockedFixture(t);
    assert.equal(typeof vault.subscribeSessionRevocation, 'function');
    const assertActive = vault.createSessionRevocationGuard();
    let calls = 0;
    let wasLocked = false;
    let authorityRevoked = false;
    vault.subscribeSessionRevocation(() => {
      calls += 1;
      wasLocked = !vault.isUnlocked();
      try { assertActive(); } catch { authorityRevoked = true; }
    });
    vault[revoke]();
    assert.equal(calls, 1, 'notification must not await React or a microtask');
    assert.equal(wasLocked, true);
    assert.equal(authorityRevoked, true);
    vault[revoke]();
    assert.equal(calls, 1, 'a captured generation is revoked only once');
    assert.throws(() => vault.subscribeSessionRevocation(() => {}), { name: 'VaultLockedError' });
  });
}

test('revocation subscriptions dispose cleanly and a throwing observer cannot interrupt lock', async t => {
  await unlockedFixture(t);
  assert.equal(typeof vault.subscribeSessionRevocation, 'function');
  let disposedCalls = 0;
  let liveCalls = 0;
  const dispose = vault.subscribeSessionRevocation(() => { disposedCalls += 1; });
  dispose();
  dispose();
  vault.subscribeSessionRevocation(() => { throw new Error('Synthetic observer failure'); });
  vault.subscribeSessionRevocation(() => { liveCalls += 1; });
  assert.doesNotThrow(() => vault.lockVault());
  assert.equal(vault.isUnlocked(), false);
  assert.equal(disposedCalls, 0);
  assert.equal(liveCalls, 1);
});

test('establishing a replacement vault session revokes the previous subscription', async t => {
  await unlockedFixture(t);
  assert.equal(typeof vault.subscribeSessionRevocation, 'function');
  let calls = 0;
  const oldGuard = vault.createSessionRevocationGuard();
  vault.subscribeSessionRevocation(() => { calls += 1; });
  // Replace only the synthetic persisted store, leaving the old in-memory
  // session alive so this exercises establishment rather than lockVault.
  globalThis.window.localStorage = new MemoryStorage();
  await vault.initializeVault(password, { secret: Keypair.random().secret() });
  assert.equal(calls, 1);
  assert.throws(oldGuard, { name: 'VaultLockedError' });
  assert.doesNotThrow(vault.createSessionRevocationGuard());
});

test('lease assertions are read-only, permit owner renewal and fail closed on takeover or invalid state', () => {
  assert.equal(typeof coordination.assertPrivateBalanceLease, 'function');
  const storage = new MemoryStorage();
  const key = coordination.privateBalanceLeaseKey(context);
  const check = () => coordination.assertPrivateBalanceLease(storage, key, 'owner-a', 100);
  assert.throws(check, /lease/i);
  assert.equal(coordination.claimPrivateBalanceLease(storage, key, 'owner-a', 50, 100), true);
  const before = storage.getItem(key);
  assert.doesNotThrow(check);
  assert.equal(storage.getItem(key), before, 'asserting does not renew a lease');
  coordination.claimPrivateBalanceLease(storage, key, 'owner-a', 90, 100);
  assert.doesNotThrow(check);
  coordination.forceClaimPrivateBalanceLease(storage, key, 'owner-b', 90, 100);
  assert.throws(check, /lease/i);
  for (const value of [null, '{', JSON.stringify({ ownerId: 'owner-a', expiresAt: 100 }),
    JSON.stringify({ ownerId: 'owner-a', expiresAt: -1 }), JSON.stringify({ ownerId: 'owner-a', expiresAt: '200' })]) {
    if (value === null) storage.removeItem(key); else storage.setItem(key, value);
    assert.throws(check, /lease/i);
  }
  assert.throws(() => coordination.assertPrivateBalanceLease({ getItem() { throw new Error('denied'); } }, key, 'owner-a', 100), /lease/i);
});

test('a lock during replacement-session revocation cannot be undone by establishment', async t => {
  await unlockedFixture(t);
  assert.equal(typeof vault.subscribeSessionRevocation, 'function');
  vault.subscribeSessionRevocation(() => vault.lockVault());
  globalThis.window.localStorage = new MemoryStorage();
  await assert.rejects(vault.initializeVault(password, { secret: Keypair.random().secret() }), { name: 'VaultLockedError' });
  assert.equal(vault.isUnlocked(), false);
});

test('discovery operation aborts at vault lock but completion drains uncooperative work', async t => {
  await unlockedFixture(t);
  assert.equal(typeof discovery.createStealthDiscoveryOperation, 'function');
  const operation = discovery.createStealthDiscoveryOperation(() => {});
  const started = deferred();
  const release = deferred();
  let finished = false;
  let cleaned = false;
  const completion = operation.completion.then(() => { finished = true; });
  const run = operation.run(async guard => {
    try { guard.assertActive(); started.resolve(); await release.promise; return 7; }
    finally { cleaned = true; }
  }).then(() => null, error => error);
  await started.promise;
  vault.lockVault();
  assert.equal(operation.signal.aborted, true);
  await Promise.resolve();
  assert.equal(finished, false, 'abort does not pretend outstanding work has settled');
  release.resolve();
  assert.equal((await run)?.name, 'AbortError');
  await completion;
  assert.equal(cleaned, true);
});

test('discovery operation never regains invalidated context authority or starts twice', async t => {
  await unlockedFixture(t);
  assert.equal(typeof discovery.createStealthDiscoveryOperation, 'function');
  let current = true;
  const operation = discovery.createStealthDiscoveryOperation(() => {
    if (!current) throw new Error('Synthetic context replaced');
  });
  current = false;
  assert.throws(operation.assertActive, /context/i);
  current = true;
  assert.throws(operation.assertActive, { name: 'AbortError' });
  await assert.rejects(operation.run(async () => assert.fail('revoked work must not start')), { name: 'AbortError' });
  await operation.completion;
  await assert.rejects(operation.run(async () => assert.fail('duplicate work must not start')), /already|once/i);
});

test('completed and pre-start-aborted discovery operations detach their vault subscription', async t => {
  await unlockedFixture(t);
  assert.equal(typeof discovery.createStealthDiscoveryOperation, 'function');
  const completed = discovery.createStealthDiscoveryOperation(() => {});
  assert.equal(await completed.run(async () => 9), 9);
  await completed.completion;
  const cancelled = discovery.createStealthDiscoveryOperation(() => {});
  cancelled.abort();
  await cancelled.completion;
  assert.equal(cancelled.signal.aborted, true);
  let lateAborts = 0;
  completed.signal.addEventListener('abort', () => { lateAborts += 1; });
  vault.lockVault();
  assert.equal(lateAborts, 0, 'completed scope must no longer be subscribed');
  assert.throws(completed.assertActive, { name: 'AbortError' });
});
