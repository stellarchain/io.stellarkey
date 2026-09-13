import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { StrKey } from '@stellar/stellar-sdk';
import {
  computeAssetField, computeCommitment, computeContextField, computeContextHash,
  createOutputPackage, decodePrivateAddress, deriveDiversifiedAddressKeys,
  deriveExpandedSpendingKey, derivePrivateAddressDeploymentTag, encodeNotePlaintext,
  encodePrivateAddress, openRecipientEnvelope,
} from '@stellarkey/private-balance';
import { PrivateBalanceWorkerClient } from '../src/features/private-balance/worker/client.ts';
import { wipePrivateBalanceSpendingKey } from '../src/features/private-balance/worker/key-hygiene.ts';
import {
  commitPrivateBalanceState, createEmptyPrivateBalanceState,
  loadPrivateBalanceState, recordPrivateBalanceAddress,
} from '../src/features/private-balance/runtime/storage.ts';

// Public, non-usable synthetic fixtures only. No network access or wallet import.
const baseManifest = JSON.parse(readFileSync(new URL('../protocol/private-balance/manifests/development.json', import.meta.url), 'utf8'));
const account = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const root = () => new Uint8Array(64).fill(42);
const bytes = value => Uint8Array.from(Buffer.from(value, 'hex'));
let workerSequence = 0;

function networkManifest(mainnet = false) {
  const networkPassphrase = mainnet ? 'Public Global Stellar Network ; September 2015' : baseManifest.networkPassphrase;
  return { ...baseManifest, networkPassphrase, networkId: createHash('sha256').update(networkPassphrase).digest('hex') };
}

async function workerHarness(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'self');
  let lastResponse;
  let sessionId;
  const transport = {
    onmessage: null,
    postMessage(message, transfer = []) {
      sessionId = message.sessionId;
      void scope.onmessage({ data: structuredClone(message, { transfer }) });
    },
    terminate() {},
  };
  const scope = {
    onmessage: null,
    postMessage(message) {
      lastResponse = structuredClone(message);
      transport.onmessage?.({ data: lastResponse });
    },
  };
  Object.defineProperty(globalThis, 'self', { configurable: true, value: scope });
  await import(`../src/features/private-balance/worker/private-balance.worker.ts?address-generation=${workerSequence++}`);
  const client = new PrivateBalanceWorkerClient(transport);
  t.after(async () => {
    if (sessionId) await scope.onmessage({ data: { messageVersion: 1, id: 'cleanup', sessionId, type: 'LOCK' } });
    client.terminate();
    if (previous) Object.defineProperty(globalThis, 'self', previous);
    else Reflect.deleteProperty(globalThis, 'self');
  });
  return {
    client,
    async generateDirectly() {
      await scope.onmessage({ data: { messageVersion: 1, id: 'synthetic-rotation', sessionId, type: 'GENERATE_ADDRESS' } });
      return lastResponse;
    },
  };
}

async function identityFor(t, manifest, diversifier) {
  const contextHash = computeContextHash(2, bytes(manifest.networkId), bytes(manifest.realmId), StrKey.decodeContract(manifest.poolContractId));
  const contextField = computeContextField(contextHash);
  const spendingKey = await deriveExpandedSpendingKey(root(), 2, bytes(manifest.networkId), bytes(manifest.realmId),
    StrKey.decodeContract(manifest.poolContractId), StrKey.decodeEd25519PublicKey(account), contextField);
  const identity = await deriveDiversifiedAddressKeys(spendingKey.baseOwnerCommitment, spendingKey.hpkePrivateKey, diversifier);
  t.after(() => { identity.hpkePrivateKey.fill(0); wipePrivateBalanceSpendingKey(spendingKey); });
  const prefix = manifest.networkPassphrase === 'Public Global Stellar Network ; September 2015' ? 'skpay_' : 'tskpay_';
  return {
    spendingKey, contextHash, contextField, prefix,
    address: encodePrivateAddress({ deploymentTag: derivePrivateAddressDeploymentTag(bytes(manifest.deploymentBindingHash)),
      diversifier, ownerCommitment: identity.ownerCommitment, hpkePublicKey: identity.hpkePublicKey }, prefix),
  };
}

test('initial receive address is freshly diversified on the supported network', async t => {
  const { client } = await workerHarness(t);
  const manifest = networkManifest();
  const identity = await client.initSession(manifest, account, root());
  const prefix = 'tskpay_';
  const decoded = await decodePrivateAddress(identity.address, prefix, bytes(manifest.deploymentBindingHash));
  assert.equal(decoded.diversifier.some(byte => byte !== 0), true, 'initial receive identity must not use the legacy zero diversifier');
  assert.equal((Buffer.from((await decodePrivateAddress(identity.address, prefix)).diversifier).toString('hex')) !== '00000000', true);
});

test('address generation retains the unsupported-network deployment gate', async t => {
  const { client } = await workerHarness(t);
  await assert.rejects(client.initSession(networkManifest(true), account, root()), /testnet only/i);
});

test('explicit address rotation retains issuance history and current-format receipt recovery', async t => {
  const manifest = networkManifest();
  const legacy = await identityFor(t, manifest, Uint8Array.of(1, 2, 3, 4));
  const { client } = await workerHarness(t);
  const records = new Map();
  const driver = {
    async read(key) { return records.get(key) ?? null; },
    async compareAndSet(key, revision, value) {
      const current = records.get(key) ?? null;
      if ((current === null ? null : JSON.parse(current).revision) !== revision) return { ok: false, current };
      records.set(key, value);
      return { ok: true, current: value };
    },
  };
  const context = { networkId: manifest.networkId, realmId: manifest.realmId,
    poolId: Buffer.from(StrKey.decodeContract(manifest.poolContractId)).toString('hex'),
    accountId: 'synthetic-address-generation', deploymentBindingHash: manifest.deploymentBindingHash };
  const storageKey = new Uint8Array(32).fill(7);
  t.after(() => { storageKey.fill(0); records.clear(); });
  const initial = { ...createEmptyPrivateBalanceState('01'.repeat(32), 1), privateAddress: legacy.address, issuedAddressDiversifiers: ['01020304'] };
  await commitPrivateBalanceState(context, storageKey, initial, null, driver);
  const restoredIdentity = await client.initSession(manifest, account, root(), initial.privateAddress);
  assert.equal(restoredIdentity.address === legacy.address, true, 'initialization must preserve the stored identity');
  const replacement = await client.generateAddress();
  assert.equal(replacement.address !== legacy.address, true, 'explicit rotation must produce a fresh address');
  assert.equal((Buffer.from((await decodePrivateAddress(replacement.address, legacy.prefix)).diversifier).toString('hex')) !== '00000000', true);
  const persisted = await recordPrivateBalanceAddress(context, storageKey, initial.revision, replacement.address, driver);
  assert.equal(persisted.issuedAddressDiversifiers.includes('01020304'), true);
  assert.equal(persisted.issuedAddressDiversifiers.length, 2);
  assert.equal((await loadPrivateBalanceState(context, storageKey, driver)).privateAddress === replacement.address, true);
  const restored = await client.initSession(manifest, account, root(), persisted.privateAddress);
  assert.equal(restored.address === replacement.address, true, 'an already compatible address must remain stable');
  await assert.rejects(recordPrivateBalanceAddress(context, storageKey, persisted.revision, legacy.address, driver), /already issued/);

  const assetField = computeAssetField({ kind: 1, payload: StrKey.decodeContract(manifest.assets[0].contractId) });
  for (const address of [legacy.address, replacement.address]) {
    const decoded = await decodePrivateAddress(address, legacy.prefix);
    const rho = new Uint8Array(32).fill(8);
    const note = { protocolVersion: 2, flags: 0, value: 1n, diversifier: decoded.diversifier,
      ownerCommitment: decoded.ownerCommitment, rho, memoLength: 0, memo: new Uint8Array(32), assetIndex: 0, reserved: new Uint8Array(11) };
    const commitment = computeCommitment(legacy.contextField, assetField, decoded.ownerCommitment, note.value, rho);
    const nonce = new Uint8Array(32).fill(9);
    const encrypted = await createOutputPackage(decoded.hpkePublicKey, decoded.diversifier, encodeNotePlaintext(note), legacy.contextHash, commitment, nonce, 0);
    const recovered = await openRecipientEnvelope(legacy.spendingKey.hpkePrivateKey, encrypted.recipientEnvelope,
      legacy.contextHash, legacy.contextField, assetField, commitment, nonce, 0, legacy.spendingKey.baseOwnerCommitment);
    assert.equal(recovered?.value === note.value, true, 'the unchanged root must recover receipts from both issued addresses');
  }
});

test('unsupported default receive identity is rejected instead of automatically upgraded', async t => {
  const manifest = networkManifest();
  const identity = await identityFor(t, manifest, new Uint8Array(4));
  const { client } = await workerHarness(t);
  await assert.rejects(client.initSession(manifest, account, root(), identity.address), /fresh private address/i);
});

test('nonzero stored receive addresses restore exactly without rotation', async t => {
  const manifest = networkManifest();
  const known = await identityFor(t, manifest, Uint8Array.of(1, 2, 3, 4));
  const { client } = await workerHarness(t);
  const result = await client.initSession(manifest, account, root(), known.address);
  assert.equal(result.address === known.address, true);
  assert.equal(Buffer.from((await decodePrivateAddress(result.address, known.prefix)).diversifier).toString('hex'), '01020304');
});

test('rotation retries zero and current diversifiers and clears rejected entropy', async t => {
  const manifest = networkManifest();
  const known = await identityFor(t, manifest, Uint8Array.of(1, 2, 3, 4));
  const { client, generateDirectly } = await workerHarness(t);
  await client.initSession(manifest, account, root(), known.address);
  const samples = [new Uint8Array(4), Uint8Array.of(1, 2, 3, 4), Uint8Array.of(5, 6, 7, 8)];
  const allocated = [];
  let calls = 0;
  const random = t.mock.method(globalThis.crypto, 'getRandomValues', buffer => {
    if (calls >= samples.length) throw new Error('Synthetic entropy exhausted');
    buffer.fill(0);
    buffer.set(samples[calls++]);
    allocated.push(buffer);
    return buffer;
  });
  const response = await generateDirectly();
  random.mock.restore();
  assert.equal(response.type, 'ADDRESS_OK');
  const decoded = await decodePrivateAddress(response.address, known.prefix);
  assert.equal(Buffer.from(decoded.diversifier).toString('hex'), '05060708');
  assert.equal(calls, 3);
  assert.equal(allocated.every(buffer => buffer.every(byte => byte === 0)), true);
});

test('unusable entropy fails within a bound and preserves the current worker session', async t => {
  const manifest = networkManifest();
  const known = await identityFor(t, manifest, Uint8Array.of(1, 2, 3, 4));
  const { client, generateDirectly } = await workerHarness(t);
  await client.initSession(manifest, account, root(), known.address);
  let calls = 0;
  const random = t.mock.method(globalThis.crypto, 'getRandomValues', buffer => {
    if (++calls > 256) throw new Error('Synthetic entropy fuse');
    return buffer.fill(0);
  });
  const response = await generateDirectly();
  random.mock.restore();
  assert.equal(response.type, 'ERROR');
  assert.equal(calls > 0 && calls <= 128, true);
  assert.match(response.error, /fresh private address/i);
  const next = await client.generateAddress();
  assert.equal((Buffer.from((await decodePrivateAddress(next.address, known.prefix)).diversifier).toString('hex')) !== '00000000', true);
});

for (const operation of ['initialize', 'rotate']) test(`client rejects a zero-diversifier worker response during ${operation}`, async t => {
  const manifest = networkManifest();
  const legacy = await identityFor(t, manifest, new Uint8Array(4));
  const compatible = await identityFor(t, manifest, Uint8Array.of(1, 2, 3, 4));
  const transport = {
    onmessage: null,
    postMessage(message) {
      if (message.type === 'LOCK') return;
      queueMicrotask(() => this.onmessage({ data: {
        messageVersion: message.messageVersion, id: message.id, sessionId: message.sessionId,
        type: message.type === 'INIT_SESSION' ? 'INIT_OK' : 'ADDRESS_OK',
        ownerCommitmentHex: '01'.repeat(32),
        address: operation === 'initialize' || message.type !== 'INIT_SESSION' ? legacy.address : compatible.address,
      } }));
    },
    terminate() {},
  };
  const client = new PrivateBalanceWorkerClient(transport);
  t.after(() => client.terminate());
  if (operation === 'initialize') {
    await assert.rejects(client.initSession(manifest, account, root()), /fresh private address/i);
  } else {
    await client.initSession(manifest, account, root(), compatible.address);
    await assert.rejects(client.generateAddress(), /fresh private address/i);
  }
  assert.equal(client.failed, true, 'an invalid worker identity must not remain usable');
});
