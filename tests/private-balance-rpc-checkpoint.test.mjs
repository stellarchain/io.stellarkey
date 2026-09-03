import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PrivateRpcViewsDisagreeError,
  PrivateRpcWitnessUnavailableError,
  corroboratePrivateRpcCheckpoint,
} from '../src/features/private-balance/runtime/rpc-checkpoint.ts';

const passphrase = 'Test SDF Network ; September 2015';
const deploymentCheckpoint = { ledger: 100, hash: '10'.repeat(32) };
const bytes = value => new Uint8Array(32).fill(value);

function head(actionCount, marker = actionCount) {
  return {
    latestLedger: 500,
    config: {
      protocolVersion: 1,
      networkId: bytes(1),
      realmId: bytes(2),
      guardian: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      poseidon2ParameterHash: bytes(3),
      circuitHash: bytes(4),
      verificationKeyHash: bytes(5),
      treeDepth: 17,
      rootWindowLedgers: 1_440,
      deploymentBindingHash: bytes(6),
      contextHash: bytes(7),
      contextField: bytes(8),
    },
    meta: { actionCount, transcriptHead: bytes(marker) },
    tree: {
      nextIndex: actionCount * 2,
      frontier: Array.from({ length: 34 }, () => bytes(marker)),
      currentRoot: bytes(marker),
    },
  };
}

function reader({
  networkPassphrase = passphrase,
  oldestLedger = 1,
  latestLedger = 500,
  ledgerHashes = new Map([
    [100, deploymentCheckpoint.hash],
    [500, '50'.repeat(32)],
  ]),
  heads = [head(2)],
} = {}) {
  let headIndex = 0;
  return {
    async readNetworkPassphrase() {
      return networkPassphrase;
    },
    async readOldestLedgerSequence() {
      return oldestLedger;
    },
    async readLatestLedgerSequence() {
      return latestLedger;
    },
    async readLedgerIdentity(sequence) {
      return { sequence, hash: ledgerHashes.get(sequence) ?? '50'.repeat(32) };
    },
    async readHead() {
      return heads[Math.min(headIndex++, heads.length - 1)];
    },
  };
}

test('two RPCs corroborate network, deployment ledger, overlapping ledger, and pool head', async () => {
  const primary = reader();
  const witness = reader();
  const result = await corroboratePrivateRpcCheckpoint({
    primary,
    witness,
    expectedNetworkPassphrase: passphrase,
    deploymentCheckpoint,
  });

  assert.equal(result.commonLedger.sequence, 500);
  assert.equal(result.commonLedger.hash, '50'.repeat(32));
  assert.equal(result.head.meta.actionCount, 2);
  assert.equal(result.attempts, 1);
  assert.ok(Object.isFrozen(result));
});

test('moving contract heads settle within a bounded retry', async () => {
  const result = await corroboratePrivateRpcCheckpoint({
    primary: reader({ heads: [head(2, 2), head(3, 3)] }),
    witness: reader({ heads: [head(3, 3), head(3, 3)] }),
    expectedNetworkPassphrase: passphrase,
    deploymentCheckpoint,
    maximumHeadAttempts: 2,
  });

  assert.equal(result.attempts, 2);
  assert.equal(result.head.meta.actionCount, 3);
});

test('RPC corroboration rejects a wrong network before trusting ledger data', async () => {
  await assert.rejects(
    corroboratePrivateRpcCheckpoint({
      primary: reader(),
      witness: reader({ networkPassphrase: 'Public Global Stellar Network ; September 2015' }),
      expectedNetworkPassphrase: passphrase,
      deploymentCheckpoint,
    }),
    error => error instanceof PrivateRpcViewsDisagreeError && /network/i.test(error.message),
  );
});

test('RPC corroboration rejects mismatched overlapping ledger hashes', async () => {
  await assert.rejects(
    corroboratePrivateRpcCheckpoint({
      primary: reader(),
      witness: reader({ ledgerHashes: new Map([
        [100, deploymentCheckpoint.hash],
        [500, '51'.repeat(32)],
      ]) }),
      expectedNetworkPassphrase: passphrase,
      deploymentCheckpoint,
    }),
    error => error instanceof PrivateRpcViewsDisagreeError && /overlapping ledger/i.test(error.message),
  );
});

test('RPC corroboration rejects a witness that disagrees with the pinned deployment checkpoint', async () => {
  await assert.rejects(
    corroboratePrivateRpcCheckpoint({
      primary: reader(),
      witness: reader({ ledgerHashes: new Map([
        [100, '11'.repeat(32)],
        [500, '50'.repeat(32)],
      ]) }),
      expectedNetworkPassphrase: passphrase,
      deploymentCheckpoint,
    }),
    error => error instanceof PrivateRpcViewsDisagreeError && /deployment checkpoint/i.test(error.message),
  );
});

test('RPC corroboration tolerates primary retention limits but validates retained history', async () => {
  const rollingPrimary = reader();
  rollingPrimary.readOldestLedgerSequence = async () => deploymentCheckpoint.ledger + 1;
  rollingPrimary.readLedgerIdentity = async sequence => {
    if (sequence === deploymentCheckpoint.ledger) throw new Error('before oldest ledger');
    return { sequence, hash: '50'.repeat(32) };
  };
  const result = await corroboratePrivateRpcCheckpoint({
    primary: rollingPrimary,
    witness: reader(),
    expectedNetworkPassphrase: passphrase,
    deploymentCheckpoint,
  });
  assert.equal(result.deploymentCheckpoint.hash, deploymentCheckpoint.hash);

  await assert.rejects(
    corroboratePrivateRpcCheckpoint({
      primary: reader({ ledgerHashes: new Map([
        [100, '11'.repeat(32)],
        [500, '50'.repeat(32)],
      ]) }),
      witness: reader(),
      expectedNetworkPassphrase: passphrase,
      deploymentCheckpoint,
    }),
    error => error instanceof PrivateRpcViewsDisagreeError && /deployment checkpoint/i.test(error.message),
  );
});

test('RPC corroboration survives the deployment checkpoint aging out of both providers', async () => {
  const rollingReader = () => {
    const value = reader({ oldestLedger: deploymentCheckpoint.ledger + 1 });
    value.readLedgerIdentity = async sequence => {
      if (sequence === deploymentCheckpoint.ledger) throw new Error('before oldest ledger');
      return { sequence, hash: '50'.repeat(32) };
    };
    return value;
  };

  const result = await corroboratePrivateRpcCheckpoint({
    primary: rollingReader(),
    witness: rollingReader(),
    expectedNetworkPassphrase: passphrase,
    deploymentCheckpoint,
  });

  assert.deepEqual(result.deploymentCheckpoint, {
    sequence: deploymentCheckpoint.ledger,
    hash: deploymentCheckpoint.hash,
  });
  assert.equal(result.commonLedger.sequence, 500);
  assert.equal(result.commonLedger.hash, '50'.repeat(32));
});

test('RPC corroboration rejects a witness failure while its checkpoint is retained', async () => {
  const witness = reader();
  const readLedgerIdentity = witness.readLedgerIdentity;
  witness.readLedgerIdentity = async sequence => {
    if (sequence === deploymentCheckpoint.ledger) throw new Error('request timed out');
    return readLedgerIdentity(sequence);
  };

  await assert.rejects(
    corroboratePrivateRpcCheckpoint({
      primary: reader(),
      witness,
      expectedNetworkPassphrase: passphrase,
      deploymentCheckpoint,
    }),
    error => error instanceof PrivateRpcWitnessUnavailableError && /unavailable/i.test(error.message),
  );
});

test('RPC corroboration rejects contract heads that never agree', async () => {
  await assert.rejects(
    corroboratePrivateRpcCheckpoint({
      primary: reader({ heads: [head(2, 2)] }),
      witness: reader({ heads: [head(3, 3)] }),
      expectedNetworkPassphrase: passphrase,
      deploymentCheckpoint,
      maximumHeadAttempts: 3,
    }),
    error => error instanceof PrivateRpcViewsDisagreeError && /contract heads/i.test(error.message),
  );
});

test('RPC corroboration distinguishes witness outage from disagreement', async () => {
  const witness = reader();
  witness.readHead = async () => {
    throw new Error('offline');
  };
  await assert.rejects(
    corroboratePrivateRpcCheckpoint({
      primary: reader(),
      witness,
      expectedNetworkPassphrase: passphrase,
      deploymentCheckpoint,
    }),
    error => error instanceof PrivateRpcWitnessUnavailableError && /unavailable/i.test(error.message),
  );
});

test('RPC corroboration stops on intentional abort', async () => {
  const controller = new AbortController();
  const witness = reader();
  witness.readNetworkPassphrase = async () => {
    controller.abort();
    return passphrase;
  };
  await assert.rejects(
    corroboratePrivateRpcCheckpoint({
      primary: reader(),
      witness,
      expectedNetworkPassphrase: passphrase,
      deploymentCheckpoint,
      signal: controller.signal,
    }),
    error => error?.name === 'AbortError',
  );
});
