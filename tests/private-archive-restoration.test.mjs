import assert from 'node:assert/strict';
import test from 'node:test';

import {
  Account,
  Keypair,
  SorobanDataBuilder,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import {
  preparePrivateArchiveRestoration,
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

test('archive restoration reviews one exact locally derived record key', async () => {
  const signer = Keypair.random();
  const actionIndex = 41;
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
    actionIndex,
    classicFeeStroops: 100n,
    maximumResourceFeeStroops: 1_000n,
    nowSeconds: 10,
  });

  assert.equal(prepared.actionIndex, actionIndex);
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
      const simulation = exactSimulation(41);
      simulation.transactionData = new SorobanDataBuilder()
        .setFootprint([], [
          deriveArchiveRecordLedgerKey(poolContractId, 41),
          deriveArchiveRecordLedgerKey(poolContractId, 42),
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
      actionIndex: 41,
      classicFeeStroops: 100n,
      maximumResourceFeeStroops: 1_000n,
    }),
    /exact archive record/i,
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
        return exactSimulation(41);
      },
    },
    manifest: { networkPassphrase, poolContractId },
    source: signer.publicKey(),
    actionIndex: 41,
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
        return exactSimulation(41);
      },
    },
    manifest: { networkPassphrase, poolContractId },
    source: signer.publicKey(),
    actionIndex: 41,
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
