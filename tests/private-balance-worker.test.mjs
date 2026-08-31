import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@stellar/stellar-sdk';
import { encodePrivateAddress } from '@stellarkey/private-balance';
import { PrivateBalanceWorkerClient } from '../src/features/private-balance/worker/client.ts';

const TEST_PRIVATE_ADDRESS = encodePrivateAddress({
  diversifier: new Uint8Array(4),
  ownerCommitment: Uint8Array.from([1, ...new Uint8Array(31)]),
  hpkePublicKey: new Uint8Array(32).fill(2),
}, 'tks');

const manifest = {
  schemaVersion: 1,
  protocolVersion: 1,
  artifactVersion: '1.0.0-dev',
  status: 'development',
  minimumStellarProtocol: 25,
  networkPassphrase: 'Test SDF Network ; September 2015',
  networkId: 'cee0302d59844d32bdca915c8203dd44b33fbb7edc19051ea37abedf28ecd472',
  realmId: '02'.repeat(32),
  poolContractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAITA4',
  assetContractId: 'CBUSYNQKASUYFWYC3M2GUEDMX4AIVWPALDBYJPNK6554BREHTGZ2IUNF',
  guardianAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
  stealthAnnouncerAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
  deploymentBindingHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  artifacts: {
    r1csSha256: 'a1'.repeat(32),
    r1csConstraints: 57_838,
    wasmSha256: 'a2'.repeat(32),
    wasmByteLength: 100,
    zkeySha256: 'a3'.repeat(32),
    zkeyByteLength: 100,
    vkJsonSha256: 'a4'.repeat(32),
    vkBinSha256: 'a5'.repeat(32),
  },
  constants: {
    treeDepth: 32,
    pageCapacity: 32,
    publicInputs: 13,
    notePlaintextBytes: 128,
    recipientEnvelopeBytes: 181,
    outputPackageBytes: 213,
    addressPayloadBytes: 68,
    addressAsciiBytes: 119,
    addressContextTagBytes: 0,
    addressChecksumBytes: 6,
  },
  hpke: { kemId: '0x0020', kdfId: '0x0001', aeadId: '0x0001' },
};

function responseFor(message, body) {
  return {
    messageVersion: message.messageVersion,
    id: message.id,
    sessionId: message.sessionId,
    ...body,
  };
}

async function initializedClient(fakeWorker) {
  const client = new PrivateBalanceWorkerClient(fakeWorker);
  const initializing = client.initSession(
    manifest,
    Keypair.random().publicKey(),
    new Uint8Array(64).fill(7),
  );
  const init = fakeWorker.messages.at(-1);
  fakeWorker.onmessage({ data: responseFor(init, {
    type: 'INIT_OK',
    ownerCommitmentHex: '01'.repeat(32),
    address: TEST_PRIVATE_ADDRESS,
  }) });
  await initializing;
  return client;
}

test('worker lifecycle: proof progress is correlated without completing the request', async () => {
  const fakeWorker = {
    onmessage: null,
    messages: [],
    postMessage(message) { this.messages.push(message); },
    terminate() {},
  };
  const client = await initializedClient(fakeWorker);
  const progress = [];
  const proving = client.generateProof(
    'prepared-1',
    new ArrayBuffer(8),
    new ArrayBuffer(8),
    {},
    { onProgress: percentage => progress.push(percentage) },
  );
  const request = fakeWorker.messages.at(-1);

  fakeWorker.onmessage({ data: responseFor(request, {
    type: 'PROOF_PROGRESS',
    percentage: 10,
  }) });
  fakeWorker.onmessage({ data: responseFor(request, {
    type: 'PROOF_PROGRESS',
    percentage: 80,
  }) });
  fakeWorker.onmessage({ data: responseFor(request, {
    type: 'PROOF_OK',
    proof: { pi_a: [], pi_b: [], pi_c: [] },
    publicSignals: [],
    sorobanProofHex: '',
  }) });

  await proving;
  assert.deepEqual(progress, [10, 80]);
});

test('worker lifecycle: cancellation targets the proof operation and keeps the session usable', async () => {
  let terminated = false;
  const fakeWorker = {
    onmessage: null,
    messages: [],
    postMessage(message) { this.messages.push(message); },
    terminate() { terminated = true; },
  };
  const client = await initializedClient(fakeWorker);
  const controller = new AbortController();
  const proving = client.generateProof(
    'prepared-1',
    new ArrayBuffer(8),
    new ArrayBuffer(8),
    {},
    { signal: controller.signal },
  );
  const proofRequest = fakeWorker.messages.at(-1);

  controller.abort();

  await assert.rejects(proving, error => error?.name === 'AbortError');
  assert.ok(fakeWorker.messages.some(message => (
    message.type === 'CANCEL' && message.targetOperationId === proofRequest.id
  )));
  // Aborting one request must not kill the shared worker or wipe the session.
  assert.equal(terminated, false);
  assert.equal(fakeWorker.messages.some(message => message.type === 'LOCK'), false);

  // A late result for the cancelled operation is ignored and the same client
  // still serves subsequent operations without a full resync.
  fakeWorker.onmessage({ data: responseFor(proofRequest, {
    type: 'PROOF_OK',
    proof: { pi_a: [], pi_b: [], pi_c: [] },
    publicSignals: [],
    sorobanProofHex: '',
  }) });
  const scanning = client.scanPage({
    records: [],
    expectedPriorRecordHash: new Uint8Array(32),
  });
  const scanRequest = fakeWorker.messages.at(-1);
  assert.equal(scanRequest.type, 'SCAN_PAGE');
  fakeWorker.onmessage({ data: responseFor(scanRequest, {
    type: 'SCAN_OK',
    notes: [],
    activities: [],
    tree: { nextIndex: 0, frontier: [], currentRoot: new Uint8Array(32) },
    lastRecordHash: new Uint8Array(32),
    spentNullifierHexes: [],
    nullifiersByCommitment: [],
  }) });
  await scanning;

  client.terminate();
  assert.equal(terminated, true);
  assert.ok(fakeWorker.messages.some(message => message.type === 'LOCK'));
});

test('worker lifecycle: a crash rejects every pending request and fails the client', async () => {
  let terminated = false;
  const fakeWorker = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    messages: [],
    postMessage(message) { this.messages.push(message); },
    terminate() { terminated = true; },
  };
  const client = await initializedClient(fakeWorker);
  assert.equal(client.failed, false);
  const scanning = client.scanPage({
    records: [],
    expectedPriorRecordHash: new Uint8Array(32),
  });

  // A worker script that dies surfaces only as an 'error' event; without a
  // handler the pending scan would hang forever with the runtime mutex held.
  fakeWorker.onerror(new Error('worker blew up'));

  await assert.rejects(scanning, /worker crashed/i);
  assert.equal(client.failed, true);
  assert.equal(terminated, true);

  // A failed client rejects immediately instead of queueing new work; the
  // provider rebuilds the worker session on its next sync.
  await assert.rejects(
    client.scanPage({ records: [], expectedPriorRecordHash: new Uint8Array(32) }),
    /worker crashed/i,
  );
});

test('worker lifecycle: a hung request trips the watchdog instead of deadlocking', async () => {
  const fakeWorker = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    messages: [],
    postMessage(message) { this.messages.push(message); },
    terminate() {},
  };
  const client = new PrivateBalanceWorkerClient(fakeWorker, { requestTimeoutMs: 20 });
  const initializing = client.initSession(
    manifest,
    Keypair.random().publicKey(),
    new Uint8Array(64).fill(7),
  );
  const init = fakeWorker.messages.at(-1);
  fakeWorker.onmessage({ data: responseFor(init, {
    type: 'INIT_OK',
    ownerCommitmentHex: '01'.repeat(32),
    address: TEST_PRIVATE_ADDRESS,
  }) });
  await initializing;

  // The worker never answers this scan; the mutex holder must exit via a
  // rejection rather than wait forever.
  await assert.rejects(
    client.scanPage({ records: [], expectedPriorRecordHash: new Uint8Array(32) }),
    /stopped responding/i,
  );
  assert.equal(client.failed, true);
});

test('worker lifecycle: a completed request never trips its watchdog later', async () => {
  const fakeWorker = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    messages: [],
    postMessage(message) { this.messages.push(message); },
    terminate() {},
  };
  const client = new PrivateBalanceWorkerClient(fakeWorker, { requestTimeoutMs: 20 });
  const initializing = client.initSession(
    manifest,
    Keypair.random().publicKey(),
    new Uint8Array(64).fill(7),
  );
  const init = fakeWorker.messages.at(-1);
  fakeWorker.onmessage({ data: responseFor(init, {
    type: 'INIT_OK',
    ownerCommitmentHex: '01'.repeat(32),
    address: TEST_PRIVATE_ADDRESS,
  }) });
  await initializing;
  const scanning = client.scanPage({
    records: [],
    expectedPriorRecordHash: new Uint8Array(32),
  });
  const scanRequest = fakeWorker.messages.at(-1);
  fakeWorker.onmessage({ data: responseFor(scanRequest, {
    type: 'SCAN_OK',
    notes: [],
    activities: [],
    tree: { nextIndex: 0, frontier: [], currentRoot: new Uint8Array(32) },
    lastRecordHash: new Uint8Array(32),
    spentNullifierHexes: [],
    nullifiersByCommitment: [],
  }) });
  await scanning;
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(client.failed, false);
});

test('worker lifecycle: pending request queue is bounded', async () => {
  const fakeWorker = {
    onmessage: null,
    messages: [],
    postMessage(message) { this.messages.push(message); },
    terminate() {},
  };
  const client = await initializedClient(fakeWorker);
  const requests = Array.from({ length: 4 }, () => client.scanPage({
    records: [],
    expectedPriorRecordHash: new Uint8Array(32),
  }));

  await assert.rejects(
    client.scanPage({ records: [], expectedPriorRecordHash: new Uint8Array(32) }),
    /queue is full/i,
  );
  client.terminate();
  await Promise.allSettled(requests);
});
