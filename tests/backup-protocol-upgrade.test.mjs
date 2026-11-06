import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import test from 'node:test';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import { decryptString, encryptString } from '../src/lib/crypto.ts';
import { derivePrivacySessionRoot, derivePrivateStorageKey } from '@stellarkey/private-balance';
import { commitPrivateBalanceState, createEmptyPrivateBalanceState } from '../src/features/private-balance/runtime/storage.ts';
import { exportPrivateBalanceBackupArchive } from '../src/features/private-balance/runtime/backup.ts';
import { exportVaultBackup, initializeVault, inspectVaultBackup, isUnlocked, lockVault, restoreVaultBackup, unlockVault } from '../src/lib/vault.ts';

class MemoryStorage {
  items = new Map();
  writes = 0;
  get length() { return this.items.size; }
  key(index) { return [...this.items.keys()][index] ?? null; }
  getItem(key) { return this.items.get(key) ?? null; }
  setItem(key, value) { this.writes++; this.items.set(key, String(value)); }
  removeItem(key) { this.writes++; this.items.delete(key); }
}

const password = 'synthetic upgrade fixture password';

// The v1.0.4 backup envelope, vault schema and private-record codec are unchanged.
// Reproduce its Protocol V2 root KDF independently; current code rejects V2.
function previousReleaseRoot(seed, context, publicKey) {
  const salt = createHash('sha512').update('SKSB_ROOT_V1').update(Buffer.concat([
    Buffer.from([0, 2]), ...['networkId', 'realmId', 'poolId'].map(field => Buffer.from(context[field], 'hex')),
    StrKey.decodeEd25519PublicKey(publicKey),
  ])).digest();
  return new Uint8Array(createHmac('sha512', salt).update(seed).digest());
}

async function syntheticBackup(versions) {
  const localStorage = new MemoryStorage();
  globalThis.window = { localStorage };
  lockVault();
  const account = Keypair.random();
  const { account: metadata } = await initializeVault(password, { secret: account.secret() });
  const backup = JSON.parse(await exportVaultBackup(password));
  const payload = JSON.parse(await decryptString(backup.crypto, password));
  const driver = {
    records: new Map(),
    async read(key) { return this.records.get(key) ?? null; },
    async readPrefix(prefix) { return new Map([...this.records].filter(([key]) => key.startsWith(prefix))); },
    async compareAndSet(key, expectedRevision, value) {
      const current = this.records.get(key) ?? null;
      assert.equal(current, null);
      assert.equal(expectedRevision, null);
      this.records.set(key, value);
      return { ok: true, current: value };
    },
  };
  for (const [index, version] of versions.entries()) {
    const context = { networkId: '01'.repeat(32), realmId: '02'.repeat(32), poolId: '03'.repeat(32),
      accountId: metadata.id, deploymentBindingHash: (index + 5).toString(16).padStart(2, '0').repeat(32) };
    const seed = new Uint8Array(StrKey.decodeEd25519SecretSeed(account.secret()));
    const root = version === 2 ? previousReleaseRoot(seed, context, account.publicKey()) : derivePrivacySessionRoot(
      seed, 3, Buffer.from(context.networkId, 'hex'), Buffer.from(context.realmId, 'hex'),
      Buffer.from(context.poolId, 'hex'), StrKey.decodeEd25519PublicKey(account.publicKey()),
    );
    const key = derivePrivateStorageKey(root, Buffer.from(context.deploymentBindingHash, 'hex'));
    try {
      await commitPrivateBalanceState(context, key, createEmptyPrivateBalanceState('07'.repeat(32), 1), null, driver);
    } finally { seed.fill(0); root.fill(0); key.fill(0); }
  }
  if (versions.length) payload.privateBalanceStore = JSON.stringify(await exportPrivateBalanceBackupArchive(driver));
  return { localStorage, backup, payload };
}

for (const [label, versions, tamper] of [
  ['previous-release V2 private records', [2], false],
  ['mixed V2.1 and V2 private records', [3, 2], false],
  ['damaged V2.1 private records', [3], true],
]) {
  test(`upgrade rejects ${label} with recovery guidance and no wallet mutation`, async () => {
    const { localStorage, backup, payload } = await syntheticBackup(versions);
    if (tamper) {
      const archive = JSON.parse(payload.privateBalanceStore);
      const envelope = JSON.parse(archive.records[0].value);
      const ciphertext = Buffer.from(envelope.crypto.ciphertext, 'base64');
      ciphertext[0] ^= 1;
      envelope.crypto.ciphertext = ciphertext.toString('base64');
      archive.records[0].value = JSON.stringify(envelope);
      payload.privateBalanceStore = JSON.stringify(archive);
    }
    backup.crypto = await encryptString(JSON.stringify(payload), password);
    const raw = JSON.stringify(backup);
    // Independent destination wallet: a failed restore must not replace it.
    globalThis.window = { localStorage: new MemoryStorage() };
    lockVault();
    await initializeVault(password, { secret: Keypair.random().secret() });
    const destination = window.localStorage;
    const before = new Map(destination.items);
    const writes = destination.writes;
    let databaseOpens = 0;
    globalThis.indexedDB = { open() { databaseOpens++; throw new Error('Unexpected persistent database access'); } };
    try {
      for (const operation of [inspectVaultBackup, restoreVaultBackup]) {
        await assert.rejects(() => operation(raw, password), error => {
          assert.match(error.message, /Private Payments records.*unsupported protocol|unsupported protocol.*Private Payments records/i);
          assert.match(error.message, /keep.*original backup/i);
          assert.doesNotMatch(error.message, new RegExp(payload.vault.accounts[0].publicKey));
          return true;
        });
        assert.deepEqual(destination.items, before);
        assert.equal(destination.writes, writes);
        assert.equal(databaseOpens, 0, 'staging failure must precede every persistent archive operation');
        assert.equal(isUnlocked(), true, 'preserve the destination wallet session');
        assert.equal(JSON.stringify(backup), raw, 'preserve the original encrypted backup');
      }
      assert.ok(localStorage.items.size > 0);
    } finally { delete globalThis.indexedDB; lockVault(); }
  });
}

test('previous-release public-only backup remains inspectable and restorable', async () => {
  const { backup, payload } = await syntheticBackup([]);
  backup.crypto = await encryptString(JSON.stringify(payload), password);
  const raw = JSON.stringify(backup);
  const info = await inspectVaultBackup(raw, password);
  assert.equal(info.accountCount, 1);
  assert.equal(info.hasPrivateBalanceArchive, false);
  globalThis.window = { localStorage: new MemoryStorage() };
  lockVault();
  const result = await restoreVaultBackup(raw, password);
  assert.equal(result.accountCount, 1);
  assert.equal(isUnlocked(), false);
  await unlockVault(password);
  assert.equal(isUnlocked(), true);
  lockVault();
});
