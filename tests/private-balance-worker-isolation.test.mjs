import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import {
  computeContextField,
  computeContextHash,
  encodePrivateAddress,
} from '@stellarkey/private-balance';
import { PrivateBalanceWorkerClient } from '../src/features/private-balance/worker/client.ts';

const manifest = {
    schemaVersion: 1,
    protocolVersion: 1,
    artifactVersion: '1.0.0-dev',
    status: 'development',
    minimumStellarProtocol: 25,
    networkPassphrase: 'Test SDF Network ; September 2015',
    networkId: 'cee0302d59844d32bdca915c8203dd44b33fbb7edc19051ea37abedf28ecd472',
    realmId: '0202020202020202020202020202020202020202020202020202020202020202',
    poolContractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAITA4',
    guardianAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    stealthAnnouncerAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    deploymentBindingHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    artifacts: {
      r1csSha256: 'a1'.repeat(32),
      r1csConstraints: 57838,
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
    hpke: {
      kemId: '0x0020',
      kdfId: '0x0001',
      aeadId: '0x0001',
    },
};

const hex = (value) => Uint8Array.from(
  value.match(/../g),
  (byte) => Number.parseInt(byte, 16),
);
const TEST_PRIVATE_ADDRESS = encodePrivateAddress({
  diversifier: new Uint8Array(4),
  ownerCommitment: Uint8Array.from([1, ...new Uint8Array(31)]),
  hpkePublicKey: new Uint8Array(32).fill(2),
}, 'tks');

test('worker client: rejects operations when worker is uninitialized', async () => {
  const client = new PrivateBalanceWorkerClient();
  const account = Keypair.random();

  const sessionRoot = new Uint8Array(64);
  await assert.rejects(
    async () => {
      await client.initSession(manifest, account.publicKey(), sessionRoot);
    },
    /Worker not initialized/
  );
});

test('worker client: transfers the exact standalone root with public derivation context', async () => {
  const account = Keypair.random();
  const posted = [];
  const fakeWorker = {
    onmessage: null,
    postMessage(message, transfer) {
      posted.push({ message, transfer });
      queueMicrotask(() => this.onmessage({
        data: message.type === 'INIT_SESSION' ? {
          messageVersion: message.messageVersion,
          id: message.id,
          sessionId: message.sessionId,
          type: 'INIT_OK',
          ownerCommitmentHex: '01'.repeat(32),
          address: TEST_PRIVATE_ADDRESS,
        } : {
          messageVersion: message.messageVersion,
          id: message.id,
          sessionId: message.sessionId,
          type: 'SCAN_OK',
          notes: [],
          activities: [],
          tree: {
            nextIndex: 0,
            frontier: Array.from({ length: 32 }, () => new Uint8Array(32)),
            currentRoot: new Uint8Array(32),
          },
          lastRecordHash: new Uint8Array(32),
          spentNullifierHexes: [],
          nullifiersByCommitment: [['01'.repeat(32), '02'.repeat(32)]],
        },
      }));
    },
    terminate() {},
  };
  const client = new PrivateBalanceWorkerClient(fakeWorker);
  const sessionRoot = new Uint8Array(64).fill(7);
  await client.initSession(manifest, account.publicKey(), sessionRoot);

  assert.equal(posted.length, 1);
  const [{ message, transfer }] = posted;
  assert.equal(message.sessionRoot.byteLength, 64);
  assert.equal(message.messageVersion, 1);
  assert.match(message.sessionId, /^session-/);
  assert.equal(message.sessionRoot, sessionRoot.buffer);
  assert.deepEqual(transfer, [message.sessionRoot]);
  assert.deepEqual(sessionRoot, new Uint8Array(64).fill(7));
  assert.deepEqual(message.keyContext.networkId, hex(manifest.networkId));
  assert.deepEqual(message.keyContext.realmId, hex(manifest.realmId));
  assert.deepEqual(message.keyContext.poolId, StrKey.decodeContract(manifest.poolContractId));
  assert.equal('assetId' in message.keyContext, false);
  assert.deepEqual(
    message.keyContext.accountPublicKey,
    StrKey.decodeEd25519PublicKey(account.publicKey()),
  );
  const contextHash = computeContextHash(
    1,
    message.keyContext.networkId,
    message.keyContext.realmId,
    message.keyContext.poolId,
  );
  assert.deepEqual(message.keyContext.contextField, computeContextField(contextHash));
  assert.equal(message.keyContext.addressPrefix, 'tks');

  const scan = await client.scanPage({
    records: [],
    expectedPriorRecordHash: new Uint8Array(32),
  });
  assert.equal(posted[1].message.type, 'SCAN_PAGE');
  assert.equal(posted[1].message.sessionId, message.sessionId);
  assert.equal(scan.nullifiersByCommitment.get('01'.repeat(32)), '02'.repeat(32));

  await assert.rejects(
    () => client.initSession(manifest, account.publicKey(), new Uint8Array(32)),
    /standalone.*64(?:-| )byte/i,
  );
  assert.equal(posted.length, 2);
});

test('worker client restores and rotates diversified receive addresses without exposing keys', async () => {
  const account = Keypair.random();
  const diversifier = Uint8Array.of(1, 2, 3, 4);
  const restoredAddress = encodePrivateAddress({
    diversifier,
    ownerCommitment: Uint8Array.from([1, ...new Uint8Array(31)]),
    hpkePublicKey: new Uint8Array(32).fill(2),
  }, 'tks');
  const freshAddress = encodePrivateAddress({
    diversifier: Uint8Array.of(5, 6, 7, 8),
    ownerCommitment: Uint8Array.from([3, ...new Uint8Array(31)]),
    hpkePublicKey: new Uint8Array(32).fill(4),
  }, 'tks');
  const posted = [];
  const fakeWorker = {
    onmessage: null,
    postMessage(message) {
      posted.push(message);
      queueMicrotask(() => this.onmessage({
        data: message.type === 'INIT_SESSION' ? {
          messageVersion: message.messageVersion,
          id: message.id,
          sessionId: message.sessionId,
          type: 'INIT_OK',
          ownerCommitmentHex: '01'.repeat(32),
          address: restoredAddress,
        } : {
          messageVersion: message.messageVersion,
          id: message.id,
          sessionId: message.sessionId,
          type: 'ADDRESS_OK',
          ownerCommitmentHex: '03'.repeat(32),
          address: freshAddress,
        },
      }));
    },
    terminate() {},
  };
  const client = new PrivateBalanceWorkerClient(fakeWorker);
  const restored = await client.initSession(
    manifest,
    account.publicKey(),
    new Uint8Array(64).fill(7),
    restoredAddress,
  );
  assert.equal(restored.address, restoredAddress);
  assert.deepEqual(posted[0].addressDiversifier, diversifier);
  assert.equal('privateKey' in posted[0], false);

  const fresh = await client.generateAddress();
  assert.equal(posted[1].type, 'GENERATE_ADDRESS');
  assert.equal(fresh.address, freshAddress);
  assert.notEqual(fresh.address, restored.address);

  const wrongNetwork = `sks1${restoredAddress.slice(4)}`;
  await assert.rejects(
    () => client.initSession(
      manifest,
      account.publicKey(),
      new Uint8Array(64).fill(8),
      wrongNetwork,
    ),
    /network|prefix/i,
  );
  assert.equal(posted.length, 2);
});

test('worker client: structured-clone transfer detaches the only caller root buffer', async () => {
  const account = Keypair.random();
  const fakeWorker = {
    onmessage: null,
    postMessage(message, transfer) {
      const cloned = structuredClone(message, { transfer });
      assert.equal(transfer[0].byteLength, 0);
      queueMicrotask(() => this.onmessage({
        data: {
          messageVersion: cloned.messageVersion,
          id: cloned.id,
          sessionId: cloned.sessionId,
          type: 'INIT_OK',
          ownerCommitmentHex: '01'.repeat(32),
          address: TEST_PRIVATE_ADDRESS,
        },
      }));
    },
    terminate() {},
  };
  const client = new PrivateBalanceWorkerClient(fakeWorker);
  const sessionRoot = new Uint8Array(64).fill(11);

  await client.initSession(manifest, account.publicKey(), sessionRoot);

  assert.equal(sessionRoot.byteLength, 0);
});

test('worker client: rejects a root view backed by a larger buffer', async () => {
  const account = Keypair.random();
  const client = new PrivateBalanceWorkerClient({
    onmessage: null,
    postMessage() {},
    terminate() {},
  });
  const oversized = new Uint8Array(65);

  await assert.rejects(
    () => client.initSession(manifest, account.publicKey(), oversized.subarray(1)),
    /standalone.*64(?:-| )byte/i,
  );
});

test('worker expands a session root without zero or truncated identity context', () => {
  const source = readFileSync(
    new URL('../src/features/private-balance/worker/private-balance.worker.ts', import.meta.url),
    'utf8',
  );
  assert.match(source, /deriveExpandedSpendingKey/);
  assert.match(source, /verifyProofLocally/);
  assert.doesNotMatch(source, /deriveKeysFromSeed|manifestBytes/);
  assert.doesNotMatch(source, /addressContextTag:\s*new Uint8Array\(16\)/);
});

test('worker client proves an opaque prepared action without exposing witness inputs', async () => {
  const account = Keypair.random();
  const posted = [];
  const zero = new Uint8Array(32);
  const preparedActionId = 'prepared-action-id';
  const fakeWorker = {
    onmessage: null,
    postMessage(message, transfer) {
      posted.push({ message, transfer });
      let data;
      if (message.type === 'INIT_SESSION') {
        data = {
          messageVersion: message.messageVersion,
          id: message.id,
          sessionId: message.sessionId,
          type: 'INIT_OK',
          ownerCommitmentHex: '01'.repeat(32),
          address: TEST_PRIVATE_ADDRESS,
        };
      } else if (message.type === 'BUILD_ACTION') {
        data = {
          messageVersion: message.messageVersion,
          id: message.id,
          sessionId: message.sessionId,
          type: 'ACTION_PREPARED',
          reservationId: message.reservationId,
          preparedActionId,
          action: {
            protocolVersion: 1,
            kind: 1,
            actionNonce: zero,
            anchorRoot: zero,
            nullifiers: [zero, zero],
            outputs: [
              { cm: zero, recipientEnvelope: new Uint8Array(181) },
              { cm: zero, recipientEnvelope: new Uint8Array(181) },
            ],
            publicValue: 1n,
            depositSource: { kind: 0, payload: message.intent.depositSource.payload },
          },
          actionFieldHex: '02'.repeat(32),
          actionBindingHex: '03'.repeat(32),
          reservedNoteIds: [],
          inputValue: '0',
          changeValue: '0',
          anchorExpiresAtLedger: 0,
        };
      } else {
        data = {
          messageVersion: message.messageVersion,
          id: message.id,
          sessionId: message.sessionId,
          type: 'PROOF_OK',
          proof: { pi_a: [], pi_b: [], pi_c: [] },
          publicSignals: Array.from({ length: 10 }, () => '0'),
          sorobanProofHex: '04'.repeat(256),
        };
      }
      queueMicrotask(() => this.onmessage({ data }));
    },
    terminate() {},
  };
  const client = new PrivateBalanceWorkerClient(fakeWorker);
  await client.initSession(manifest, account.publicKey(), new Uint8Array(64).fill(9));
  const availableNote = {
    id: '05'.repeat(32),
    commitment: '05'.repeat(32),
    value: '1',
    diversifier: '00000000',
    ownerCommitment: '06'.repeat(32),
    leafIndex: 0,
    actionIndex: 0,
    rho: '07'.repeat(32),
    memoHex: '',
    senderFingerprintHex: '',
    status: 'unspent',
    createdAt: 0,
  };
  const prepared = await client.buildAction('build-1', {
    kind: 'deposit',
    publicValue: '1',
    depositSource: { kind: 0, payload: StrKey.decodeEd25519PublicKey(account.publicKey()) },
  }, [], [availableNote]);
  await client.generateProof(
    prepared.preparedActionId,
    new ArrayBuffer(8),
    new ArrayBuffer(8),
    {},
  );

  const buildMessage = posted[1].message;
  assert.equal(buildMessage.type, 'BUILD_ACTION');
  assert.equal(buildMessage.reservationId, 'build-1');
  assert.deepEqual(buildMessage.availableNotes, [availableNote]);
  assert.equal(prepared.reservationId, 'build-1');
  assert.equal('circuitInputs' in buildMessage, false);
  assert.equal('ask' in buildMessage, false);
  assert.equal('nk' in buildMessage, false);
  const proveMessage = posted[2].message;
  assert.equal(proveMessage.type, 'GENERATE_PROOF');
  assert.equal(proveMessage.preparedActionId, preparedActionId);
  assert.equal('circuitInputs' in proveMessage, false);
});
