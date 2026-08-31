import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import { derivePrivacySessionRoot } from '@stellarkey/private-balance';
import {
  initializeVault,
  lockVault,
  withPrivacySessionRoot,
} from '../src/lib/vault.ts';

class MemoryStorage {
  #items = new Map();
  getItem(key) { return this.#items.get(key) ?? null; }
  setItem(key, value) { this.#items.set(key, String(value)); }
  removeItem(key) { this.#items.delete(key); }
}

const context = {
  protocolVersion: 1,
  networkId: 'cee0302d59844d32bdca915c8203dd44b33fbb7edc19051ea37abedf28ecd472',
  realmId: '0202020202020202020202020202020202020202020202020202020202020202',
  poolContractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAITA4',
  deploymentBindingHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
};

test('vault: withPrivacySessionRoot rejects when vault is locked or account missing', async () => {
  await assert.rejects(
    async () => {
      await withPrivacySessionRoot('non-existent-id', context, (root) => {
        return root.length;
      });
    },
    (err) => {
      return err.name === 'VaultLockedError' || err.message === 'Vault is locked' || err.message === 'No vault found';
    }
  );
});

test('vault: exports only the exact V1 session root and zeroes it after use', async () => {
  const localStorage = new MemoryStorage();
  globalThis.window = { localStorage };
  lockVault();
  const source = Keypair.random();
  const { account } = await initializeVault('correct horse battery staple', {
    secret: source.secret(),
  });
  const hex = (value) => Uint8Array.from(value.match(/../g), (byte) => Number.parseInt(byte, 16));
  const expected = derivePrivacySessionRoot(
    StrKey.decodeEd25519SecretSeed(source.secret()),
    context.protocolVersion,
    hex(context.networkId),
    hex(context.realmId),
    StrKey.decodeContract(context.poolContractId),
    StrKey.decodeEd25519PublicKey(source.publicKey()),
  );
  let callbackRoot;
  let callbackStorageKey;

  await withPrivacySessionRoot(account.id, context, async (root, storageKey) => {
    callbackRoot = root;
    callbackStorageKey = storageKey;
    assert.equal(root.length, 64);
    assert.equal(storageKey.length, 32);
    assert.deepEqual(root, expected);
  });

  assert.ok(callbackRoot.every((byte) => byte === 0));
  assert.ok(callbackStorageKey.every((byte) => byte === 0));
  expected.fill(0);
  lockVault();
});

test('vault: successful session-root ownership transfer may detach the callback view', async () => {
  const localStorage = new MemoryStorage();
  globalThis.window = { localStorage };
  lockVault();
  const { account } = await initializeVault('correct horse battery staple', {
    secret: Keypair.random().secret(),
  });
  let callbackRoot;

  await withPrivacySessionRoot(account.id, context, async (root) => {
    callbackRoot = root;
    structuredClone(root.buffer, { transfer: [root.buffer] });
    assert.equal(root.byteLength, 0);
  });

  assert.equal(callbackRoot.byteLength, 0);
  lockVault();
});
