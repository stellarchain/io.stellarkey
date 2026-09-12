import assert from 'node:assert/strict';
import test from 'node:test';
import { Address, Contract, SorobanDataBuilder, contract, scValToNative, xdr } from '@stellar/stellar-sdk';
import {
  PrivateBalanceArchiveClient,
  createCachedPrivateContractQuery,
} from '../src/features/private-balance/runtime/archive-client.ts';

// Non-usable, synthetic ledger fixtures only. Exercise the installed SDK's
// assembly and read classification; no wallet, network, signing or submission.
const contractId = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAITA4';
const networkPassphrase = 'Test SDF Network ; September 2015';
const rpcUrl = 'https://rpc.example';

function fixture({ paused = false, indices = [0, 1], modify = () => {} } = {}) {
  const codeHash = new Uint8Array(32).fill(7);
  const instanceKey = xdr.LedgerKey.contractData(new xdr.LedgerKeyContractData({
    contract: Address.fromString(contractId).toScAddress(),
    key: xdr.ScVal.scvLedgerKeyContractInstance(),
    durability: xdr.ContractDataDurability.persistent,
  }));
  const codeKey = xdr.LedgerKey.contractCode(new xdr.LedgerKeyContractCode({ hash: codeHash }));
  const keys = [instanceKey, codeKey];
  const values = [
    xdr.LedgerEntryData.contractData(new xdr.ContractDataEntry({
      ext: xdr.ExtensionPoint.v0(),
      ...instanceKey.contractData,
      val: xdr.ScVal.scvContractInstance(new xdr.ScContractInstance({
        executable: xdr.ContractExecutable.contractExecutableWasm(codeHash),
        storage: [],
      })),
    })),
    xdr.LedgerEntryData.contractCode(new xdr.ContractCodeEntry({
      ext: xdr.ContractCodeEntryExt.v0(), hash: codeHash, code: new Uint8Array([0, 97]),
    })),
  ];
  const baseData = new SorobanDataBuilder().setReadWrite(keys).build();
  const simulation = {
    _parsed: true,
    id: 'synthetic',
    latestLedger: 500,
    events: [],
    minResourceFee: '100',
    result: { auth: [], retval: xdr.ScVal.scvBool(paused) },
    transactionData: new SorobanDataBuilder(new xdr.SorobanTransactionData({
      ...baseData,
      ext: xdr.SorobanTransactionDataExt.resourceExt(new xdr.SorobanResourcesExtV0({
        archivedSorobanEntries: indices,
      })),
    })),
    stateChanges: keys.map((key, index) => ({
      type: 'created', key, before: null,
      after: new xdr.LedgerEntry({
        lastModifiedLedgerSeq: 500, data: values[index], ext: xdr.LedgerEntryExt.v0(),
      }),
    })),
  };
  const ledger = {
    latestLedger: 500,
    entries: keys.map((key, index) => ({ key, val: values[index], liveUntilLedgerSeq: 0 })),
  };
  modify({ simulation, ledger, keys, values });
  let ledgerReads = 0;
  let simulations = 0;
  let assembled;
  const server = {
    async simulateTransaction() { simulations += 1; return simulation; },
    async getLedgerEntries(...requested) {
      ledgerReads += 1;
      assert.equal(requested.length, keys.length);
      return ledger;
    },
    async sendTransaction() { assert.fail('Read queries must never submit'); },
  };
  const query = createCachedPrivateContractQuery({
    rpcUrl, server,
    async createClient() {
      return {
        async deposits_paused(options) {
          assert.equal(options.restore, false);
          assembled = await contract.AssembledTransaction.build({
            rpcUrl, contractId, networkPassphrase, server,
            ...options,
            method: 'deposits_paused', args: [], parseResultXdr: scValToNative,
            signTransaction: async () => { assert.fail('Read queries must never sign'); },
          });
          return assembled;
        },
      };
    },
  });
  const client = new PrivateBalanceArchiveClient(rpcUrl, { poolContractId: contractId, networkPassphrase }, {
    ...server, queryContract: query,
  });
  return { client, query, server, simulation, ledger, counts: () => ({ ledgerReads, simulations }), assembled: () => assembled };
}

for (const paused of [false, true]) {
  test(`deposit status remains readable with unchanged archived code and instance (paused=${paused})`, async () => {
    const state = fixture({ paused });
    assert.equal(await state.client.readDepositsPaused(), paused);
    assert.equal(state.assembled().isReadCall, false, 'real SDK classifies the restoration footprint as a write');
    assert.deepEqual(state.counts(), { ledgerReads: 1, simulations: 1 });
  });
}

test('restored read validation is fresh for every query and exposes only the decoded result', async () => {
  const state = fixture();
  const result = await state.query(contractId, 'deposits_paused', undefined, networkPassphrase);
  assert.deepEqual(Object.keys(result).sort(), ['isReadCall', 'result']);
  assert.equal(result.isReadCall, true);
  state.ledger.entries = [];
  await assert.rejects(() => state.client.readDepositsPaused(), /read-only/);
  assert.deepEqual(state.counts(), { ledgerReads: 2, simulations: 2 });
});

const invalidCases = [
  ['required authorization', { modify: ({ simulation }) => {
    const invocation = new Contract(contractId).call('deposits_paused').body.invokeHostFunctionOp.hostFunction.invokeContract;
    simulation.result.auth.push(new xdr.SorobanAuthorizationEntry({
      credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
      rootInvocation: new xdr.SorobanAuthorizedInvocation({
        function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(invocation),
        subInvocations: [],
      }),
    }));
  } }],
  ['unlisted writes', { indices: [0] }],
  ['duplicate restore indices', { indices: [0, 0] }],
  ['out-of-range restore indices', { indices: [0, 2] }],
  ['missing restoration metadata', { modify: ({ simulation }) => {
    simulation.transactionData = new SorobanDataBuilder().setReadWrite(simulation.transactionData.getReadWrite());
  } }],
  ['missing state changes', { modify: ({ simulation }) => { delete simulation.stateChanges; } }],
  ['extra state change', { modify: ({ simulation }) => { simulation.stateChanges.push(simulation.stateChanges[0]); } }],
  ['duplicate changed key', { modify: ({ simulation }) => { simulation.stateChanges[1] = simulation.stateChanges[0]; } }],
  ['updated entry', { modify: ({ simulation }) => { simulation.stateChanges[0].before = simulation.stateChanges[0].after; } }],
  ['deleted entry', { modify: ({ simulation }) => { simulation.stateChanges[0].after = null; } }],
  ['restoration that changes contract contents', { modify: ({ ledger }) => {
    ledger.entries[0].val = ledger.entries[1].val;
  } }],
  ['missing archived entry', { modify: ({ ledger }) => { ledger.entries.pop(); } }],
  ['duplicate archived key', { modify: ({ ledger }) => { ledger.entries[1] = ledger.entries[0]; } }],
  ['live ledger entry', { modify: ({ ledger }) => { ledger.entries[0].liveUntilLedgerSeq = 600; } }],
  ['missing TTL evidence', { modify: ({ ledger }) => { delete ledger.entries[0].liveUntilLedgerSeq; } }],
  ['negative TTL evidence', { modify: ({ ledger }) => { ledger.entries[0].liveUntilLedgerSeq = -1; } }],
  ['invalid ledger evidence', { modify: ({ ledger }) => { ledger.latestLedger = Number.NaN; } }],
  ['older ledger evidence', { modify: ({ ledger }) => { ledger.latestLedger = 499; } }],
  ['malformed getter result', { modify: ({ simulation }) => { simulation.result.retval = xdr.ScVal.scvString('false'); } }],
];
for (const [reason, options] of invalidCases) {
  test(`restored read fails closed for ${reason}`, async () => {
    const state = fixture(options);
    await assert.rejects(() => state.client.readDepositsPaused(), /read-only/);
  });
}

test('a normal read requires no restoration lookup', async () => {
  const state = fixture({ modify: ({ simulation }) => {
    simulation.transactionData = new SorobanDataBuilder();
    simulation.stateChanges = [];
  } });
  assert.equal(await state.client.readDepositsPaused(), false);
  assert.deepEqual(state.counts(), { ledgerReads: 0, simulations: 1 });
});

test('restoration read accepts reordered RPC entries without relying on response order', async () => {
  const state = fixture({ modify: ({ ledger }) => { ledger.entries.reverse(); } });
  assert.equal(await state.client.readDepositsPaused(), false);
});

test('generated SDK client receives restore:false for both no-argument and parameterized getters', async () => {
  const state = fixture();
  const entries = [
    { name: 'deposits_paused', inputs: [] },
    { name: 'parameterized_getter', inputs: [new xdr.ScSpecFunctionInputV0({
      doc: '', name: 'index', type: xdr.ScSpecTypeDef.scSpecTypeU32(),
    })] },
  ].map(({ name, inputs }) => xdr.ScSpecEntry.scSpecEntryFunctionV0(new xdr.ScSpecFunctionV0({
    doc: '', name, inputs, outputs: [xdr.ScSpecTypeDef.scSpecTypeBool()],
  })));
  const generated = new contract.Client(new contract.Spec(entries), {
    rpcUrl, contractId, networkPassphrase, server: state.server,
    signTransaction: async () => { assert.fail('Read queries must never sign'); },
  });
  let generatedInvocations = 0;
  for (const method of ['deposits_paused', 'parameterized_getter']) {
    const invoke = generated[method];
    generated[method] = async (...args) => {
      const call = await invoke(...args);
      generatedInvocations += 1;
      assert.equal(call.options.restore, false, 'restore option reaches real SDK assembly');
      assert.equal(call.options.args?.length ?? 0, method === 'deposits_paused' ? 0 : 1);
      return call;
    };
  }
  const query = createCachedPrivateContractQuery({
    rpcUrl, server: state.server, createClient: async () => generated,
  });
  for (const [method, args] of [['deposits_paused', undefined], ['parameterized_getter', { index: 0 }]]) {
    assert.deepEqual(await query(contractId, method, args, networkPassphrase), { result: false, isReadCall: true });
  }
  assert.equal(generatedInvocations, 2);
});
