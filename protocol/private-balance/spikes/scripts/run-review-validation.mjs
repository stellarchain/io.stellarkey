#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, platform, release } from 'node:os';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { x25519 } from '@noble/curves/ed25519.js';
import * as snarkjs from 'snarkjs';
import { deriveDiversifiedAddressKeys } from '../../packages/browser/dist/keys.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const outputPath = join(root, 'protocol/private-balance/results/review-validation.json');
const r1csPath = join(root, 'protocol/private-balance/circuits/build/action.r1cs');
const trials = 3;
const samplesPerTrial = 120;
const warmups = 20;
const PKCS8_X25519_PREFIX = Uint8Array.from([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
  0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20,
]);

function ownedBuffer(bytes) {
  return Uint8Array.from(bytes).buffer;
}

function base64Url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

function pkcs8X25519(privateKey) {
  const encoded = new Uint8Array(PKCS8_X25519_PREFIX.length + privateKey.length);
  encoded.set(PKCS8_X25519_PREFIX);
  encoded.set(privateKey, PKCS8_X25519_PREFIX.length);
  return encoded;
}

async function importPublic(publicKey) {
  return globalThis.crypto.subtle.importKey(
    'raw',
    ownedBuffer(publicKey),
    { name: 'X25519' },
    false,
    [],
  );
}

async function nativeJwk(privateKey, publicCryptoKey) {
  const ownPublicKey = x25519.getPublicKey(privateKey);
  const privateCryptoKey = await globalThis.crypto.subtle.importKey(
    'jwk',
    {
      kty: 'OKP',
      crv: 'X25519',
      d: base64Url(privateKey),
      x: base64Url(ownPublicKey),
      ext: true,
      key_ops: ['deriveBits'],
    },
    { name: 'X25519' },
    false,
    ['deriveBits'],
  );
  return new Uint8Array(await globalThis.crypto.subtle.deriveBits(
    { name: 'X25519', public: publicCryptoKey },
    privateCryptoKey,
    256,
  ));
}

async function nativePkcs8(privateKey, publicCryptoKey) {
  const privateCryptoKey = await globalThis.crypto.subtle.importKey(
    'pkcs8',
    ownedBuffer(pkcs8X25519(privateKey)),
    { name: 'X25519' },
    false,
    ['deriveBits'],
  );
  return new Uint8Array(await globalThis.crypto.subtle.deriveBits(
    { name: 'X25519', public: publicCryptoKey },
    privateCryptoKey,
    256,
  ));
}

function portable(privateKey, publicKey) {
  return x25519.getSharedSecret(privateKey, publicKey);
}

function percentile(sorted, fraction) {
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

async function measure(operation) {
  for (let index = 0; index < warmups; index += 1) await operation();
  const trialResults = [];
  for (let trial = 0; trial < trials; trial += 1) {
    const samples = [];
    for (let sample = 0; sample < samplesPerTrial; sample += 1) {
      const started = performance.now();
      await operation();
      samples.push((performance.now() - started) * 1_000);
    }
    samples.sort((left, right) => left - right);
    trialResults.push({
      p50Microseconds: percentile(samples, 0.5),
      p95Microseconds: percentile(samples, 0.95),
    });
  }
  trialResults.sort((left, right) => left.p50Microseconds - right.p50Microseconds);
  const medianTrial = trialResults[Math.floor(trialResults.length / 2)];
  return {
    p50Microseconds: Number(medianTrial.p50Microseconds.toFixed(3)),
    p95Microseconds: Number(medianTrial.p95Microseconds.toFixed(3)),
    trialResults: trialResults.map(result => ({
      p50Microseconds: Number(result.p50Microseconds.toFixed(3)),
      p95Microseconds: Number(result.p95Microseconds.toFixed(3)),
    })),
  };
}

function equalBytes(left, right) {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

const privateKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const peerPrivateKey = Uint8Array.from({ length: 32 }, (_, index) => 0xa0 + index);
const peerPublicKey = x25519.getPublicKey(peerPrivateKey);
const peerCryptoKey = await importPublic(peerPublicKey);
const expectedSecret = portable(privateKey, peerPublicKey);
const jwkSecret = await nativeJwk(privateKey, peerCryptoKey);
const pkcs8Secret = await nativePkcs8(privateKey, peerCryptoKey);
if (!equalBytes(expectedSecret, jwkSecret) || !equalBytes(expectedSecret, pkcs8Secret)) {
  throw new Error('Native X25519 prototype does not match the portable shared secret.');
}

const incomingViewingKey = Uint8Array.from({ length: 32 }, (_, index) => 0x40 + index);
const baseOwnerCommitment = new Uint8Array(32);
baseOwnerCommitment[31] = 7;
let diversifierCounter = 0;

// Measure sequentially so WebCrypto work from one candidate cannot inflate the
// latency distribution of another candidate through the shared event loop.
const jwkMeasurement = await measure(() => nativeJwk(privateKey, peerCryptoKey));
const pkcs8Measurement = await measure(() => nativePkcs8(privateKey, peerCryptoKey));
const portableMeasurement = await measure(() => portable(privateKey, peerPublicKey));
const diversifiedMeasurement = await measure(async () => {
  const diversifier = new Uint8Array(4);
  new DataView(diversifier.buffer).setUint32(0, diversifierCounter++ >>> 0, false);
  const keys = await deriveDiversifiedAddressKeys(
    baseOwnerCommitment,
    incomingViewingKey,
    diversifier,
  );
  keys.hpkePrivateKey.fill(0);
});

const r1cs = await snarkjs.r1cs.info(r1csPath);
if (typeof r1cs.curve?.terminate === 'function') await r1cs.curve.terminate();
const pkcs8Improvement = 1 - pkcs8Measurement.p50Microseconds / jwkMeasurement.p50Microseconds;
const evidence = {
  schemaVersion: 1,
  revision: execFileSync('git', ['rev-parse', 'main'], { cwd: root, encoding: 'utf8' }).trim(),
  generatedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: platform(),
    osRelease: release(),
    cpu: cpus()[0]?.model ?? 'unknown',
  },
  x25519: {
    trials,
    samplesPerTrial,
    warmups,
    sharedSecretSha256: createHash('sha256').update(expectedSecret).digest('hex'),
    nativeJwk: jwkMeasurement,
    nativePkcs8Prototype: pkcs8Measurement,
    portable: portableMeasurement,
    diversifiedAddress: diversifiedMeasurement,
    pkcs8MedianImprovementPercent: Number((pkcs8Improvement * 100).toFixed(2)),
  },
  circuit: {
    baseline: {
      constraints: r1cs.nConstraints,
      publicInputs: r1cs.nPubInputs,
      privateInputs: r1cs.nPrvInputs,
      wires: r1cs.nWires,
    },
  },
  decisions: {
    1: {
      status: pkcs8Improvement >= 0.2 ? 'accept' : 'reject',
      reason: `PKCS#8 prototype preserves the shared secret and changes warm native median by ${Number((pkcs8Improvement * 100).toFixed(2))}%.`,
    },
    2: {
      status: 'defer',
      reason: 'Lane-free dummy-nullifier constraint savings still require a fresh compiled R1CS comparison.',
    },
    3: {
      status: 'defer',
      reason: 'The ternary depth-17 tree still requires a full-circuit compile and cross-language root/path proof.',
    },
    4: {
      status: 'defer',
      reason: 'Measured diversification cost does not justify replacing RFC 9180 without a complete reviewed KEM specification.',
    },
    5: {
      status: 'accept',
      reason: 'Outgoing ciphertext is already paid into every archive record and has vectors but no runtime consumer.',
    },
    6: {
      status: 'accept',
      reason: 'Deposits can reduce two stored nullifiers to one while retaining a durable proof replay key.',
    },
    7: {
      status: 'accept',
      reason: 'The contract duplicates a consensus hash label as unchecked string literals instead of sharing the protocol primitive.',
    },
    8: {
      status: 'accept',
      reason: 'Input/output total equality makes the second 63-bit range decomposition logically redundant.',
    },
  },
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence, null, 2));
