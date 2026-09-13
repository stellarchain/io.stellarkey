import assert from 'node:assert/strict';
import test from 'node:test';

import { executePrivateAssetAdminAction } from '../src/features/private-balance/runtime/asset-admin.ts';

const POOL = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';
const ASSET = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';
const ADMIN = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const NETWORK = 'Test SDF Network ; September 2015';
const HASH = 'ab'.repeat(32);

function harness() {
  const calls = [];
  const stages = [];
  const createClient = async options => ({
    add_asset: async input => {
      calls.push(['add', input]);
      return assembled(options);
    },
    set_asset_status: async input => {
      calls.push(['status', input]);
      return assembled(options);
    },
  });
  const assembled = options => ({
    sign: async () => {
      const signed = await options.signTransaction('AAAA', {
        networkPassphrase: NETWORK,
        address: ADMIN,
      });
      assert.equal(signed.signedTxXdr, 'BBBB');
    },
    send: async watcher => {
      watcher.onSubmitted();
      return {
        sendTransactionResponse: { hash: HASH },
        getTransactionResponse: { status: 'SUCCESS', txHash: HASH },
      };
    },
  });
  return { calls, stages, createClient };
}

test('asset admin adds a valid SAC through exact reviewed signing stages', async () => {
  const { calls, stages, createClient } = harness();
  const result = await executePrivateAssetAdminAction({
    action: { type: 'add', contractId: ASSET },
    poolContractId: POOL,
    adminPublicKey: ADMIN,
    networkPassphrase: NETWORK,
    rpcUrl: 'https://rpc.example',
    sign: async request => {
      assert.equal(request.expectedTransactionHash, HASH);
      assert.equal(request.envelopeXdr, 'AAAA');
      return 'BBBB';
    },
    onStage: stage => stages.push(stage),
  }, {
    createClient,
    transactionHash: () => HASH,
  });
  assert.deepEqual(calls, [['add', { asset: ASSET }]]);
  assert.deepEqual(stages, ['preparing', 'signing', 'submitting', 'pending', 'confirmed']);
  assert.equal(result.transactionHash, HASH);
});

test('asset admin changes state without exposing a delete operation', async () => {
  const { calls, createClient } = harness();
  await executePrivateAssetAdminAction({
    action: { type: 'status', index: 7, status: 'exit-only' },
    poolContractId: POOL,
    adminPublicKey: ADMIN,
    networkPassphrase: NETWORK,
    rpcUrl: 'https://rpc.example',
    sign: async () => 'BBBB',
  }, { createClient, transactionHash: () => HASH });
  assert.deepEqual(calls, [['status', {
    index: 7,
    status: { tag: 'ExitOnly', values: undefined },
  }]]);
});

test('asset admin rejects invalid contracts before simulation or signing', async () => {
  let called = false;
  await assert.rejects(executePrivateAssetAdminAction({
    action: { type: 'add', contractId: 'not-a-contract' },
    poolContractId: POOL,
    adminPublicKey: ADMIN,
    networkPassphrase: NETWORK,
    rpcUrl: 'https://rpc.example',
    sign: async () => {
      called = true;
      return '';
    },
  }), /valid Stellar contract/iu);
  assert.equal(called, false);
});
