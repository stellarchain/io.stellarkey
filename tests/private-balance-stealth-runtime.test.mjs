import assert from 'node:assert/strict';
import test from 'node:test';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import * as runtime from '../src/features/private-balance/runtime/stealth-runtime.ts';
import * as vault from '../src/lib/vault.ts';
import {
  deriveStealthViewingKeys,
  deriveStealthRecipient,
} from '@stellarkey/private-balance';
import {
  deriveStealthRuntimeIdentity,
  syncStealthRuntime,
} from '../src/features/private-balance/runtime/stealth-runtime.ts';

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
const context = {
  networkId: '01'.repeat(32),
  realmId: '02'.repeat(32),
  poolId: '03'.repeat(32),
  accountId: 'account-1',
  deploymentBindingHash: '04'.repeat(32),
};

async function preparedFixture(t) {
  assert.equal(typeof runtime.prepareStealthRuntimeMaterial, 'function');
  assert.equal(typeof runtime.disposeStealthRuntimeMaterial, 'function');
  const previousWindow = globalThis.window;
  const records = new Map();
  globalThis.window = { localStorage: {
    getItem: key => records.get(key) ?? null,
    setItem: (key, value) => records.set(key, String(value)),
    removeItem: key => records.delete(key),
  } };
  vault.lockVault();
  t.after(() => {
    vault.lockVault();
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  });
  const { account } = await vault.initializeVault('correct horse battery staple', { secret: Keypair.random().secret() });
  return { accountId: account.id, network: 'testnet', deploymentContext: {
    protocolVersion: 1, networkId: context.networkId, realmId: context.realmId,
    poolContractId: StrKey.encodeContract(bytes(3)), deploymentBindingHash: context.deploymentBindingHash,
  } };
}

function observePreparation(t) {
  const roots = [];
  const owned = [];
  const vaultRoots = [];
  const slice = Uint8Array.prototype.slice;
  const fill = Uint8Array.prototype.fill;
  const from = Uint8Array.from;
  let scanCaptured = false;
  const immediateCaller = stack => stack.split('\n').find(line => line.trimStart().startsWith('at ') &&
    !line.includes('private-balance-stealth-runtime.test.mjs') && !line.includes('node:internal/test_runner')) ?? '';
  t.mock.method(Uint8Array.prototype, 'slice', function (...args) {
    const result = slice.apply(this, args);
    const stack = new Error().stack;
    const caller = immediateCaller(stack);
    if (caller.includes('deriveStealthRootKey')) roots.push(result);
    if (caller.includes('/runtime/stealth-runtime.ts:') || caller.includes('deriveStealthViewingKeys')) owned.push(result);
    return result;
  });
  t.mock.method(Uint8Array.prototype, 'fill', function (...args) {
    if (this.length === 64 && immediateCaller(new Error().stack).includes('/src/lib/vault.ts:')) vaultRoots.push(this);
    return fill.apply(this, args);
  });
  t.mock.method(Uint8Array, 'from', function (...args) {
    const stack = new Error().stack;
    // Noble's public-point boundary copies the input scalar before clamping.
    // Retain the application-owned source, not Noble's internal copy.
    if (!scanCaptured && args[0] instanceof Uint8Array && stack.includes('decodeScalar') && stack.includes('deriveStealthViewingKeys')) {
      scanCaptured = true;
      owned.push(args[0]);
    }
    return from.apply(this, args);
  });
  return { roots, owned, vaultRoots };
}

const zero = value => value.every(byte => byte === 0);
const materialArrays = material => [material.storageKey, ...Object.values(material.keys).filter(value => value instanceof Uint8Array)];

test('viewing preparation releases spending roots before the first network page and transfers only narrow material', async t => {
  const input = await preparedFixture(t);
  const observed = observePreparation(t);
  const material = await runtime.prepareStealthRuntimeMaterial(input);
  assert.deepEqual(Object.keys(material).sort(), ['keys', 'storageKey']);
  assert.deepEqual(Object.keys(material.keys).sort(), ['deploymentBindingHash', 'network', 'scanPrivateKey', 'scanPublicKey', 'spendPublicKey']);
  let reads = 0;
  try {
    const result = await syncStealthRuntime({ ...material, context, network: 'testnet', walletCreatedAt: 1,
      announcerPublicKey: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      storageDriver: new MemoryDriver(), createReader: () => ({ async readPage() {
        reads += 1;
        assert.equal(observed.roots.length, 1);
        assert.ok(observed.roots.every(zero), 'owned stealth preparation root is cleared before transport');
        assert.ok(observed.vaultRoots.length > 0 && observed.vaultRoots.every(zero), 'vault root callback settled before transport');
        assert.ok(!zero(material.storageKey) && !zero(material.keys.scanPrivateKey), 'viewing and storage material remains usable');
        return { announcements: [], nextCursor: null, latestLedger: 1, hasMore: false };
      } }) });
    assert.equal(result.cache.payments.length, 0);
    assert.equal(reads, 1);
    assert.ok(materialArrays(material).every(value => !zero(value)), 'runtime does not overwrite borrowed material');
  } finally { runtime.disposeStealthRuntimeMaterial(material); }
  assert.ok(materialArrays(material).every(zero), 'one outer owner clears all prepared buffers after draining');
});

test('viewing preparation clears partial owned results if revoked after the vault callback settles', async t => {
  const input = await preparedFixture(t);
  const observed = observePreparation(t);
  const failure = new DOMException('Synthetic preparation revocation', 'AbortError');
  await assert.rejects(runtime.prepareStealthRuntimeMaterial({ ...input, assertActive() {
    if (observed.vaultRoots.length) throw failure;
  } }), error => error === failure);
  assert.equal(observed.roots.length, 1);
  assert.ok(observed.owned.length >= 3);
  assert.ok(observed.roots.every(zero) && observed.owned.every(zero), 'unreturned viewing/storage/root buffers are cleared');
});

for (const mode of ['rejected transport', 'lock before transport']) {
  test(`owned viewing material is disposable after ${mode} without starting stale work`, async t => {
    const input = await preparedFixture(t);
    const assertActive = vault.createSessionRevocationGuard();
    const material = await runtime.prepareStealthRuntimeMaterial({ ...input, assertActive });
    let reads = 0;
    if (mode === 'lock before transport') vault.lockVault();
    try {
      await assert.rejects(syncStealthRuntime({ ...material, context, network: 'testnet', walletCreatedAt: 1,
        assertActive, announcerPublicKey: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        storageDriver: new MemoryDriver(), createReader: () => ({ async readPage() {
          reads += 1;
          throw new Error('Synthetic transport failure');
        } }) }));
    } finally { runtime.disposeStealthRuntimeMaterial(material); }
    assert.equal(reads, mode === 'lock before transport' ? 0 : 1);
    assert.ok(materialArrays(material).every(zero));
  });
}

for (const mismatch of ['network', 'deployment']) {
  test(`viewing runtime rejects mismatched ${mismatch} before identity or transport`, async () => {
    const keys = deriveStealthViewingKeys(bytes(11), 'testnet', bytes(4));
    let reads = 0;
    let identities = 0;
    const storageKey = bytes(12);
    try {
      await assert.rejects(syncStealthRuntime({ keys, storageKey,
        context: mismatch === 'deployment' ? { ...context, deploymentBindingHash: '05'.repeat(32) } : context,
        network: mismatch === 'network' ? 'mainnet' : 'testnet', walletCreatedAt: 1,
        announcerPublicKey: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        onIdentity() { identities += 1; }, createReader() { reads += 1; throw new Error('Unexpected transport'); },
      }), /network|deployment/i);
      assert.equal(reads, 0); assert.equal(identities, 0);
      assert.ok(!zero(keys.scanPrivateKey) && !zero(storageKey), 'invalid input does not overwrite borrowed buffers');
    } finally { runtime.disposeStealthRuntimeMaterial({ keys, storageKey }); }
  });
}

test('stealth runtime publishes its reusable identity before incremental discovery finishes', async () => {
  const rootKey = bytes(11);
  const storageKey = bytes(12);
  const recipient = await deriveStealthRecipient(
    deriveStealthViewingKeys(rootKey, 'testnet', bytes(4)),
    bytes(13),
    'testnet',
    'portable',
  );
  const order = [];
  let releasePage;
  const pageReady = new Promise(resolve => { releasePage = resolve; });
  let markReadStarted;
  const readStarted = new Promise(resolve => { markReadStarted = resolve; });
  let discoveryInput = null;
  const run = syncStealthRuntime({
    keys: deriveStealthViewingKeys(rootKey, 'testnet', bytes(4)),
    storageKey,
    context,
    network: 'testnet',
    announcerPublicKey: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    storageDriver: new MemoryDriver(),
    implementation: 'portable',
    walletCreatedAt: 1,
    createReader: () => ({
      async readPage(input) {
        discoveryInput = input;
        order.push('read');
        markReadStarted();
        await pageReady;
        return {
          announcements: [{
            pagingToken: '4294967297',
            transactionHash: '05'.repeat(32),
            ephemeralPublicKey: recipient.ephemeralPublicKey,
            destinationPublicKey: recipient.publicKey,
            amountStroops: '25000000',
            ledger: 1,
            createdAt: 1,
          }],
          nextCursor: '4294967297',
          latestLedger: 1,
          hasMore: false,
        };
      },
    }),
    now: () => 2,
    onIdentity(address) {
      order.push('identity');
      assert.match(address, /^tsm1/u);
    },
  });
  await readStarted;
  assert.deepEqual(order, ['identity', 'read']);
  releasePage();
  const result = await run;
  assert.equal(discoveryInput.lowerBoundCreatedAt, 0);
  assert.equal(result.cache.payments.length, 1);
  assert.equal(result.cache.payments[0].amountStroops, '25000000');
  assert.equal(
    result.metaAddress,
    deriveStealthRuntimeIdentity(rootKey, 'testnet', bytes(4)).metaAddress,
  );
});

test('stealth runtime rejects mismatched meta-key networks', () => {
  assert.match(
    deriveStealthRuntimeIdentity(bytes(21), 'mainnet', bytes(4)).metaAddress,
    /^ssm1/u,
  );
});
