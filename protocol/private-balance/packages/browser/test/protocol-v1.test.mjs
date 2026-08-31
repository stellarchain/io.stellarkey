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
  encodeNotePlaintext,
  decodeNotePlaintext,
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

test('V2 private address uses strict network HRP, Bech32m checksum, and exact length', async () => {
  const diversifier = Uint8Array.of(1, 2, 3, 4);
  const ownerCommitment = new Uint8Array(32);
  ownerCommitment[31] = 7;
  const hpkePublicKey = new Uint8Array(32).fill(0x22);
  const encoded = encodePrivateAddress(
    { diversifier, ownerCommitment, hpkePublicKey },
    'tks',
  );

  assert.equal(encoded.length, 119);
  assert.match(encoded, /^tks1[02-9ac-hj-np-z]{115}$/);
  assert.deepEqual(await decodePrivateAddress(encoded, 'tks'), {
    diversifier,
    ownerCommitment,
    hpkePublicKey,
  });
  await assert.rejects(() => decodePrivateAddress(`${encoded}=`, 'tks'));
  await assert.rejects(() => decodePrivateAddress(`sks1${encoded.slice(4)}`, 'tks'));
  await assert.rejects(() => decodePrivateAddress(encoded.toUpperCase(), 'tks'));
});

test('V2 note encoding binds a diversifier in the normative 128-byte layout', () => {
  const note = {
    protocolVersion: 1,
    flags: 0,
    value: 5_000_000n,
    diversifier: Uint8Array.of(1, 2, 3, 4),
    ownerCommitment: bigintTo32Bytes(7n),
    rho: bigintTo32Bytes(9n),
    memoLength: 3,
    memo: Uint8Array.from([0x61, 0x62, 0x63, ...new Array(29).fill(0)]),
    reserved: new Uint8Array(15),
  };

  const encoded = encodeNotePlaintext(note);
  assert.equal(encoded.length, 128);
  assert.deepEqual(decodeNotePlaintext(encoded), note);

  const nonzeroTail = encoded.slice();
  nonzeroTail[124] = 1;
  assert.throws(() => decodeNotePlaintext(nonzeroTail));

  const nonzeroReserved = encoded.slice();
  nonzeroReserved[127] = 1;
  assert.throws(() => decodeNotePlaintext(nonzeroReserved));
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
  assert.throws(() => computeContextHash(1, new Uint8Array(31), bytes32, bytes32, bytes32));

  const action = {
    protocolVersion: 1,
    kind: ActionKind.Deposit,
    asset: { kind: 1, payload: bytes32 },
    actionNonce: bytes32,
    anchorRoot: bytes32,
    nullifiers: [bytes32, bytes32],
    outputs: [
      { cm: bytes32, recipientEnvelope: new Uint8Array(181) },
      { cm: bytes32, recipientEnvelope: new Uint8Array(181) },
    ],
    publicValue: 1n,
    relayerFee: 0n,
    depositSource: { kind: 0, payload: new Uint8Array(31) },
  };
  assert.throws(() => serializeCanonicalActionBytes(action, bytes32, bytes32, bytes32));
});

test('canonical action encoding permits a full withdrawal without private change', () => {
  const zero = new Uint8Array(32);
  const nonzero = bigintTo32Bytes(1n);
  const action = {
    protocolVersion: 1,
    kind: ActionKind.Withdraw,
    asset: { kind: 1, payload: new Uint8Array(32).fill(0x46) },
    actionNonce: new Uint8Array(32).fill(0x33),
    anchorRoot: nonzero,
    nullifiers: [nonzero, zero],
    outputs: [
      { cm: zero, recipientEnvelope: new Uint8Array(181) },
      { cm: zero, recipientEnvelope: new Uint8Array(181) },
    ],
    publicValue: 1n,
    publicRecipient: { kind: 0, payload: new Uint8Array(32).fill(0x44) },
    relayerFee: 0n,
    relayer: { kind: 0, payload: new Uint8Array(32).fill(0x45) },
  };

  assert.doesNotThrow(() =>
    serializeCanonicalActionBytes(action, zero, zero, zero),
  );
});

test('private transfer binds an asset, relayer address, and fee into thirteen public signals', async () => {
  const zero = new Uint8Array(32);
  const one = bigintTo32Bytes(1n);
  const relayer = { kind: 0, payload: new Uint8Array(32).fill(0x45) };
  const action = {
    protocolVersion: 1,
    kind: ActionKind.PrivateTransfer,
    asset: { kind: 1, payload: new Uint8Array(32).fill(0x46) },
    actionNonce: new Uint8Array(32).fill(0x33),
    anchorRoot: one,
    nullifiers: [one, zero],
    outputs: [
      { cm: one, recipientEnvelope: new Uint8Array(181) },
      { cm: zero, recipientEnvelope: new Uint8Array(181) },
    ],
    publicValue: 0n,
    relayerFee: 25n,
    relayer,
  };

  const signals = await computePublicSignals(action, one, zero, zero, zero);
  assert.equal(signals.length, 13);
  assert.equal(signals[1].some((byte) => byte !== 0), true);
  assert.deepEqual(signals[5], bigintTo32Bytes(25n));
  assert.equal(signals[6].some((byte) => byte !== 0), true);

  const changedFee = serializeCanonicalActionBytes(
    { ...action, relayerFee: 26n },
    zero,
    zero,
    zero,
  );
  assert.notDeepEqual(
    changedFee,
    serializeCanonicalActionBytes(action, zero, zero, zero),
  );
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
    computeContextHash(1, networkId, realmId, poolId),
  );
  const direct = await deriveKeysFromSeed(
    rawSeed,
    1,
    networkId,
    realmId,
    poolId,
    accountPublicKey,
    contextField,
  );
  const sessionRoot = derivePrivacySessionRoot(
    rawSeed,
    1,
    networkId,
    realmId,
    poolId,
    accountPublicKey,
  );
  assert.equal(sessionRoot.length, 64);
  const expanded = await deriveExpandedSpendingKey(
    sessionRoot,
    1,
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
