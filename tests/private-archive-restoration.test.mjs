import assert from 'node:assert/strict';
import test from 'node:test';

import {
  Account,
  Keypair,
  SorobanDataBuilder,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import {
  findContiguousPrivateArchiveRestorationRange,
  preparePrivateArchiveRestoration,
  restorePrivateArchiveRange,
  submitPrivateArchiveRestoration,
} from '../src/features/private-balance/runtime/archive-restoration.ts';
import { deriveArchiveRecordLedgerKey } from '../src/features/private-balance/runtime/archive-client.ts';

const networkPassphrase = 'Test SDF Network ; September 2015';
const poolContractId = 'CAW3KALAASOWXXMKSDYPZ7STK5J2N6TOGAMJLRMSUQHCYXTRFDRVHVU6';

function exactSimulation(actionIndex, resourceFee = '500') {
  const key = deriveArchiveRecordLedgerKey(poolContractId, actionIndex);
  return {
    _parsed: true,
    id: 'restore-simulation',
    latestLedger: 123,
    events: [],
    transactionData: new SorobanDataBuilder()
      .setFootprint([], [key])
      .setResourceFee(resourceFee),
    minResourceFee: resourceFee,
  };
}

function transactionFootprint(transaction) {
  return new SorobanDataBuilder(transaction.toEnvelope().value.tx.ext.value);
}

function requestedKeys(transaction) {
  return transactionFootprint(transaction).getReadWrite().map(key => key.toXDR('base64'));
}

function exactBatchSimulation(transaction, resourceFee = '500', latestLedger = 123) {
  return {
    _parsed: true,
    id: 'restore-batch-simulation',
    latestLedger,
    events: [],
    transactionData: new SorobanDataBuilder()
      .setFootprint([], transactionFootprint(transaction).getReadWrite())
      .setResourceFee(resourceFee),
    minResourceFee: resourceFee,
  };
}

test('archive restoration discovers only the contiguous unavailable prefix', async () => {
  const keys = Array.from({ length: 6 }, (_, offset) =>
    deriveArchiveRecordLedgerKey(poolContractId, 41n + BigInt(offset)));
  const range = await findContiguousPrivateArchiveRestorationRange({
    rpc: {
      async getLedgerEntries(...requested) {
        assert.deepEqual(
          requested.map(key => key.toXDR('base64')),
          keys.map(key => key.toXDR('base64')),
        );
        return {
          entries: [
            { key: keys[5], liveUntilLedgerSeq: 456 },
            { key: keys[0], liveUntilLedgerSeq: 0 },
            { key: keys[3], liveUntilLedgerSeq: 456 },
            { key: keys[4], liveUntilLedgerSeq: 456 },
          ],
          latestLedger: 123,
        };
      },
    },
    poolContractId,
    startActionIndex: 41n,
    endActionIndexExclusive: 47n,
  });

  assert.deepEqual(range, {
    startActionIndex: 41n,
    endActionIndexExclusive: 44n,
    probedEndActionIndexExclusive: 47n,
    latestLedger: 123,
  });
  assert.ok(Object.isFrozen(range));
});

test('archive restoration discovery rejects keys outside its local probe', async () => {
  await assert.rejects(
    findContiguousPrivateArchiveRestorationRange({
      rpc: {
        async getLedgerEntries() {
          return {
            entries: [{ key: deriveArchiveRecordLedgerKey(poolContractId, 99n) }],
            latestLedger: 123,
          };
        },
      },
      poolContractId,
      startActionIndex: 41n,
      endActionIndexExclusive: 43n,
    }),
    /unexpected archive record/i,
  );
});

test('archive restoration preparation refuses indices outside the canonical action count', async () => {
  const signer = Keypair.random();
  let accountRequested = false;

  await assert.rejects(
    preparePrivateArchiveRestoration({
      rpc: {
        async getAccount() {
          accountRequested = true;
          return new Account(signer.publicKey(), '7');
        },
        async simulateTransaction(transaction) {
          return exactBatchSimulation(transaction);
        },
      },
      manifest: { networkPassphrase, poolContractId },
      source: signer.publicKey(),
      startActionIndex: 41n,
      actionCount: 42n,
      maximumActionCount: 2,
      classicFeeStroops: 100n,
      maximumResourceFeeStroops: 1_000n,
    }),
    /canonical action count/i,
  );
  assert.equal(accountRequested, false);
});

test('archive restoration reviews one exact locally derived record key', async () => {
  const signer = Keypair.random();
  const actionIndex = 41n;
  const expectedKey = deriveArchiveRecordLedgerKey(poolContractId, actionIndex).toXDR('base64');
  const rpc = {
    async getAccount(address) {
      assert.equal(address, signer.publicKey());
      return new Account(address, '7');
    },
    async simulateTransaction(transaction) {
      assert.equal(transaction.operations.length, 1);
      assert.equal(transaction.operations[0].type, 'restoreFootprint');
      const data = new SorobanDataBuilder(transaction.toEnvelope().value.tx.ext.value);
      assert.deepEqual(data.getReadOnly(), []);
      assert.deepEqual(data.getReadWrite().map(key => key.toXDR('base64')), [expectedKey]);
      return exactSimulation(actionIndex);
    },
  };

  const prepared = await preparePrivateArchiveRestoration({
    rpc,
    manifest: { networkPassphrase, poolContractId },
    source: signer.publicKey(),
    startActionIndex: actionIndex,
    actionCount: actionIndex + 1n,
    maximumActionCount: 1,
    classicFeeStroops: 100n,
    maximumResourceFeeStroops: 1_000n,
    nowSeconds: 10,
  });

  assert.deepEqual(prepared.actionIndices, [actionIndex]);
  assert.equal(prepared.review.classicFeeStroops, 100n);
  assert.equal(prepared.review.resourceFeeStroops, 500n);
  assert.equal(prepared.review.expiresAt, 310);
  assert.match(prepared.review.transactionHash, /^[0-9a-f]{64}$/);
});

test('archive restoration rejects an RPC-expanded footprint', async () => {
  const signer = Keypair.random();
  const rpc = {
    async getAccount() {
      return new Account(signer.publicKey(), '7');
    },
    async simulateTransaction() {
      const simulation = exactSimulation(41n);
      simulation.transactionData = new SorobanDataBuilder()
        .setFootprint([], [
          deriveArchiveRecordLedgerKey(poolContractId, 41n),
          deriveArchiveRecordLedgerKey(poolContractId, 42n),
        ])
        .setResourceFee('500');
      return simulation;
    },
  };

  await assert.rejects(
    preparePrivateArchiveRestoration({
      rpc,
      manifest: { networkPassphrase, poolContractId },
      source: signer.publicKey(),
      startActionIndex: 41n,
      actionCount: 51n,
      maximumActionCount: 1,
      classicFeeStroops: 100n,
      maximumResourceFeeStroops: 1_000n,
    }),
    /exact locally derived archive restoration footprint/i,
  );
});

test('archive restoration binds signed submission and confirmation to its hash', async () => {
  const signer = Keypair.random();
  const prepared = await preparePrivateArchiveRestoration({
    rpc: {
      async getAccount() {
        return new Account(signer.publicKey(), '7');
      },
      async simulateTransaction() {
        return exactSimulation(41n);
      },
    },
    manifest: { networkPassphrase, poolContractId },
    source: signer.publicKey(),
    startActionIndex: 41n,
    actionCount: 51n,
    maximumActionCount: 1,
    classicFeeStroops: 100n,
    maximumResourceFeeStroops: 1_000n,
    nowSeconds: 10,
  });
  const events = [];

  const result = await submitPrivateArchiveRestoration({
    review: prepared.review,
    networkPassphrase,
    sign: async request => {
      events.push('sign');
      assert.equal(request.expectedTransactionHash, prepared.review.transactionHash);
      const transaction = TransactionBuilder.fromXdr(request.envelopeXdr, networkPassphrase);
      transaction.sign(signer);
      return transaction.toXdr();
    },
    rpc: {
      async sendTransaction(transaction) {
        events.push('send');
        assert.equal(
          Array.from(transaction.hash(), byte => byte.toString(16).padStart(2, '0')).join(''),
          prepared.review.transactionHash,
        );
        return { status: 'PENDING', hash: prepared.review.transactionHash };
      },
      async getTransaction(hash) {
        events.push('confirm');
        return { status: 'SUCCESS', txHash: hash };
      },
    },
    delays: [0],
    sleep: async () => undefined,
    nowSeconds: 11,
  });

  assert.deepEqual(events, ['sign', 'send', 'confirm']);
  assert.deepEqual(result, { transactionHash: prepared.review.transactionHash });
});

test('archive restoration refuses a mismatched confirmation hash', async () => {
  const signer = Keypair.random();
  const prepared = await preparePrivateArchiveRestoration({
    rpc: {
      async getAccount() {
        return new Account(signer.publicKey(), '7');
      },
      async simulateTransaction() {
        return exactSimulation(41n);
      },
    },
    manifest: { networkPassphrase, poolContractId },
    source: signer.publicKey(),
    startActionIndex: 41n,
    actionCount: 51n,
    maximumActionCount: 1,
    classicFeeStroops: 100n,
    maximumResourceFeeStroops: 1_000n,
    nowSeconds: 10,
  });

  await assert.rejects(
    submitPrivateArchiveRestoration({
      review: prepared.review,
      networkPassphrase,
      sign: async request => {
        const transaction = TransactionBuilder.fromXdr(request.envelopeXdr, networkPassphrase);
        transaction.sign(signer);
        return transaction.toXdr();
      },
      rpc: {
        async sendTransaction() {
          return { status: 'PENDING', hash: prepared.review.transactionHash };
        },
        async getTransaction() {
          return { status: 'SUCCESS', txHash: 'f'.repeat(64) };
        },
      },
      delays: [0],
      sleep: async () => undefined,
      nowSeconds: 11,
    }),
    /different archive restoration hash/i,
  );
});

test('archive restoration selects the largest safe prefix and freshly simulates it', async () => {
  const signer = Keypair.random();
  const calls = [];
  const rpc = {
    async getAccount(address) {
      assert.equal(address, signer.publicKey());
      return new Account(address, '7');
    },
    async simulateTransaction(transaction) {
      const count = requestedKeys(transaction).length;
      calls.push(count);
      if (count > 6) {
        return { _parsed: true, id: 'too-large', latestLedger: 123, events: [], error: 'limit' };
      }
      return exactBatchSimulation(transaction, String(count * 100));
    },
  };

  const prepared = await preparePrivateArchiveRestoration({
    rpc,
    manifest: { networkPassphrase, poolContractId },
    source: signer.publicKey(),
    startActionIndex: 41n,
    actionCount: 51n,
    maximumActionCount: 10,
    classicFeeStroops: 100n,
    maximumResourceFeeStroops: 1_000n,
    nowSeconds: 10,
  });

  assert.deepEqual(calls, [1, 2, 4, 8, 6, 7, 6]);
  assert.deepEqual(prepared.actionIndices, [41n, 42n, 43n, 44n, 45n, 46n]);
  assert.deepEqual(
    prepared.review.ledgerKeysXdr,
    prepared.actionIndices.map(actionIndex =>
      deriveArchiveRecordLedgerKey(poolContractId, actionIndex).toXDR('base64')),
  );
  assert.equal(prepared.review.resourceFeeStroops, 600n);
  assert.ok(Object.isFrozen(prepared.actionIndices));
  assert.ok(Object.isFrozen(prepared.review.ledgerKeysXdr));
});

test('archive restoration bisects resource overflow with an explicit 80% margin', async () => {
  const signer = Keypair.random();
  const calls = [];
  const prepared = await preparePrivateArchiveRestoration({
    rpc: {
      async getAccount() {
        return new Account(signer.publicKey(), '7');
      },
      async simulateTransaction(transaction) {
        const count = requestedKeys(transaction).length;
        calls.push(count);
        return exactBatchSimulation(transaction, String(count * 150));
      },
    },
    manifest: { networkPassphrase, poolContractId },
    source: signer.publicKey(),
    startActionIndex: 41n,
    actionCount: 51n,
    maximumActionCount: 8,
    classicFeeStroops: 100n,
    maximumResourceFeeStroops: 1_000n,
    nowSeconds: 10,
  });

  assert.deepEqual(calls, [1, 2, 4, 8, 6, 5, 5]);
  assert.deepEqual(prepared.actionIndices, [41n, 42n, 43n, 44n, 45n]);
  assert.equal(prepared.review.resourceFeeStroops, 750n);
});

test('archive restoration falls back to one key and reports a one-key failure', async () => {
  const signer = Keypair.random();
  const calls = [];
  const base = {
    manifest: { networkPassphrase, poolContractId },
    source: signer.publicKey(),
    startActionIndex: 41n,
    actionCount: 51n,
    maximumActionCount: 4,
    classicFeeStroops: 100n,
    maximumResourceFeeStroops: 1_000n,
    nowSeconds: 10,
  };
  const prepared = await preparePrivateArchiveRestoration({
    ...base,
    rpc: {
      async getAccount() {
        return new Account(signer.publicKey(), '7');
      },
      async simulateTransaction(transaction) {
        const count = requestedKeys(transaction).length;
        calls.push(count);
        return count === 1
          ? exactBatchSimulation(transaction, '700')
          : { _parsed: true, id: 'too-large', latestLedger: 123, events: [], error: 'limit' };
      },
    },
  });
  assert.deepEqual(calls, [1, 2, 1]);
  assert.deepEqual(prepared.actionIndices, [41n]);

  await assert.rejects(
    preparePrivateArchiveRestoration({
      ...base,
      maximumActionCount: 1,
      rpc: {
        async getAccount() {
          return new Account(signer.publicKey(), '7');
        },
        async simulateTransaction() {
          return { _parsed: true, id: 'failed', latestLedger: 123, events: [], error: 'one failed' };
        },
      },
    }),
    /one failed/i,
  );
});

test('archive restoration rejects an RPC-expanded or reordered batch footprint', async () => {
  const signer = Keypair.random();
  await assert.rejects(
    preparePrivateArchiveRestoration({
      rpc: {
        async getAccount() {
          return new Account(signer.publicKey(), '7');
        },
        async simulateTransaction(transaction) {
          const keys = transactionFootprint(transaction).getReadWrite();
          return {
            ...exactBatchSimulation(transaction),
            transactionData: new SorobanDataBuilder()
              .setFootprint([], [
                ...keys.toReversed(),
                deriveArchiveRecordLedgerKey(poolContractId, 99n),
              ])
              .setResourceFee('500'),
          };
        },
      },
      manifest: { networkPassphrase, poolContractId },
      source: signer.publicKey(),
      startActionIndex: 41n,
      actionCount: 51n,
      maximumActionCount: 2,
      classicFeeStroops: 100n,
      maximumResourceFeeStroops: 1_000n,
    }),
    /exact locally derived archive restoration footprint/i,
  );
});

test('archive restoration rejects a selected batch whose fresh simulation changed', async () => {
  const signer = Keypair.random();
  let calls = 0;
  await assert.rejects(
    preparePrivateArchiveRestoration({
      rpc: {
        async getAccount() {
          return new Account(signer.publicKey(), '7');
        },
        async simulateTransaction(transaction) {
          calls += 1;
          return exactBatchSimulation(transaction, calls === 4 ? '801' : '500');
        },
      },
      manifest: { networkPassphrase, poolContractId },
      source: signer.publicKey(),
      startActionIndex: 41n,
      actionCount: 51n,
      maximumActionCount: 4,
      classicFeeStroops: 100n,
      maximumResourceFeeStroops: 1_000n,
    }),
    /fresh archive restoration simulation/i,
  );
  assert.equal(calls, 4);
});

test('archive restoration aborts intentional cancellation between simulations', async () => {
  const signer = Keypair.random();
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(
    preparePrivateArchiveRestoration({
      rpc: {
        async getAccount() {
          return new Account(signer.publicKey(), '7');
        },
        async simulateTransaction(transaction) {
          calls += 1;
          controller.abort();
          return exactBatchSimulation(transaction, '100');
        },
      },
      manifest: { networkPassphrase, poolContractId },
      source: signer.publicKey(),
      startActionIndex: 41n,
      actionCount: 51n,
      maximumActionCount: 8,
      classicFeeStroops: 100n,
      maximumResourceFeeStroops: 1_000n,
      signal: controller.signal,
    }),
    error => error?.name === 'AbortError',
  );
  assert.equal(calls, 1);
});

test('confirmed restoration prefixes report durable resume cursors', async () => {
  const progress = [];
  let failedOnce = false;
  const prepare = async ({ startActionIndex, maximumActionCount }) => ({
    actionIndices: Object.freeze(
      Array.from({ length: Math.min(2, maximumActionCount) }, (_, offset) =>
        startActionIndex + BigInt(offset)),
    ),
    review: { startActionIndex },
    simulationLedger: 123,
  });
  const submit = async review => {
    if (review.startActionIndex === 12n && !failedOnce) {
      failedOnce = true;
      throw new Error('temporary failure');
    }
  };

  await assert.rejects(
    restorePrivateArchiveRange({
      startActionIndex: 10n,
      endActionIndexExclusive: 16n,
      prepare,
      submit,
      onProgress: update => progress.push(update),
    }),
    /temporary failure/,
  );
  assert.equal(progress.at(-1).nextActionIndex, 12n);

  await restorePrivateArchiveRange({
    startActionIndex: progress.at(-1).nextActionIndex,
    endActionIndexExclusive: 16n,
    prepare,
    submit,
    onProgress: update => progress.push(update),
  });
  assert.deepEqual(progress.map(update => update.nextActionIndex), [12n, 14n, 16n]);
});

test('archive restoration cancellation stops confirmation polling', async () => {
  const signer = Keypair.random();
  const prepared = await preparePrivateArchiveRestoration({
    rpc: {
      async getAccount() {
        return new Account(signer.publicKey(), '7');
      },
      async simulateTransaction() {
        return exactSimulation(41n);
      },
    },
    manifest: { networkPassphrase, poolContractId },
    source: signer.publicKey(),
    startActionIndex: 41n,
    actionCount: 51n,
    maximumActionCount: 1,
    classicFeeStroops: 100n,
    maximumResourceFeeStroops: 1_000n,
    nowSeconds: 10,
  });
  const controller = new AbortController();
  let confirmationCalls = 0;

  await assert.rejects(
    submitPrivateArchiveRestoration({
      review: prepared.review,
      networkPassphrase,
      sign: async request => {
        const transaction = TransactionBuilder.fromXdr(request.envelopeXdr, networkPassphrase);
        transaction.sign(signer);
        return transaction.toXdr();
      },
      rpc: {
        async sendTransaction() {
          return { status: 'PENDING', hash: prepared.review.transactionHash };
        },
        async getTransaction() {
          confirmationCalls += 1;
          return { status: 'NOT_FOUND' };
        },
      },
      delays: [1],
      sleep: async () => controller.abort(),
      signal: controller.signal,
      nowSeconds: 11,
    }),
    error => error?.name === 'AbortError',
  );
  assert.equal(confirmationCalls, 0);
});
