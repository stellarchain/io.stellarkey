#!/usr/bin/env node
import { createHash, createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, platform, release, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { x25519 } from '@noble/curves/ed25519.js';
import { DhkemX25519HkdfSha256 } from '@hpke/dhkem-x25519';
import * as snarkjs from 'snarkjs';
import {
  DOMAIN_ADDRESS_KEY,
  DOMAIN_DIVERSIFIED_OWNER,
  deriveDiversifiedAddressKeys,
} from '../../packages/browser/dist/keys.js';
import { openRecipientEnvelope } from '../../packages/browser/dist/encryption.js';
import { p2 } from '../../packages/browser/dist/poseidon2.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const outputPath = join(root, 'protocol/private-balance/results/review-validation.json');
const r1csPath = join(root, 'protocol/private-balance/circuits/build/action.r1cs');
const associationPathSource = join(
  root,
  'protocol/private-balance/spikes/circom/association-path.circom',
);
const trials = 3;
const samplesPerTrial = 120;
const warmups = 20;
const PKCS8_X25519_PREFIX = Uint8Array.from([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
  0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20,
]);
const X25519_BASE_POINT = Uint8Array.from([9, ...new Uint8Array(31)]);
const HPKE_VERSION_LABEL = new TextEncoder().encode('HPKE-v1');
const HPKE_KEM_SUITE_ID = Uint8Array.from([0x4b, 0x45, 0x4d, 0x00, 0x20]);
const HPKE_DKP_PRK_LABEL = new TextEncoder().encode('dkp_prk');
const HPKE_SK_LABEL = new TextEncoder().encode('sk');
const ADDRESS_KEY_DOMAIN = new TextEncoder().encode(DOMAIN_ADDRESS_KEY);
const VIEW_TAG_DOMAIN = new TextEncoder().encode('StellarKey private view tag v1');

function concatBytes(...chunks) {
  const result = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function hmac(algorithm, key, ...chunks) {
  const digest = createHmac(algorithm, key);
  for (const chunk of chunks) digest.update(chunk);
  return new Uint8Array(digest.digest());
}

function hkdfExpand(algorithm, prk, info, length, hashLength) {
  const output = new Uint8Array(length);
  let previous = new Uint8Array(0);
  let offset = 0;
  try {
    for (let counter = 1; offset < length; counter += 1) {
      const next = hmac(algorithm, prk, previous, info, Uint8Array.of(counter));
      previous.fill(0);
      previous = next;
      const take = Math.min(hashLength, length - offset);
      output.set(previous.subarray(0, take), offset);
      offset += take;
    }
    return output;
  } finally {
    previous.fill(0);
  }
}

function deriveChildIkm(incomingViewingKey, diversifier) {
  const prk = hmac('sha512', new Uint8Array(64), incomingViewingKey);
  try {
    return hkdfExpand(
      'sha512',
      prk,
      concatBytes(ADDRESS_KEY_DOMAIN, diversifier),
      32,
      64,
    );
  } finally {
    prk.fill(0);
  }
}

function deriveHpkePrivateKey(childIkm) {
  const labeledIkm = concatBytes(
    HPKE_VERSION_LABEL,
    HPKE_KEM_SUITE_ID,
    HPKE_DKP_PRK_LABEL,
    childIkm,
  );
  const dkpPrk = hmac('sha256', new Uint8Array(0), labeledIkm);
  const labeledInfo = concatBytes(
    Uint8Array.of(0, 32),
    HPKE_VERSION_LABEL,
    HPKE_KEM_SUITE_ID,
    HPKE_SK_LABEL,
  );
  try {
    return hkdfExpand('sha256', dkpPrk, labeledInfo, 32, 32);
  } finally {
    dkpPrk.fill(0);
    labeledIkm.fill(0);
    labeledInfo.fill(0);
  }
}

function diversifiedOwnerCommitment(baseOwnerCommitment, diversifier) {
  const diversifierField = new Uint8Array(32);
  diversifierField.set(diversifier, 28);
  return p2(DOMAIN_DIVERSIFIED_OWNER, [baseOwnerCommitment, diversifierField]);
}

function scanViewTag(sharedSecret, contextHash, encPk, recipientPublicKey) {
  return createHash('sha256')
    .update(VIEW_TAG_DOMAIN)
    .update(sharedSecret)
    .update(contextHash)
    .update(encPk)
    .update(recipientPublicKey)
    .digest()[0];
}

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

async function importPrivate(privateKey) {
  const encoded = pkcs8X25519(privateKey);
  const encodedBuffer = ownedBuffer(encoded);
  try {
    return await globalThis.crypto.subtle.importKey(
      'pkcs8',
      encodedBuffer,
      { name: 'X25519' },
      false,
      ['deriveBits'],
    );
  } finally {
    encoded.fill(0);
    new Uint8Array(encodedBuffer).fill(0);
  }
}

async function nativeWithHandles(privateCryptoKey, publicCryptoKey) {
  return new Uint8Array(await globalThis.crypto.subtle.deriveBits(
    { name: 'X25519', public: publicCryptoKey },
    privateCryptoKey,
    256,
  ));
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

async function measureVariants(operations) {
  const entries = Object.entries(operations);
  for (let index = 0; index < warmups; index += 1) {
    for (const [, operation] of entries) await operation();
  }
  const trialsByVariant = Object.fromEntries(entries.map(([name]) => [name, []]));
  for (let trial = 0; trial < trials; trial += 1) {
    const samplesByVariant = Object.fromEntries(entries.map(([name]) => [name, []]));
    for (let sample = 0; sample < samplesPerTrial; sample += 1) {
      for (let offset = 0; offset < entries.length; offset += 1) {
        const [name, operation] = entries[(sample + trial + offset) % entries.length];
        const started = performance.now();
        await operation();
        samplesByVariant[name].push((performance.now() - started) * 1_000);
      }
    }
    for (const [name] of entries) {
      const samples = samplesByVariant[name].sort((left, right) => left - right);
      trialsByVariant[name].push({
        p50Microseconds: percentile(samples, 0.5),
        p95Microseconds: percentile(samples, 0.95),
      });
    }
  }
  return Object.fromEntries(entries.map(([name]) => {
    const trialResults = trialsByVariant[name]
      .sort((left, right) => left.p50Microseconds - right.p50Microseconds);
    const medianTrial = trialResults[Math.floor(trialResults.length / 2)];
    return [name, {
      p50Microseconds: Number(medianTrial.p50Microseconds.toFixed(3)),
      p95Microseconds: Number(medianTrial.p95Microseconds.toFixed(3)),
      trialResults: trialResults.map(result => ({
        p50Microseconds: Number(result.p50Microseconds.toFixed(3)),
        p95Microseconds: Number(result.p95Microseconds.toFixed(3)),
      })),
    }];
  }));
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

const scanKem = new DhkemX25519HkdfSha256();
const scanContextHash = Uint8Array.from({ length: 32 }, (_, index) => 0x70 + index);
const scanCorpus = await Promise.all(Array.from({ length: 128 }, async (_, index) => {
  const diversifier = new Uint8Array(4);
  new DataView(diversifier.buffer).setUint32(0, index + 1, false);
  const ephemeralPrivate = Uint8Array.from(
    { length: 32 },
    (__, byteIndex) => (index * 17 + byteIndex + 1) & 0xff,
  );
  const encPk = x25519.getPublicKey(ephemeralPrivate);
  ephemeralPrivate.fill(0);
  return {
    diversifier,
    encPk,
    publicCryptoKey: await importPublic(encPk),
  };
}));
const basePointCryptoKey = await importPublic(X25519_BASE_POINT);

async function deriveCurrentKeys(diversifier) {
  const childIkm = deriveChildIkm(incomingViewingKey, diversifier);
  try {
    const keyPair = await scanKem.deriveKeyPair(childIkm);
    return {
      privateKey: new Uint8Array(await scanKem.serializePrivateKey(keyPair.privateKey)),
      publicKey: new Uint8Array(await scanKem.serializePublicKey(keyPair.publicKey)),
    };
  } finally {
    childIkm.fill(0);
  }
}

async function scanCurrent(candidate) {
  const ownerCommitment = diversifiedOwnerCommitment(baseOwnerCommitment, candidate.diversifier);
  const keys = await deriveCurrentKeys(candidate.diversifier);
  let sharedSecret;
  try {
    sharedSecret = await nativePkcs8(keys.privateKey, candidate.publicCryptoKey);
    scanViewTag(sharedSecret, scanContextHash, candidate.encPk, keys.publicKey);
  } finally {
    ownerCommitment.fill(0);
    keys.privateKey.fill(0);
    sharedSecret?.fill(0);
  }
}

async function scanReordered(candidate) {
  const keys = await deriveCurrentKeys(candidate.diversifier);
  let sharedSecret;
  try {
    sharedSecret = await nativePkcs8(keys.privateKey, candidate.publicCryptoKey);
    scanViewTag(sharedSecret, scanContextHash, candidate.encPk, keys.publicKey);
  } finally {
    keys.privateKey.fill(0);
    sharedSecret?.fill(0);
  }
}

async function scanWebcrypto(candidate) {
  const childIkm = deriveChildIkm(incomingViewingKey, candidate.diversifier);
  const privateKey = deriveHpkePrivateKey(childIkm);
  let privateCryptoKey;
  let recipientPublicKey;
  let sharedSecret;
  try {
    privateCryptoKey = await importPrivate(privateKey);
    recipientPublicKey = await nativeWithHandles(privateCryptoKey, basePointCryptoKey);
    sharedSecret = await nativeWithHandles(privateCryptoKey, candidate.publicCryptoKey);
    scanViewTag(sharedSecret, scanContextHash, candidate.encPk, recipientPublicKey);
  } finally {
    childIkm.fill(0);
    privateKey.fill(0);
    recipientPublicKey?.fill(0);
    sharedSecret?.fill(0);
  }
}

const equivalenceCandidate = scanCorpus[0];
const currentEquivalenceKeys = await deriveCurrentKeys(equivalenceCandidate.diversifier);
const equivalenceIkm = deriveChildIkm(incomingViewingKey, equivalenceCandidate.diversifier);
const prototypePrivateKey = deriveHpkePrivateKey(equivalenceIkm);
const prototypeHandle = await importPrivate(prototypePrivateKey);
const prototypePublicKey = await nativeWithHandles(prototypeHandle, basePointCryptoKey);
if (
  !equalBytes(currentEquivalenceKeys.privateKey, prototypePrivateKey)
  || !equalBytes(currentEquivalenceKeys.publicKey, prototypePublicKey)
) {
  throw new Error('WebCrypto scan prototype does not preserve RFC 9180 derived keys.');
}
currentEquivalenceKeys.privateKey.fill(0);
equivalenceIkm.fill(0);

let currentCursor = 0;
let reorderedCursor = 0;
let webcryptoCursor = 0;
let idealCursor = 0;
const scanMeasurements = await measureVariants({
  current: () => scanCurrent(scanCorpus[currentCursor++ % scanCorpus.length]),
  reordered: () => scanReordered(scanCorpus[reorderedCursor++ % scanCorpus.length]),
  webcrypto: () => scanWebcrypto(scanCorpus[webcryptoCursor++ % scanCorpus.length]),
  ideal: async () => {
    const candidate = scanCorpus[idealCursor++ % scanCorpus.length];
    const sharedSecret = await nativeWithHandles(prototypeHandle, candidate.publicCryptoKey);
    scanViewTag(sharedSecret, scanContextHash, candidate.encPk, prototypePublicKey);
    sharedSecret.fill(0);
  },
});
const currentScanMeasurement = scanMeasurements.current;
const reorderedScanMeasurement = scanMeasurements.reordered;
const webcryptoScanMeasurement = scanMeasurements.webcrypto;
const idealScanMeasurement = scanMeasurements.ideal;
prototypePrivateKey.fill(0);
prototypePublicKey.fill(0);

const scanBatchSizes = [1, 4, 8, 16, 32, 64];
const scanBatchCorpus = scanCorpus.map((candidate) => {
  const envelope = new Uint8Array(181);
  envelope[0] = 0xff;
  envelope.set(candidate.diversifier, 1);
  envelope.set(candidate.encPk, 5);
  return envelope;
});
const scanBatchArguments = {
  contextHash: Uint8Array.from({ length: 32 }, (_, index) => index + 1),
  contextField: new Uint8Array(32).fill(2),
  assetField: new Uint8Array(32).fill(3),
  commitment: new Uint8Array(32).fill(4),
  actionNonce: new Uint8Array(32).fill(5),
};

async function runScanBatch(batchSize) {
  const started = performance.now();
  for (let offset = 0; offset < scanBatchCorpus.length; offset += batchSize) {
    const envelopes = scanBatchCorpus.slice(offset, offset + batchSize);
    await Promise.all(envelopes.map((envelope, index) => openRecipientEnvelope(
      incomingViewingKey,
      envelope,
      scanBatchArguments.contextHash,
      scanBatchArguments.contextField,
      scanBatchArguments.assetField,
      scanBatchArguments.commitment,
      scanBatchArguments.actionNonce,
      (offset + index) & 1,
      baseOwnerCommitment,
    )));
  }
  return (performance.now() - started) * 1_000 / scanBatchCorpus.length;
}

for (const batchSize of scanBatchSizes) await runScanBatch(batchSize);
const scanBatchTrials = Object.fromEntries(scanBatchSizes.map(size => [size, []]));
for (let trial = 0; trial < trials; trial += 1) {
  for (let offset = 0; offset < scanBatchSizes.length; offset += 1) {
    const batchSize = scanBatchSizes[(trial + offset) % scanBatchSizes.length];
    scanBatchTrials[batchSize].push(await runScanBatch(batchSize));
  }
}
const scanBatchVariants = Object.fromEntries(scanBatchSizes.map((batchSize) => {
  const values = scanBatchTrials[batchSize].sort((left, right) => left - right);
  return [batchSize, {
    p50MicrosecondsPerEnvelope: Number(values[1].toFixed(3)),
    p95MicrosecondsPerEnvelope: Number(values[2].toFixed(3)),
    trialResults: values.map(value => Number(value.toFixed(3))),
  }];
}));
const selectedBatchSize = scanBatchSizes.reduce((best, candidate) => (
  scanBatchVariants[candidate].p50MicrosecondsPerEnvelope
    < scanBatchVariants[best].p50MicrosecondsPerEnvelope
    ? candidate
    : best
));
const sequentialBatchCost = scanBatchVariants[1].p50MicrosecondsPerEnvelope;
const selectedBatchCost = scanBatchVariants[selectedBatchSize].p50MicrosecondsPerEnvelope;
const scanBatchThroughputRatio = sequentialBatchCost / selectedBatchCost;

const r1cs = await snarkjs.r1cs.info(r1csPath);
if (typeof r1cs.curve?.terminate === 'function') await r1cs.curve.terminate();
const associationBuildDir = mkdtempSync(join(tmpdir(), 'stellarkey-association-path-'));
let associationPathR1cs;
try {
  execFileSync(
    'circom',
    [associationPathSource, '--r1cs', '--O2', '-o', associationBuildDir],
    { cwd: root, stdio: 'ignore' },
  );
  associationPathR1cs = await snarkjs.r1cs.info(
    join(associationBuildDir, 'association-path.r1cs'),
  );
  if (typeof associationPathR1cs.curve?.terminate === 'function') {
    await associationPathR1cs.curve.terminate();
  }
} finally {
  rmSync(associationBuildDir, { recursive: true, force: true });
}
const pkcs8Improvement = 1 - pkcs8Measurement.p50Microseconds / jwkMeasurement.p50Microseconds;
const baselineConstraints = 23_437;
const evidence = {
  schemaVersion: 3,
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
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
  scanPath: {
    trials,
    samplesPerTrial,
    warmups,
    corpusSize: scanCorpus.length,
    corpus: 'Deterministic distinct diversifiers and X25519 ephemeral public keys; all variants process the same candidates.',
    toolVersions: {
      node: process.version,
      hpke: JSON.parse(readFileSync(join(root, 'node_modules/@hpke/dhkem-x25519/package.json'), 'utf8')).version,
      nobleCurves: JSON.parse(readFileSync(join(root, 'node_modules/@noble/curves/package.json'), 'utf8')).version,
    },
    variants: {
      current: currentScanMeasurement,
      reordered: reorderedScanMeasurement,
      webcrypto: webcryptoScanMeasurement,
      ideal: idealScanMeasurement,
    },
    ratios: {
      currentOverReordered: Number(
        (currentScanMeasurement.p50Microseconds / reorderedScanMeasurement.p50Microseconds).toFixed(3),
      ),
      currentOverWebcrypto: Number(
        (currentScanMeasurement.p50Microseconds / webcryptoScanMeasurement.p50Microseconds).toFixed(3),
      ),
      currentOverIdeal: Number(
        (currentScanMeasurement.p50Microseconds / idealScanMeasurement.p50Microseconds).toFixed(3),
      ),
    },
  },
  scanBatch: {
    trials,
    candidatesPerTrial: scanBatchCorpus.length,
    variants: scanBatchVariants,
    selectedBatchSize,
    sequentialP50MicrosecondsPerEnvelope: sequentialBatchCost,
    selectedP50MicrosecondsPerEnvelope: selectedBatchCost,
    throughputRatio: Number(scanBatchThroughputRatio.toFixed(3)),
    acceptanceThreshold: 1.2,
  },
  circuit: {
    baseline: {
      constraints: baselineConstraints,
      publicInputs: 13,
      privateInputs: 152,
      sourceRevision: 'cc45d237493a06b0257966da23413bad2c2579aa',
    },
    laneFree: {
      constraints: 22_909,
      delta: -528,
    },
    singleTotalRange: {
      constraints: 22_846,
      delta: -63,
    },
    derivedOutputRoles: {
      constraints: 22_844,
      privateInputs: 150,
      delta: -2,
    },
    prePublicInputReduction: {
      constraints: 14_876,
      publicInputs: 13,
      privateInputs: 124,
    },
    ternaryDepth17: {
      constraints: r1cs.nConstraints,
      publicInputs: r1cs.nPubInputs,
      privateInputs: r1cs.nPrvInputs,
      wires: r1cs.nWires,
      capacityLeaves: 3 ** 17,
      groth16Domain: 2 ** 14,
    },
    reductionPercent: Number(((baselineConstraints - r1cs.nConstraints) / baselineConstraints * 100).toFixed(2)),
    method: 'Each source variant was compiled sequentially with Circom 2.2.3 and --O2; the final R1CS is read directly by snarkjs.',
  },
  associationSet: {
    additionalPathConstraints: associationPathR1cs.nConstraints,
    publicInputs: associationPathR1cs.nPubInputs,
    privateInputs: associationPathR1cs.nPrvInputs,
    projectedActionConstraints: r1cs.nConstraints + associationPathR1cs.nConstraints,
    projectedIncreasePercent: Number(
      (associationPathR1cs.nConstraints / r1cs.nConstraints * 100).toFixed(2),
    ),
    source: 'protocol/private-balance/spikes/circom/association-path.circom',
    method: 'Compiled a standalone depth-17 ternary membership path with Circom 2.2.3 and --O2; policy predicates and association-root lifecycle logic are intentionally excluded.',
  },
  contractCosts: {
    verifier: {
      baselineInstructions: 39_614_514,
      currentInstructions: 29_287_953,
      reductionPercent: Number(((39_614_514 - 29_287_953) / 39_614_514 * 100).toFixed(2)),
      method: 'Soroban test budget for the two-input transfer proof vector. The baseline used the prior 13-signal verifier loop; the current measurement uses one MSM and the accepted 11-signal statement.',
    },
    poolWasm: {
      reviewMisidentifiedBytes: 154_609,
      reviewMisidentifiedArtifact: 'protocol/private-balance/circuits/build/action_js/action.wasm (Circom witness generator)',
      trackedPoolWasmBytes: 93_504,
      measuredBaselineOptimizedBytes: 121_675,
      currentRawBytes: 66_377,
      currentOptimizedBytes: 57_042,
      reductionPercent: Number(((121_675 - 57_042) / 121_675 * 100).toFixed(2)),
      method: 'Built the private-balance-pool source tree for wasm32v1-none --release and ran stellar contract optimize. The current measurement includes fixed-width field arithmetic, 11 public signals, and removal of dead paging configuration.',
    },
  },
  decisions: {
    1: {
      status: 'accept',
      reason: `The reproducible scan corpus measures current, reordered, WebCrypto and ideal paths over ${scanCorpus.length} distinct envelopes.`,
    },
    2: {
      status: 'reject',
      reason: 'Caching one private-key handle across distinct diversified addresses is invalid because every diversifier produces a distinct RFC 9180 private scalar.',
    },
    3: {
      status: 'accept',
      reason: `The RFC 9180-compatible WebCrypto path is byte-identical to the existing implementation and measured ${Number((currentScanMeasurement.p50Microseconds / webcryptoScanMeasurement.p50Microseconds).toFixed(2))}x current; view-tag-first hashing removes Poseidon work from misses.`,
    },
    4: {
      status: scanBatchThroughputRatio >= 1.2 ? 'accept' : 'reject',
      reason: scanBatchThroughputRatio >= 1.2
        ? `Bounded batch ${selectedBatchSize} measured ${scanBatchThroughputRatio.toFixed(2)}x sequential throughput on the deterministic corpus.`
        : `The best bounded batch measured only ${scanBatchThroughputRatio.toFixed(2)}x sequential throughput, below the 1.20x gate.`,
    },
    5: {
      status: 'accept',
      reason: 'One BN254 MSM plus the accepted 11-signal statement reduced the measured verifier budget by 26.07 percent while every proof vector and adversarial rejection retained its verdict.',
    },
    6: {
      status: 'accept',
      reason: 'Passing the eleven-signal vector already verified by the contract into archival removes a duplicate derivation without removing archive payload checks.',
    },
    7: {
      status: 'accept',
      reason: 'Precomputing the immutable asset field is accepted and byte-identical; the separate host-hash backend proposal is rejected until actual Wasm simulation demonstrates a gain.',
    },
    8: {
      status: 'accept',
      reason: 'Ten thousand-case differential tests match BigUint and the measured optimized pool Wasm fell from 121675 to 57042 bytes after all accepted contract changes; the review had measured the witness generator instead.',
    },
    9: {
      status: 'accept',
      reason: 'The documented length-IV claim is false for same-arity hashes; an enforceable domain-slot invariant is required.',
    },
    10: {
      status: 'accept',
      reason: 'The custom KEM, shared multi-asset pool, and capacity-domain proposals now have explicit repository-tested rejection records before artifact bindings move.',
    },
    11: {
      status: 'accept',
      reason: 'The safe variant compiled to 14574 constraints and 11 public inputs; one inverse constraint is retained because an otherwise-unused public actionField would receive a zero proof-binding IC coefficient.',
    },
    12: {
      status: 'reject',
      reason: 'A custom variable-base KEM is not justified by scan latency alone and lacks an independently reviewed specification.',
    },
    13: {
      status: 'reject',
      reason: 'A shared multi-asset pool conflicts with the implemented asset-pinned isolation and reintroduces shared spam and recovery costs.',
    },
    14: {
      status: 'accept',
      reason: 'The archive stores one persistent entry per record, so retired paging constants are removed from the constructor, deployment binding, manifest, and runtime head validation.',
    },
    15: {
      status: 'reject',
      reason: 'Soroban native Poseidon2 fixes the length-IV capacity and exposes no capacity-domain argument; a guest permutation would discard host acceleration without a measured safety need.',
    },
    16: {
      status: 'accept',
      reason: 'The accepted public-input and deployment-binding changes require complete proving-key, verifier, contract, vector, client, and manifest regeneration from an authenticated transcript.',
    },
    17: {
      status: 'accept',
      reason: 'The current client self-submits and therefore exposes its inner transaction source. A fee-bump changes only the fee source and does not remove that link, so the limitation is explicitly accepted until a third-party submission service is specified and operated.',
    },
    18: {
      status: 'defer',
      reason: 'Cross-origin isolation cannot be accepted without a subresource audit and physical-browser proving measurements.',
    },
    19: {
      status: 'reject',
      reason: `A compiled additional depth-17 membership path costs ${associationPathR1cs.nConstraints} constraints (${Number((associationPathR1cs.nConstraints / r1cs.nConstraints * 100).toFixed(2))} percent of the current action) before policy logic; no association curator, appeals model, or user requirement is specified.`,
    },
    20: {
      status: 'accept',
      reason: 'The ZK pool and Horizon stealth path are both live and need an explicit division of responsibility rather than accidental overlap.',
    },
  },
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence, null, 2));
