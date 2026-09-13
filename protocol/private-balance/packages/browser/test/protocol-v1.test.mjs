import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  poseidon2Hash,
  BN254_FR_MODULUS,
  BN254_FR_MODULUS_BYTES,
  bigintTo32Bytes,
  bytesToBigint,
  encodeU16Be,
  encodeU32Be,
  encodeU64Be,
  computeContextHash,
  encodePrivateAddress,
  decodePrivateAddress,
  derivePrivateAddressDeploymentTag,
  PRIVATE_ADDRESS_MAINNET_ASCII_BYTES,
  PRIVATE_ADDRESS_TESTNET_ASCII_BYTES,
  encodeNotePlaintext,
  decodeNotePlaintext,
  encodeOutgoingPlaintext,
  decodeOutgoingPlaintext,
  deriveOutgoingAad,
  computeDummyNullifier,
  serializeCanonicalActionBytes,
  computePublicSignals,
  ActionKind,
  encodeProofForSoroban,
  deriveKeysFromSeed,
  derivePrivacySessionRoot,
  deriveExpandedSpendingKey,
  derivePrivateStorageKey,
  computeContextField,
  randomBytes32,
  sampleNonzeroField,
  isCanonicalField,
} from '../dist/index.js';

const hex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

test('BN254 Fr uses the Groth16 scalar-field modulus in every representation', () => {
  assert.equal(hex(BN254_FR_MODULUS_BYTES), '30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001');
  assert.equal(bytesToBigint(BN254_FR_MODULUS_BYTES), BN254_FR_MODULUS);
});

test('production randomness returns fresh bytes and canonical nonzero fields', () => {
  const firstNonce = randomBytes32();
  const secondNonce = randomBytes32();
  assert.equal(firstNonce.length, 32);
  assert.equal(secondNonce.length, 32);
  assert.notDeepEqual(firstNonce, secondNonce);

  for (let sample = 0; sample < 64; sample += 1) {
    const field = sampleNonzeroField();
    assert.equal(field.length, 32);
    assert.equal(isCanonicalField(field), true);
    assert.equal(field.some(byte => byte !== 0), true);
  }
});

test('Poseidon2 matches every pinned Rust/Soroban vector', async () => {
  const path = join(import.meta.dirname, '../../../vectors/poseidon2-v1.json');
  const vectors = JSON.parse(readFileSync(path, 'utf8'));

  for (const item of vectors.test_cases) {
    const inputs = item.inputs.map((value) => BigInt(`0x${value}`));
    assert.equal(hex(bigintTo32Bytes(await poseidon2Hash(inputs))), item.expected_hash);
  }
});

test('private address uses compact network prefixes, Base58, and a prefix-bound checksum', async () => {
  const diversifier = Uint8Array.of(1, 2, 3, 4);
  const deploymentBindingHash = new Uint8Array(32).fill(0x42);
  const deploymentTag = derivePrivateAddressDeploymentTag(deploymentBindingHash);
  const ownerCommitment = new Uint8Array(32);
  ownerCommitment[31] = 7;
  const hpkePublicKey = new Uint8Array(32).fill(0x22);
  const testnet = encodePrivateAddress(
    { deploymentTag, diversifier, ownerCommitment, hpkePublicKey },
    'tskpay_',
  );
  const mainnet = encodePrivateAddress(
    { deploymentTag, diversifier, ownerCommitment, hpkePublicKey },
    'skpay_',
  );

  assert.equal(testnet.length, PRIVATE_ADDRESS_TESTNET_ASCII_BYTES);
  assert.equal(mainnet.length, PRIVATE_ADDRESS_MAINNET_ASCII_BYTES);
  assert.ok(testnet.length <= 128);
  assert.match(testnet, /^tskpay_[1-9A-HJ-NP-Za-km-z]+$/);
  assert.doesNotMatch(testnet.slice('tskpay_'.length), /[0OIl]/);
  assert.deepEqual(await decodePrivateAddress(testnet, 'tskpay_', deploymentBindingHash), {
    deploymentTag,
    diversifier,
    ownerCommitment,
    hpkePublicKey,
  });

  await assert.rejects(() => decodePrivateAddress(`${testnet}=`, 'tskpay_', deploymentBindingHash));
  await assert.rejects(
    () => decodePrivateAddress(`skpay_${testnet.slice('tskpay_'.length)}`, 'skpay_', deploymentBindingHash),
    /checksum/i,
  );
  await assert.rejects(() => decodePrivateAddress(testnet, 'skpay_', deploymentBindingHash), /prefix/i);
  await assert.rejects(() => decodePrivateAddress(testnet.toUpperCase(), 'tskpay_', deploymentBindingHash));
  await assert.rejects(
    () => decodePrivateAddress(testnet, 'tskpay_', new Uint8Array(32).fill(0x43)),
    /deployment/i,
  );
  await assert.rejects(() => decodePrivateAddress(`tks1${'q'.repeat(166)}`, 'tskpay_', deploymentBindingHash));
  await assert.rejects(() => decodePrivateAddress(`sks1${'q'.repeat(166)}`, 'skpay_', deploymentBindingHash));
});

test('private address deployment tags bind 32-byte deployment hashes', () => {
  const hash = new Uint8Array(32).fill(0x42);
  const first = derivePrivateAddressDeploymentTag(hash);
  const second = derivePrivateAddressDeploymentTag(hash);
  assert.equal(first.length, 16);
  assert.deepEqual(first, second);
  hash[31] ^= 1;
  assert.notDeepEqual(derivePrivateAddressDeploymentTag(hash), first);
  assert.throws(() => derivePrivateAddressDeploymentTag(new Uint8Array(31)));
});

test('protocol V1 note encoding binds an immutable asset index in the normative 128-byte layout', () => {
  const note = {
    protocolVersion: 2,
    flags: 0,
    value: 5_000_000n,
    diversifier: Uint8Array.of(1, 2, 3, 4),
    ownerCommitment: bigintTo32Bytes(7n),
    rho: bigintTo32Bytes(9n),
    memoLength: 3,
    memo: Uint8Array.from([0x61, 0x62, 0x63, ...new Array(29).fill(0)]),
    assetIndex: 0x0102_0304,
    reserved: new Uint8Array(11),
  };

  const encoded = encodeNotePlaintext(note);
  assert.equal(encoded.length, 128);
  assert.deepEqual(decodeNotePlaintext(encoded), note);

  const nonzeroTail = encoded.slice();
  nonzeroTail[123] = 1;
  assert.throws(() => decodeNotePlaintext(nonzeroTail));

  const nonzeroReserved = encoded.slice();
  nonzeroReserved[127] = 1;
  assert.throws(() => decodeNotePlaintext(nonzeroReserved));

  assert.deepEqual(Array.from(encoded.slice(113, 117)), [1, 2, 3, 4]);
});

test('outgoing plaintext carries the same asset index and supports output lane two AAD', () => {
  const outgoing = {
    protocolVersion: 2,
    flags: 0,
    value: 9n,
    diversifier: Uint8Array.of(4, 3, 2, 1),
    ownerCommitment: bigintTo32Bytes(7n),
    recipientHpkePublicKey: new Uint8Array(32).fill(8),
    memoLength: 0,
    memo: new Uint8Array(32),
    assetIndex: 23,
    reserved: new Uint8Array(11),
  };

  const encoded = encodeOutgoingPlaintext(outgoing);
  assert.equal(encoded.length, 128);
  assert.deepEqual(decodeOutgoingPlaintext(encoded), outgoing);
  assert.deepEqual(Array.from(encoded.slice(113, 117)), [0, 0, 0, 23]);
  assert.doesNotThrow(() => deriveOutgoingAad(
    new Uint8Array(32),
    new Uint8Array(32),
    new Uint8Array(32),
    bigintTo32Bytes(1n),
    new Uint8Array(32),
    2,
  ));
});

test('dummy nullifiers are derived from fresh secrets without exposing lane order', () => {
  const contextField = bigintTo32Bytes(42n);
  const first = computeDummyNullifier(contextField, bigintTo32Bytes(901n));
  const second = computeDummyNullifier(contextField, bigintTo32Bytes(902n));

  assert.equal(first.length, 32);
  assert.equal(second.length, 32);
  assert.notDeepEqual(first, second);
});

test('canonical integer encoders reject truncation and signed values', () => {
  for (const value of [-1, 1.5, 0x1_0000]) {
    assert.throws(() => encodeU16Be(value, []));
  }
  for (const value of [-1, 1.5, 0x1_0000_0000]) {
    assert.throws(() => encodeU32Be(value, []));
  }
  for (const value of [-1n, 1n << 64n]) {
    assert.throws(() => encodeU64Be(value, []));
  }
});

test('context and action encoders reject malformed fixed-width fields', () => {
  const bytes32 = new Uint8Array(32);
  assert.throws(() => computeContextHash(2, new Uint8Array(31), bytes32, bytes32, bytes32));

  const action = {
    protocolVersion: 2,
    kind: ActionKind.Deposit,
    assetIndex: 0,
    asset: { kind: 1, payload: bytes32 },
    actionNonce: bytes32,
    anchorRoot: bytes32,
    nullifiers: [bytes32, bytes32],
    outputs: [
      { cm: bytes32, recipientEnvelope: new Uint8Array(181) },
      { cm: bytes32, recipientEnvelope: new Uint8Array(181) },
      { cm: bytes32, recipientEnvelope: new Uint8Array(181) },
    ],
    publicValue: 1n,
    depositSource: { kind: 0, payload: new Uint8Array(31) },
  };
  assert.throws(() => serializeCanonicalActionBytes(action, bytes32, bytes32, bytes32));
});

test('canonical action encoding permits a full withdrawal without private change', () => {
  const zero = new Uint8Array(32);
  const nonzero = bigintTo32Bytes(1n);
  const second = bigintTo32Bytes(2n);
  const action = {
    protocolVersion: 2,
    kind: ActionKind.Withdraw,
    assetIndex: 7,
    asset: { kind: 1, payload: new Uint8Array(32).fill(0x46) },
    actionNonce: new Uint8Array(32).fill(0x33),
    anchorRoot: nonzero,
    nullifiers: [nonzero, second],
    outputs: [
      {
        cm: bigintTo32Bytes(3n),
        recipientEnvelope: new Uint8Array(181).fill(3),
        outgoingEnvelope: new Uint8Array(157).fill(4),
      },
      {
        cm: bigintTo32Bytes(4n),
        recipientEnvelope: new Uint8Array(181).fill(5),
        outgoingEnvelope: new Uint8Array(157).fill(6),
      },
      {
        cm: bigintTo32Bytes(5n),
        recipientEnvelope: new Uint8Array(181).fill(7),
        outgoingEnvelope: new Uint8Array(157).fill(8),
      },
    ],
    publicValue: 1n,
    publicRecipient: { kind: 0, payload: new Uint8Array(32).fill(0x44) },
  };

  const encoded = serializeCanonicalActionBytes(action, zero, zero, zero);
  assert.equal(encoded.length, 1467);
  assert.throws(() => serializeCanonicalActionBytes({
    ...action,
    nullifiers: [nonzero, zero],
  }, zero, zero, zero));
  assert.throws(() => serializeCanonicalActionBytes({
    ...action,
    outputs: [{ ...action.outputs[0], cm: zero }, action.outputs[1], action.outputs[2]],
  }, zero, zero, zero));
});

test('private transfer hides its asset and binds three outputs into eleven public signals', async () => {
  const zero = new Uint8Array(32);
  const one = bigintTo32Bytes(1n);
  const action = {
    protocolVersion: 2,
    kind: ActionKind.PrivateTransfer,
    actionNonce: new Uint8Array(32).fill(0x33),
    anchorRoot: one,
    nullifiers: [one, bigintTo32Bytes(2n)],
    outputs: [
      {
        cm: bigintTo32Bytes(3n),
        recipientEnvelope: new Uint8Array(181).fill(3),
        outgoingEnvelope: new Uint8Array(157).fill(4),
      },
      {
        cm: bigintTo32Bytes(4n),
        recipientEnvelope: new Uint8Array(181).fill(5),
        outgoingEnvelope: new Uint8Array(157).fill(6),
      },
      {
        cm: bigintTo32Bytes(5n),
        recipientEnvelope: new Uint8Array(181).fill(7),
        outgoingEnvelope: new Uint8Array(157).fill(8),
      },
    ],
    publicValue: 0n,
  };

  const signals = await computePublicSignals(action, one, zero, zero, zero);
  assert.equal(signals.length, 11);
  assert.deepEqual(signals[1], zero);
  assert.equal(signals[5].some((byte) => byte !== 0), true);
  assert.deepEqual(signals[8], action.outputs[0].cm);
  assert.deepEqual(signals[9], action.outputs[1].cm);
  assert.deepEqual(signals[10], action.outputs[2].cm);

  assert.throws(() => serializeCanonicalActionBytes({
    ...action,
    assetIndex: 0,
    asset: { kind: 1, payload: new Uint8Array(32).fill(0x46) },
  }, zero, zero, zero), /transfer.*asset|asset.*transfer/i);
});

test('Soroban proof encoding rejects malformed and non-field coordinates', () => {
  const vectors = JSON.parse(
    readFileSync(join(import.meta.dirname, '../../../vectors/proofs-v1.json'), 'utf8'),
  );
  const proof = vectors.proofs[0].proof;
  assert.equal(encodeProofForSoroban(proof).length, 256);
  assert.throws(() => encodeProofForSoroban({ ...proof, protocol: 'plonk' }));
  assert.throws(() => encodeProofForSoroban({ ...proof, pi_a: ['-1', ...proof.pi_a.slice(1)] }));
  assert.throws(() => encodeProofForSoroban({ ...proof, pi_b: [proof.pi_b[0]] }));
  const bn254BaseModulus =
    21888242871839275222246405745257275088696311157297823662689037894645226208583n;
  assert.throws(() =>
    encodeProofForSoroban({ ...proof, pi_c: [bn254BaseModulus.toString(), proof.pi_c[1]] }),
  );
});

test('transferred privacy session root expands to the normative key hierarchy', async () => {
  const rawSeed = new Uint8Array(32).fill(1);
  const networkId = new Uint8Array(32).fill(2);
  const realmId = new Uint8Array(32).fill(3);
  const poolId = new Uint8Array(32).fill(4);
  const accountPublicKey = new Uint8Array(32).fill(6);
  const contextField = computeContextField(
    computeContextHash(2, networkId, realmId, poolId),
  );
  const direct = await deriveKeysFromSeed(
    rawSeed,
    2,
    networkId,
    realmId,
    poolId,
    accountPublicKey,
    contextField,
  );
  const sessionRoot = derivePrivacySessionRoot(
    rawSeed,
    2,
    networkId,
    realmId,
    poolId,
    accountPublicKey,
  );
  assert.equal(sessionRoot.length, 64);
  const expanded = await deriveExpandedSpendingKey(
    sessionRoot,
    2,
    networkId,
    realmId,
    poolId,
    accountPublicKey,
    contextField,
  );
  assert.deepEqual(expanded, direct);
});

test('private storage keys bind the stable deployment without binding artifact manifests', () => {
  const sessionRoot = new Uint8Array(64).fill(0x41);
  const deployment = new Uint8Array(32).fill(0x42);
  const first = derivePrivateStorageKey(sessionRoot, deployment);
  const same = derivePrivateStorageKey(sessionRoot, deployment);
  const changed = derivePrivateStorageKey(sessionRoot, new Uint8Array(32).fill(0x43));
  assert.equal(first.length, 32);
  assert.deepEqual(first, same);
  assert.notDeepEqual(first, changed);
  assert.deepEqual(sessionRoot, new Uint8Array(64).fill(0x41));
});
