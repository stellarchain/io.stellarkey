import assert from 'node:assert/strict';
import test from 'node:test';
import { Address, StrKey, contract, nativeToScVal, scValToNative, xdr } from '@stellar/stellar-sdk';
import { computeAssetField, computeContextField, computeContextHash } from '@stellarkey/private-balance';
import {
  ArchiveRecordUnavailableError,
  PrivateBalanceArchiveClient,
  createCachedPrivateContractQuery,
  readCorroboratedPrivateAssetRegistry,
  readCorroboratedPrivateAssetTokenMetadata,
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

test('live contract reads reuse one loaded contract client per contract and network', async () => {
  let clientsCreated = 0;
  const calls = [];
  const query = createCachedPrivateContractQuery({
    rpcUrl: 'https://rpc.example',
    server: {},
    async createClient({ contractId, networkPassphrase }) {
      clientsCreated += 1;
      await new Promise(resolve => setTimeout(resolve, 5));
      return {
        async config(args) {
          calls.push({ contractId, networkPassphrase, method: 'config', args });
          return { result: 'config', isReadCall: true };
        },
        async tree_state(args) {
          calls.push({ contractId, networkPassphrase, method: 'tree_state', args });
          return { result: 'tree', isReadCall: true };
        },
      };
    },
  });

  const [config, tree] = await Promise.all([
    query(poolContractId, 'config', undefined, manifest.networkPassphrase),
    query(poolContractId, 'tree_state', undefined, manifest.networkPassphrase),
  ]);

  assert.equal(clientsCreated, 1);
  assert.deepEqual(config, { result: 'config', isReadCall: true });
  assert.deepEqual(tree, { result: 'tree', isReadCall: true });
  assert.deepEqual(calls, [
    {
      contractId: poolContractId,
      networkPassphrase: manifest.networkPassphrase,
      method: 'config',
      args: {},
    },
    {
      contractId: poolContractId,
      networkPassphrase: manifest.networkPassphrase,
      method: 'tree_state',
      args: {},
    },
  ]);
});

const manifest = {
  protocolVersion: 1,
  networkPassphrase: 'Test SDF Network ; September 2015',
  networkId,
  realmId,
  poolContractId,
  assetAdminAddress: account,
  deploymentBindingHash,
  artifacts: {
    r1csSha256: '0d'.repeat(32),
    vkJsonSha256: '0e'.repeat(32),
    vkBinSha256: '0f'.repeat(32),
  },
  constants: { treeDepth: 17 },
};

const recordNative = {
    action_index: 0,
    ledger_sequence: 123,
    starting_leaf_index: 0,
    action_kind: 1,
    asset_index: 0,
    asset: assetContractId,
    action_nonce: bytes(4),
    anchor_root: bytes(0),
    tree_root_after: bytes(5),
    nullifier_0: bytes(8),
    nullifier_1: bytes(9),
    output_0: {
      commitment: bytes(6),
      recipient_envelope: bytes(7, 181),
      outgoing_envelope: bytes(8, 157),
    },
    output_1: {
      commitment: bytes(10),
      recipient_envelope: bytes(11, 181),
      outgoing_envelope: bytes(12, 157),
    },
    output_2: {
      commitment: bytes(13),
      recipient_envelope: bytes(14, 181),
      outgoing_envelope: bytes(15, 157),
    },
    public_value: 5_000_000n,
    deposit_source: account,
    public_recipient: null,
};

const mapScVal = entries => xdr.ScVal.scvMap(
  Object.entries(entries).map(([key, val]) => new xdr.ScMapEntry({
    key: xdr.ScVal.scvSymbol(key),
    val,
  })),
);
const outputScVal = output => mapScVal({
  commitment: nativeToScVal(output.commitment),
  outgoing_envelope: nativeToScVal(output.outgoing_envelope),
  recipient_envelope: nativeToScVal(output.recipient_envelope),
});
const recordScVal = record => mapScVal({
  action_index: xdr.ScVal.scvU32(record.action_index),
  action_kind: xdr.ScVal.scvU32(record.action_kind),
  asset_index: xdr.ScVal.scvU32(record.asset_index),
  asset: Address.fromString(record.asset).toScVal(),
  action_nonce: nativeToScVal(record.action_nonce),
  anchor_root: nativeToScVal(record.anchor_root),
  deposit_source: Address.fromString(record.deposit_source).toScVal(),
  ledger_sequence: xdr.ScVal.scvU32(record.ledger_sequence),
  nullifier_0: nativeToScVal(record.nullifier_0),
  nullifier_1: nativeToScVal(record.nullifier_1),
  output_0: outputScVal(record.output_0),
  output_1: outputScVal(record.output_1),
  output_2: outputScVal(record.output_2),
  public_recipient: xdr.ScVal.scvVoid(),
  public_value: xdr.ScVal.scvU64(record.public_value),
  starting_leaf_index: xdr.ScVal.scvU32(record.starting_leaf_index),
  tree_root_after: nativeToScVal(record.tree_root_after),
});

test('archive client reads exact RPC network and ledger identities', async () => {
  const calls = [];
  const server = {
    async getNetwork() {
      return { passphrase: manifest.networkPassphrase };
    },
    async getHealth() {
      return { oldestLedger: 400 };
    },
    async getLatestLedger() {
      return { sequence: 500 };
    },
    async getLedgers(request) {
      calls.push(request);
      return {
        ledgers: [{
          sequence: request.startLedger,
          hash: 'ab'.repeat(32),
          ledgerCloseTime: '1700',
        }],
      };
    },
  };
  const client = new PrivateBalanceArchiveClient('https://rpc.example', manifest, server);

  assert.equal(await client.readNetworkPassphrase(), manifest.networkPassphrase);
  assert.equal(await client.readOldestLedgerSequence(), 400);
  assert.equal(await client.readLatestLedgerSequence(), 500);
  assert.deepEqual(await client.readLedgerIdentity(499), {
    sequence: 499,
    hash: 'ab'.repeat(32),
  });
  assert.deepEqual(calls, [{ startLedger: 499, pagination: { limit: 1 } }]);
});

test('sparse ledger close-time reads use bounded RPC concurrency', async () => {
  let active = 0;
  let maximumActive = 0;
  const calls = [];
  const server = {
    async getLedgers(request) {
      calls.push(request);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise(resolve => setTimeout(resolve, 8));
      active -= 1;
      return {
        ledgers: [{
          sequence: request.startLedger,
          ledgerCloseTime: String(1_700 + request.startLedger),
        }],
      };
    },
  };
  const client = new PrivateBalanceArchiveClient('https://rpc.example', manifest, server);
  const sequences = [100, 400, 700, 1_000, 1_300, 1_600];

  const closedAt = await client.readLedgerCloseTimes(sequences);

  assert.equal(calls.length, sequences.length);
  assert.equal(maximumActive, 4);
  assert.deepEqual(Object.keys(closedAt).map(Number), sequences);
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

test('asset registry and token metadata require two identical RPC views', async () => {
  const registry = {
    adminAddress: account,
    assets: [{
      index: 0,
      contractId: assetContractId,
      assetField: computeAssetField({
        kind: 1,
        payload: new Uint8Array(StrKey.decodeContract(assetContractId)),
      }),
      status: 'active',
    }],
  };
  const metadata = { name: 'Stellar Lumens', symbol: 'XLM', decimals: 7 };
  const primary = {
    async readAssetRegistry() { return registry; },
    async readAssetTokenMetadata() { return metadata; },
  };
  const witness = {
    async readAssetRegistry() { return structuredClone(registry); },
    async readAssetTokenMetadata() { return { ...metadata }; },
  };
  assert.deepEqual(await readCorroboratedPrivateAssetRegistry(primary, witness), registry);
  assert.deepEqual(
    await readCorroboratedPrivateAssetTokenMetadata(assetContractId, primary, witness),
    metadata,
  );
  witness.readAssetRegistry = async () => ({
    ...registry,
    assets: [{ ...registry.assets[0], status: 'exit-only' }],
  });
  await assert.rejects(
    () => readCorroboratedPrivateAssetRegistry(primary, witness),
    /RPC views disagree/i,
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
    async queryContract(_contractId, method, args) {
      const registeredAsset = {
        index: 0,
        asset: assetContractId,
        asset_field: computeAssetField({
          kind: 1,
          payload: new Uint8Array(StrKey.decodeContract(assetContractId)),
        }),
        status: { tag: 'Active', values: undefined },
      };
      const results = {
        config: {
          protocol_version: 1,
          network_id: Buffer.from(networkId, 'hex'),
          realm_id: Buffer.from(realmId, 'hex'),
          guardian: account,
          initial_asset_admin: account,
          poseidon2_parameter_hash: bytes(12),
          circuit_hash: bytes(13),
          verification_key_hash: bytes(15),
          tree_depth: 17,
          root_window_ledgers: 1_440,
          deployment_binding_hash: Buffer.from(deploymentBindingHash, 'hex'),
          context_hash: contextHash,
          context_field: computeContextField(contextHash),
        },
        archive_meta: {
          action_count: 1,
          transcript_head: bytes(10),
        },
        tree_state: {
          next_index: 3n,
          frontier: Array.from({ length: 34 }, () => bytes(0)),
          current_root: bytes(5),
        },
        deposits_paused: pauseResult,
        asset_admin: account,
        asset_count: 1,
        asset: args?.index === 0 ? new contract.Ok(registeredAsset) : undefined,
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
          key: keys[0],
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
  assert.equal(snapshot.tree.nextIndex, 3);
  assert.equal(await client.readDepositsPaused(), false);
  assert.deepEqual(await client.readAssetRegistry(), {
    adminAddress: account,
    assets: [{
      index: 0,
      contractId: assetContractId,
      assetField: computeAssetField({
        kind: 1,
        payload: new Uint8Array(StrKey.decodeContract(assetContractId)),
      }),
      status: 'active',
    }],
  });
  pauseResult = 'false';
  await assert.rejects(() => client.readDepositsPaused(), /valid read-only result/);
  pauseResult = true;
  pauseReadOnly = false;
  await assert.rejects(() => client.readDepositsPaused(), /valid read-only result/);

  manifest.artifacts.r1csSha256 = 'ff'.repeat(32);
  await assert.rejects(() => client.readHead(), /configuration does not match the manifest/i);
  manifest.artifacts.r1csSha256 = '0d'.repeat(32);

  const records = await client.readRecords(0, 1);
  assert.equal(records[0].actionIndex, 0);
  assert.equal(records[0].publicValue, 5_000_000n);
  assert.equal(records[0].outputs.length, 3);
  assert.deepEqual(records[0].outputs.map(output => output.cm), [
    recordNative.output_0.commitment,
    recordNative.output_1.commitment,
    recordNative.output_2.commitment,
  ]);
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

test('archive client reports the lowest missing requested record by ledger key', async () => {
  const server = {
    async getLedgerEntries(...keys) {
      return {
        latestLedger: 500,
        entries: [2, 1].map(offset => ({
          key: keys[offset],
          liveUntilLedgerSeq: 1_000,
          val: {
            type: 'contractData',
            contractData: {
              val: recordScVal({
                ...recordNative,
                action_index: 10 + offset,
                starting_leaf_index: (10 + offset) * 3,
              }),
            },
          },
        })),
      };
    },
  };
  const client = new PrivateBalanceArchiveClient('https://rpc.example', manifest, server);

  await assert.rejects(
    () => client.readRecords(10, 3),
    error => error instanceof ArchiveRecordUnavailableError && error.actionIndex === 10,
  );
});
