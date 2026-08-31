import assert from 'node:assert/strict';
import test from 'node:test';
import { Address, StrKey, nativeToScVal, scValToNative, xdr } from '@stellar/stellar-sdk';
import { computeContextField, computeContextHash } from '@stellarkey/private-balance';
import {
  ArchiveRecordUnavailableError,
  PrivateBalanceArchiveClient,
} from '../src/features/private-balance/runtime/archive-client.ts';

const networkId = '01'.repeat(32);
const realmId = '02'.repeat(32);
const poolContractId = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAITA4';
const assetContractId = 'CBUSYNQKASUYFWYC3M2GUEDMX4AIVWPALDBYJPNK6554BREHTGZ2IUNF';
const deploymentBindingHash = '03'.repeat(32);
const contextHash = computeContextHash(
  1,
  Buffer.from(networkId, 'hex'),
  Buffer.from(realmId, 'hex'),
  StrKey.decodeContract(poolContractId),
);
const bytes = (value, length = 32) => new Uint8Array(length).fill(value);
const account = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

const manifest = {
  protocolVersion: 1,
  networkPassphrase: 'Test SDF Network ; September 2015',
  networkId,
  realmId,
  poolContractId,
  deploymentBindingHash,
  constants: { treeDepth: 32, pageCapacity: 32 },
};

const recordNative = {
    action_index: 0,
    ledger_sequence: 123,
    starting_leaf_index: 0,
    action_kind: 1,
    asset: assetContractId,
    action_nonce: bytes(4),
    anchor_root: bytes(0),
    tree_root_after: bytes(5),
    nullifier_0: bytes(0),
    nullifier_1: bytes(0),
    output_0: { commitment: bytes(6), recipient_envelope: bytes(7, 181) },
    output_1: { commitment: bytes(0), recipient_envelope: bytes(0, 181) },
    public_value: 5_000_000n,
    deposit_source: account,
    public_recipient: null,
    relayer_fee: 0n,
    relayer: null,
};

const mapScVal = entries => xdr.ScVal.scvMap(
  Object.entries(entries).map(([key, val]) => new xdr.ScMapEntry({
    key: xdr.ScVal.scvSymbol(key),
    val,
  })),
);
const outputScVal = output => mapScVal({
  commitment: nativeToScVal(output.commitment),
  recipient_envelope: nativeToScVal(output.recipient_envelope),
});
const recordScVal = record => mapScVal({
  action_index: xdr.ScVal.scvU32(record.action_index),
  action_kind: xdr.ScVal.scvU32(record.action_kind),
  asset: Address.fromString(record.asset).toScVal(),
  action_nonce: nativeToScVal(record.action_nonce),
  anchor_root: nativeToScVal(record.anchor_root),
  deposit_source: Address.fromString(record.deposit_source).toScVal(),
  ledger_sequence: xdr.ScVal.scvU32(record.ledger_sequence),
  nullifier_0: nativeToScVal(record.nullifier_0),
  nullifier_1: nativeToScVal(record.nullifier_1),
  output_0: outputScVal(record.output_0),
  output_1: outputScVal(record.output_1),
  public_recipient: xdr.ScVal.scvVoid(),
  public_value: xdr.ScVal.scvU64(record.public_value),
  relayer: xdr.ScVal.scvVoid(),
  relayer_fee: xdr.ScVal.scvU64(record.relayer_fee),
  starting_leaf_index: xdr.ScVal.scvU32(record.starting_leaf_index),
  tree_root_after: nativeToScVal(record.tree_root_after),
});

test('archive client reads the public asset balance through a read-only SAC call', async () => {
  const calls = [];
  const server = {
    async getLatestLedger() {
      return { sequence: 500 };
    },
    async queryContract(contractId, method, args, networkPassphrase) {
      calls.push({ contractId, method, args, networkPassphrase });
      return { result: 2_500_000_000n, isReadCall: true };
    },
    async getLedgerEntries() {
      return { entries: [], latestLedger: 500 };
    },
  };
  const client = new PrivateBalanceArchiveClient('https://rpc.example', manifest, server);

  assert.equal(await client.readAssetBalance(assetContractId, account), 2_500_000_000n);
  assert.deepEqual(calls, [{
    contractId: assetContractId,
    method: 'balance',
    args: { id: account },
    networkPassphrase: manifest.networkPassphrase,
  }]);
});

test('archive client rejects a non-read-only public asset balance response', async () => {
  const server = {
    async getLatestLedger() {
      return { sequence: 500 };
    },
    async queryContract() {
      return { result: 0n, isReadCall: false };
    },
    async getLedgerEntries() {
      return { entries: [], latestLedger: 500 };
    },
  };
  const client = new PrivateBalanceArchiveClient('https://rpc.example', manifest, server);

  await assert.rejects(
    () => client.readAssetBalance(assetContractId, account),
    /balance query was not a valid read-only result/i,
  );
});

test('archive client reads manifest-bound state and canonical record storage keys', async () => {
  const requestedKeys = [];
  let includeRecord = true;
  let returnKnownRoot = false;
  let pauseResult = false;
  let pauseReadOnly = true;
  const server = {
    async getLatestLedger() {
      return { sequence: 500 };
    },
    async queryContract(_contractId, method) {
      const results = {
        config: {
          protocol_version: 1,
          network_id: Buffer.from(networkId, 'hex'),
          realm_id: Buffer.from(realmId, 'hex'),
          guardian: account,
          poseidon2_parameter_hash: bytes(12),
          circuit_hash: bytes(13),
          verification_key_hash: bytes(14),
          tree_depth: 32,
          root_window_ledgers: 1_440,
          page_capacity: 32,
          deployment_binding_hash: Buffer.from(deploymentBindingHash, 'hex'),
          context_hash: contextHash,
          context_field: computeContextField(contextHash),
        },
        archive_meta: {
          action_count: 1,
          transcript_head: bytes(10),
        },
        tree_state: {
          next_index: 2n,
          frontier: Array.from({ length: 32 }, () => bytes(0)),
          current_root: bytes(5),
        },
        deposits_paused: pauseResult,
      };
      return {
        result: results[method],
        isReadCall: method === 'deposits_paused' ? pauseReadOnly : true,
      };
    },
    async getLedgerEntries(...keys) {
      requestedKeys.push(...keys);
      if (returnKnownRoot) {
        return {
          latestLedger: 500,
          entries: [{
            liveUntilLedgerSeq: 1_550,
            val: {
              type: 'contractData',
              contractData: { val: mapScVal({
                created_at_ledger: xdr.ScVal.scvU32(100),
                valid_until_ledger: xdr.ScVal.scvU32(1_540),
              }) },
            },
          }],
        };
      }
      return {
        latestLedger: 500,
        entries: includeRecord ? [{
          val: {
            type: 'contractData',
            contractData: { val: recordScVal(recordNative) },
          },
        }] : [],
      };
    },
  };
  const client = new PrivateBalanceArchiveClient(
    'https://soroban-testnet.stellar.org',
    manifest,
    server,
  );

  const snapshot = await client.readHead();
  assert.equal(snapshot.latestLedger, 500);
  assert.equal(snapshot.meta.actionCount, 1);
  assert.equal(snapshot.tree.nextIndex, 2);
  assert.equal(await client.readDepositsPaused(), false);
  pauseResult = 'false';
  await assert.rejects(() => client.readDepositsPaused(), /valid read-only result/);
  pauseResult = true;
  pauseReadOnly = false;
  await assert.rejects(() => client.readDepositsPaused(), /valid read-only result/);

  const records = await client.readRecords(0, 1);
  assert.equal(records[0].actionIndex, 0);
  assert.equal(records[0].publicValue, 5_000_000n);
  assert.deepEqual(records[0].depositSource, {
    kind: 0,
    payload: new Uint8Array(StrKey.decodeEd25519PublicKey(account)),
  });
  assert.deepEqual(
    scValToNative(requestedKeys[0].contractData.key),
    ['ArchiveRecord', 0],
  );

  returnKnownRoot = true;
  assert.deepEqual(await client.readKnownRoot(bytes(5)), {
    createdAtLedger: 100,
    validUntilLedger: 1_540,
    liveUntilLedger: 1_550,
    latestLedger: 500,
  });
  assert.deepEqual(
    scValToNative(requestedKeys[1].contractData.key),
    ['KnownRoot', bytes(5)],
  );

  returnKnownRoot = false;
  includeRecord = false;
  await assert.rejects(
    () => client.readRecords(0, 1),
    error => error instanceof ArchiveRecordUnavailableError && error.actionIndex === 0,
  );
});
