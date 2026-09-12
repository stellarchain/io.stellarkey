import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { Keypair } from '@stellar/stellar-sdk';
import { initializeVault, lockVault, unlockVault, withPrivacySessionRoot, createSessionRevocationGuard } from '../src/lib/vault.ts';
import { createPrivateActionLifetime } from '../src/features/private-balance/runtime/proof-disclosure.ts';
import { createPrivateRuntimeMutex } from '../src/features/private-balance/runtime/mutex.ts';
import { assertDirectPrivateSubmission } from '../src/features/private-balance/runtime/direct-submission.ts';
import { PrivateStaleChainStateError } from '../src/features/private-balance/runtime/action-flow.ts';
import { PrivateBalanceWorkerClient } from '../src/features/private-balance/worker/client.ts';
import { humanizePrivateError } from '../src/features/private-balance/copy.ts';
import { assertSamePrivateFeePayer, privateActionClassicFeeStroops, MAX_PRIVATE_ACTION_RESOURCE_FEE_STROOPS } from '../src/features/private-balance/runtime/fee-policy.ts';
import { planPrivateChainedSend } from '../src/features/private-balance/runtime/chained-send.ts';
import { pollBroadcastPrivateBalanceTransaction } from '../src/features/private-balance/runtime/submission.ts';

const manifest = JSON.parse(readFileSync(new URL('../protocol/private-balance/manifests/development.json', import.meta.url), 'utf8'));
const source = readFileSync(new URL('../src/features/private-balance/runtime/provider.tsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('provider.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const callbacks = new Map();
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.initializer && ts.isCallExpression(node.initializer) && node.initializer.expression.getText(parsed) === 'useCallback') {
    callbacks.set(node.name.getText(parsed), node.initializer.arguments[0].getText(parsed));
  }
  ts.forEachChild(node, visit);
}
visit(parsed);
function callback(name, environment) {
  assert.ok(callbacks.has(name), `Production callback ${name} exists`);
  return vm.runInNewContext(ts.transpileModule(`(${callbacks.get(name)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, environment);
}

async function setup(t) {
  const previousWindow = globalThis.window;
  const entries = new Map();
  globalThis.window = { localStorage: { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key) } };
  const password = 'synthetic context correct horse battery staple';
  const { account } = await initializeVault(password, { secret: Keypair.random().secret() });
  const clients = [];
  t.after(() => { for (const client of clients) client.terminate(); lockVault(); globalThis.window = previousWindow; });
  function makeWorker() {
    const transport = { postMessage() {}, terminate() {} };
    const client = new PrivateBalanceWorkerClient(transport);
    clients.push(client);
    return { client, crash: () => transport.onerror() };
  }
  const initial = makeWorker();
  const scope = {};
  const state = { revision: 1, pendingActions: [{ id: 'synthetic-deposit', submissionMode: 'direct', status: 'reviewed', transactionHash: 'aa'.repeat(32) }] };
  const review = { id: 'synthetic-deposit', kind: 'deposit', submissionMode: 'direct', transaction: { transactionHash: 'synthetic-unusable' } };
  const calls = { prepare: 0, sync: 0, reflect: 0, sign: 0, send: 0, watch: 0, cancel: 0 };
  let rpcUrl = 'https://synthetic.invalid';
  const env = {
    Error, DOMException, URL, accountId: account.id, accountPublicKey: account.publicKey,
    manifest, network: 'testnet', storageScope: scope, stealthScope: scope,
    providerMountedRef: { current: true }, leaderRef: { current: true },
    runtimeAuthorityEpochRef: { current: 0 }, walletPhaseRef: { current: 'unlocked' },
    stealthScopeRef: { current: scope }, workerRef: { current: initial.client },
    workerIdentityRef: { current: { address: 'synthetic-unusable-private-address' } },
    captureSigningContext: createSessionRevocationGuard, getRpcUrl: () => rpcUrl,
    deploymentContext: () => manifest, IndexedDbEncryptedRecordDriver: class {},
    mutexRef: { current: createPrivateRuntimeMutex() }, withPrivacySessionRoot,
    createPrivateActionLifetime, assertDirectPrivateSubmission, PrivateStaleChainStateError,
    assertSamePrivateFeePayer, privateActionClassicFeeStroops, MAX_PRIVATE_ACTION_RESOURCE_FEE_STROOPS,
    resolvePrivateBalanceFeePayer: () => undefined, freshPrivateFeeBalance: async () => 1_000_000_000n,
    asset: { ...manifest.assets[0], code: 'XLM', decimals: 7, status: 'active' }, registryAssets: manifest.assets,
    recommendedBaseFeeStroops: '100', loadPrivateBalanceState: async () => state,
    reflectDurableState: () => { calls.reflect++; },
    performSyncRef: { current: async () => { calls.sync++; } },
    preparePrivateBalanceActionFlow: async input => { calls.prepare++; input.assertContext(); return { state, review }; },
    assertReviewedPrivateActionEndpoint() {}, privateOutgoingHistoryMode: value => value ?? 'recoverable',
    SorobanRpc: { Server: class { async sendTransaction() { calls.send++; return { status: 'PENDING' }; } } },
    signPrivateBalanceEnvelope: async () => { calls.sign++; return 'synthetic-unusable-envelope'; },
    signReviewedPrivateBalanceAction: async input => { await input.sign({}); state.pendingActions[0].status = 'signed'; return state; },
    broadcastPrivateBalanceAction: async input => { await input.rpc.sendTransaction({}); state.pendingActions[0].status = 'broadcast'; return { status: 'broadcast', state }; },
    watchBroadcastOutcome: () => { calls.watch++; }, cancelAction: async () => { calls.cancel++; },
  };
  env.capturePrivateActionContext = callback('capturePrivateActionContext', env);
  const prepare = callback('prepareActionInternal', env);
  const submit = callback('submitActionInternal', env);
  return { env, calls, review, state, prepare, submit, initial, password,
    changeRpc: () => { rpcUrl = 'https://other-synthetic.invalid'; },
    replaceWorker: () => { env.workerRef.current = makeWorker().client; env.workerIdentityRef.current = { address: 'synthetic-replacement-address' }; },
  };
}

async function setupWatcher(t) {
  const h = await setup(t);
  Object.assign(h.state, {
    outgoingHistoryMode: 'recoverable', notes: [], activities: [],
    recentPrivateRecipients: [], spendRecovery: null,
    account: { lastVerifiedActionIndex: 0 },
  });
  h.state.pendingActions[0].status = 'ambiguous';
  Object.assign(h.calls, { lookup: 0, read: 0, recover: 0, commit: 0, publication: 0 });
  h.boundary = async () => {};
  h.rpc = { getTransaction: async () => {
    h.calls.lookup++;
    await h.boundary('rpc');
    return { status: 'FAILED' };
  } };
  let polling;
  h.env.pollBroadcastPrivateBalanceTransaction = input => {
    polling = pollBroadcastPrivateBalanceTransaction({
      ...input, delays: [0, 0], sleep: async () => h.boundary('sleep'),
    });
    return polling;
  };
  h.env.performSyncRef.current = async () => { h.calls.sync++; await h.boundary('sync'); };
  h.env.loadPrivateBalanceState = async () => { h.calls.read++; await h.boundary('read'); return h.state; };
  h.env.recoverPrivateBalanceAction = async input => {
    h.calls.recover++;
    await input.scanCanonicalTranscript();
    await h.boundary('recovery');
    // This is an already-authorized canonical journal commit, not UI state.
    h.state.pendingActions = [];
    h.calls.commit++;
    return { state: h.state };
  };
  h.env.setOutgoingHistoryModeState = () => { h.calls.publication++; };
  h.env.dispatch = () => { h.calls.publication++; };
  h.env.setSnapshot = () => { h.calls.publication++; };
  h.env.verifiedBalance = () => 0n;
  h.env.reflectDurableState = callback('reflectDurableState', h.env);
  h.start = () => {
    callback('watchBroadcastOutcome', h.env)('synthetic-deposit', 'ab'.repeat(32), h.rpc, manifest, {});
    return polling;
  };
  return h;
}

async function revokeWatcher(h, reason) {
  if (reason === 'lock' || reason === 'lock-ABA') {
    lockVault();
    if (reason === 'lock-ABA') await unlockVault(h.password);
  } else if (reason === 'lease' || reason === 'lease-ABA') {
    h.env.leaderRef.current = false;
    h.env.runtimeAuthorityEpochRef.current++;
    if (reason === 'lease-ABA') h.env.leaderRef.current = true;
  } else if (reason === 'scope') h.env.stealthScopeRef.current = {};
  else if (reason === 'rpc') h.changeRpc();
  else if (reason === 'unmount') h.env.providerMountedRef.current = false;
}

for (const stage of ['sync', 'read', 'recovery']) {
  for (const reason of ['lock', 'lock-ABA', 'lease', 'lease-ABA', 'scope', 'rpc', 'unmount']) {
    test(`detached outcome watcher cannot publish after ${reason} during ${stage}`, async t => {
      const h = await setupWatcher(t);
      h.boundary = async current => { if (current === stage) await revokeWatcher(h, reason); };
      await assert.rejects(h.start(), /revoked|context changed/i);
      assert.equal(h.calls.publication, 0, 'No private reducer, preference or snapshot publication survives revocation');
      assert.equal(h.calls.read, stage === 'sync' ? 0 : 1);
      assert.equal(h.calls.recover, stage === 'recovery' ? 1 : 0);
      assert.equal(h.calls.commit, stage === 'recovery' ? 1 : 0, 'An authorized durable commit is not undone');
      assert.equal(h.state.pendingActions.length, stage === 'recovery' ? 0 : 1);
      assert.equal(h.calls.lookup, 1, 'A retired watcher does not poll again');
    });
  }
}

test('detached outcome watcher checks ownership before its next RPC request', async t => {
  const h = await setupWatcher(t);
  h.boundary = async stage => { if (stage === 'sleep') await revokeWatcher(h, 'lock-ABA'); };
  await assert.rejects(h.start(), /revoked|context changed/i);
  assert.equal(h.calls.lookup + h.calls.read + h.calls.publication, 0);
  assert.equal(h.state.pendingActions.length, 1);
});

test('detached recovery waits for the runtime mutex and checks ownership before borrowing a key', async t => {
  const h = await setupWatcher(t);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const holder = h.env.mutexRef.current.runExclusive(() => gate);
  const polling = h.start();
  // Observe the eventual rejection even while the mutex owner still drains.
  const rejected = assert.rejects(polling, /revoked|context changed/i);
  await new Promise(resolve => setImmediate(resolve));
  await revokeWatcher(h, 'lease-ABA');
  release();
  await holder;
  await rejected;
  assert.equal(h.calls.read + h.calls.recover + h.calls.publication, 0);
});

test('a current outcome watcher reconciles once despite a completed proof worker failing', async t => {
  const h = await setupWatcher(t);
  h.initial.crash();
  assert.equal(await h.start(), 'confirmed');
  assert.equal(h.calls.commit, 1);
  assert.equal(h.calls.publication, 7);
  assert.equal(h.state.pendingActions.length, 0);
});

test('an unavailable canonical synchronizer leaves a submitted action pending', async t => {
  const h = await setupWatcher(t);
  h.env.performSyncRef.current = null;
  assert.equal(await h.start(), 'pending');
  assert.equal(h.calls.read + h.calls.recover + h.calls.publication, 0);
  assert.equal(h.state.pendingActions.length, 1);
});

test('Add funds preserves the actual worker crash and runs recovery without retrying the action', async t => {
  const h = await setup(t);
  h.env.preparePrivateBalanceActionFlow = async input => {
    h.calls.prepare++; input.assertContext(); h.initial.crash();
    return input.worker.buildAction('synthetic', {}, [], []);
  };
  h.env.performSyncRef.current = async () => { h.calls.sync++; h.replaceWorker(); };
  await assert.rejects(h.prepare({ kind: 'deposit' }), /worker crashed/);
  assert.equal(h.calls.prepare, 1);
  assert.equal(h.calls.sync, 1);
  assert.equal(h.calls.reflect, 1);
  assert.equal(h.calls.sign + h.calls.send, 0);
  h.env.preparePrivateBalanceActionFlow = async input => { h.calls.prepare++; input.assertContext(); return { state: h.state, review: h.review }; };
  assert.equal(await h.prepare({ kind: 'deposit' }), h.review);
  assert.equal(h.calls.prepare, 2, 'Only a new explicit action retries');
});

for (const boundary of ['read', 'generate', 'commit']) test(`address rotation cannot publish after scope revocation at ${boundary}`, async t => {
  const h = await setup(t);
  let commits = 0; let publications = 0;
  const replacement = { address: 'synthetic-replacement-identity' };
  const revoke = () => { h.env.runtimeAuthorityEpochRef.current++; h.replaceWorker(); h.env.workerIdentityRef.current = replacement; };
  h.env.actionBusyRef = { current: false };
  h.env.dispatch = () => { publications++; };
  h.env.loadPrivateBalanceState = async () => { if (boundary === 'read') revoke(); return h.state; };
  h.initial.client.generateAddress = async () => {
    if (boundary === 'generate') revoke();
    return { address: 'synthetic-new-address', ownerCommitmentHex: 'synthetic' };
  };
  h.env.recordPrivateBalanceAddress = async () => { commits++; if (boundary === 'commit') revoke(); return h.state; };
  await assert.rejects(callback('rotatePrivateAddress', h.env)(), /cancelled|context|worker/i);
  assert.equal(commits, boundary === 'commit' ? 1 : 0, 'Revocation cannot undo an already authorized durable commit');
  assert.equal(publications, 0);
  assert.equal(h.calls.reflect, 0);
  assert.equal(h.env.workerIdentityRef.current, replacement, 'Stale cleanup must not clear a replacement identity');
  assert.equal(h.env.workerRef.current.failed, false);
});

test('queued address rotation checks authority before borrowing a replacement session root', async t => {
  const h = await setup(t);
  h.env.actionBusyRef = { current: false };
  let borrowed = 0;
  h.env.withPrivacySessionRoot = async () => { borrowed++; throw new Error('Synthetic root borrower reached'); };
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const other = h.env.mutexRef.current.runExclusive(() => gate);
  const rotating = callback('rotatePrivateAddress', h.env)();
  h.env.runtimeAuthorityEpochRef.current++;
  release(); await other;
  await assert.rejects(rotating, /context changed/);
  assert.equal(borrowed, 0);
});

test('Add funds waits for an in-flight sync before binding its proof worker', async t => {
  const h = await setup(t);
  h.env.workerRef.current = null;
  h.env.workerIdentityRef.current = null;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const sync = h.env.mutexRef.current.runExclusive(async () => { await gate; h.replaceWorker(); });
  const action = h.prepare({ kind: 'deposit' });
  release(); await sync;
  assert.equal(await action, h.review);
  assert.equal(h.calls.prepare, 1);
});

test('missing worker reports readiness and can recover without a wallet-context error', async t => {
  const h = await setup(t);
  h.env.workerRef.current = null;
  await assert.rejects(h.prepare({ kind: 'deposit' }), /worker is not ready/);
  assert.equal(h.calls.sync, 1);
  assert.equal(h.calls.prepare, 0);
});

for (const status of ['broadcast', 'ambiguous']) for (const recovery of ['replace', 'clear']) {
  test(`submitted ${status} survives post-submit worker ${recovery}`, async t => {
    const h = await setup(t);
    h.env.broadcastPrivateBalanceAction = async input => {
      await input.rpc.sendTransaction({}); h.state.pendingActions[0].status = status;
      return { status, state: h.state };
    };
    h.env.performSyncRef.current = async () => {
      h.calls.sync++;
      if (recovery === 'replace') h.replaceWorker();
      else { h.env.workerRef.current = null; h.env.workerIdentityRef.current = null; throw new Error('Synthetic sync failure'); }
    };
    assert.equal((await h.submit(h.review)).status, status);
    assert.equal(h.state.pendingActions[0].status, status);
    assert.equal(h.calls.sign, 1); assert.equal(h.calls.send, 1);
    assert.equal(h.calls.watch, 1); assert.equal(h.calls.cancel, 0);
  });
}

test('reviewed direct submission does not depend on the completed proof worker', async t => {
  const h = await setup(t); h.initial.crash();
  assert.equal((await h.submit(h.review)).status, 'broadcast');
  assert.equal(h.calls.send, 1);
});

test('fee selection preserves the private owner and deposit source throughout preparation', async t => {
  const h = await setup(t);
  const payer = { accountId: 'synthetic-other', publicKey: Keypair.random().publicKey() };
  h.env.resolvePrivateBalanceFeePayer = id => { assert.equal(id, payer.accountId); return payer; };
  h.env.freshPrivateFeeBalance = async (key, network) => {
    assert.equal(key, payer.publicKey); assert.equal(network, 'testnet'); return 100_000_000n;
  };
  h.env.preparePrivateBalanceActionFlow = async input => {
    assert.equal(input.accountPublicKey, h.env.accountPublicKey);
    assert.equal(input.storageContext, h.env.storageScope);
    assert.deepEqual(input.feePayer, payer);
    input.assertContext(); return { state: h.state, review: h.review };
  };
  assert.equal(await h.prepare({ kind: 'deposit', amount: '1', feePayerAccountId: payer.accountId }), h.review);
});

test('chained default fee approval checks fresh spendable XLM instead of the cached total balance', async t => {
  const h = await setup(t);
  h.env.state = { notes: [] };
  h.env.parsePrivateAmount = () => 1n;
  h.env.selectPrivateNotes = () => ({ kind: 'consolidation', actionCount: 2 });
  h.env.ownerId = () => 'synthetic-chain';
  h.env.planPrivateChainedSend = planPrivateChainedSend;
  h.env.balances = [];
  h.env.publicXlmBalanceStroops = () => 1_000_000_000n;
  let reads = 0;
  h.env.freshPrivateFeeBalance = async (key, network) => {
    reads++; assert.equal(key, h.env.accountPublicKey); assert.equal(network, 'testnet'); return 1_000n;
  };
  await assert.rejects(callback('prepareChainedSend', h.env)({ kind: 'transfer', amount: '1' }), /XLM/);
  assert.equal(reads, 1);
});

for (const boundary of ['fee-read', 'proof', 'sign']) test(`removing the selected payer during ${boundary} cannot fall back to the private owner`, async t => {
  const h = await setup(t);
  const payer = { accountId: 'synthetic-other', publicKey: Keypair.random().publicKey() };
  let available = true;
  h.env.resolvePrivateBalanceFeePayer = () => { if (!available) throw new Error('Selected fee-paying account is unavailable'); return payer; };
  h.env.freshPrivateFeeBalance = async () => { if (boundary === 'fee-read') available = false; return 100_000_000n; };
  if (boundary === 'proof') h.env.preparePrivateBalanceActionFlow = async input => {
    h.calls.prepare++; available = false; input.assertContext(); assert.fail('Revoked proof cannot be disclosed');
  };
  if (boundary === 'sign') {
    h.review.transaction.feePayer = payer;
    h.review.transaction.classicFeeStroops = 200n; h.review.transaction.resourceFeeStroops = 900n;
    h.env.signPrivateBalanceEnvelope = async (_request, assertCurrent) => {
      available = false; assertCurrent(); assert.fail('Revoked payer cannot sign');
    };
    await assert.rejects(h.submit(h.review), /fee.pay.*unavailable/i);
  } else await assert.rejects(h.prepare({ kind: 'deposit', feePayerAccountId: payer.accountId }), /fee.pay.*unavailable/i);
  assert.equal(h.calls.send, 0);
  assert.equal(h.state.pendingActions[0].status, 'reviewed');
});

test('selected fee account requires enough spendable XLM before private preparation starts', async t => {
  const h = await setup(t);
  h.env.resolvePrivateBalanceFeePayer = () => ({ accountId: 'synthetic-other', publicKey: Keypair.random().publicKey() });
  const payer = h.env.resolvePrivateBalanceFeePayer();
  h.env.resolvePrivateBalanceFeePayer = () => payer;
  h.env.freshPrivateFeeBalance = async () => 10_000_199n;
  await assert.rejects(h.prepare({ kind: 'deposit', feePayerAccountId: payer.accountId }), /spendable public XLM/i);
  assert.equal(h.calls.prepare, 0); assert.equal(h.calls.send, 0);
});

test('submission returns and watches the persisted sponsored hash, not the unsigned review hash', async t => {
  const h = await setup(t);
  const outerHash = 'bb'.repeat(32);
  const payer = { accountId: 'synthetic-other', publicKey: Keypair.random().publicKey() };
  h.env.resolvePrivateBalanceFeePayer = () => payer;
  Object.assign(h.review.transaction, { feePayer: payer, classicFeeStroops: 200n, resourceFeeStroops: 900n });
  h.env.signReviewedPrivateBalanceAction = async input => {
    await input.sign({ feePayer: payer, maximumClassicFeeStroops: 200n, maximumResourceFeeStroops: 900n });
    Object.assign(h.state.pendingActions[0], { status: 'signed', transactionHash: outerHash, innerTransactionHash: h.review.transaction.transactionHash });
    return h.state;
  };
  h.env.signPrivateBalanceEnvelope = async (request, assertCurrent) => {
    assertCurrent(); assert.equal(request.feePayer, payer); assert.equal(request.maximumClassicFeeStroops, 200n);
    return 'synthetic-unusable-envelope';
  };
  h.env.watchBroadcastOutcome = (_id, hash) => { assert.equal(hash, outerHash); h.calls.watch++; };
  const result = await h.submit(h.review);
  assert.equal(result.transactionHash, outerHash); assert.equal(result.status, 'broadcast');
  assert.equal(h.calls.watch, 1);
});

for (const revocation of ['scope', 'rpc', 'lease-ABA', 'lock-ABA', 'unmount']) {
  test(`preparation recovery cannot publish an old error after ${revocation}`, async t => {
    const h = await setup(t);
    h.env.preparePrivateBalanceActionFlow = async () => { throw new Error('Synthetic old preparation failure'); };
    h.env.performSyncRef.current = async () => {
      h.calls.sync++;
      if (revocation === 'scope') h.env.stealthScopeRef.current = {};
      if (revocation === 'rpc') h.changeRpc();
      if (revocation === 'lease-ABA') { h.env.leaderRef.current = false; h.env.runtimeAuthorityEpochRef.current++; h.env.leaderRef.current = true; }
      if (revocation === 'lock-ABA') { lockVault(); await unlockVault(h.password); }
      if (revocation === 'unmount') h.env.providerMountedRef.current = false;
    };
    await assert.rejects(h.prepare({ kind: 'deposit' }), error => !error.message.includes('Synthetic old'));
    assert.equal(h.calls.sync, 1); assert.equal(h.calls.send, 0);
  });
}

test('lease loss and reacquisition after send revoke UI publication, not durable tracking', async t => {
  const h = await setup(t);
  h.env.performSyncRef.current = async () => { h.env.runtimeAuthorityEpochRef.current++; };
  await assert.rejects(h.submit(h.review), /wallet context changed/);
  assert.equal(h.state.pendingActions[0].status, 'broadcast');
  assert.equal(h.calls.send, 1); assert.equal(h.calls.watch, 0); assert.equal(h.calls.cancel, 0);
});

for (const path of ['claimOrRenewLease', 'onLeaseChange']) {
  test(`actual ${path} permanently revokes old action authority on lease loss`, async t => {
    const h = await setup(t);
    const authority = h.env.capturePrivateActionContext();
    let claimed = false;
    const environment = { ...h.env, active: true, window: globalThis.window, leaseKey: 'synthetic-lease',
      runtimeOwnerId: 'synthetic-owner', LEASE_TTL_MS: 1000, encryptedStateExistsRef: { current: false },
      claimPrivateBalanceLease: () => claimed,
      assertPrivateBalanceLease: () => { if (!claimed) throw new Error('Synthetic lease lost'); },
      clearDecryptedState() {}, setSnapshot() {}, performSync: async () => {},
    };
    const nested = new Map();
    function find(node) {
      if (ts.isVariableDeclaration(node) && node.initializer && ts.isArrowFunction(node.initializer)) nested.set(node.name.getText(parsed), node.initializer.getText(parsed));
      ts.forEachChild(node, find);
    }
    find(parsed);
    const compile = name => vm.runInNewContext(ts.transpileModule(`(${nested.get(name)})`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText, environment);
    compile(path)({ key: 'synthetic-lease' });
    assert.equal(h.env.leaderRef.current, false);
    claimed = true; compile('claimOrRenewLease')();
    assert.equal(h.env.leaderRef.current, true);
    assert.throws(authority, /wallet context changed/);
    h.env.capturePrivateActionContext()();
  });
}

for (const boundary of ['disclosure', 'result']) {
  test(`worker replacement before preparation ${boundary} cannot publish a stale review`, async t => {
    const h = await setup(t);
    h.env.preparePrivateBalanceActionFlow = async input => {
      h.calls.prepare++; input.assertContext(); h.replaceWorker();
      if (boundary === 'disclosure') input.assertContext();
      return { state: h.state, review: h.review };
    };
    await assert.rejects(h.prepare({ kind: 'deposit' }), /worker is not ready/);
    assert.equal(h.calls.prepare, 1); assert.equal(h.calls.sync, 1);
    assert.equal(h.calls.sign + h.calls.send, 0);
  });
}

for (const message of ['Private action cancelled after its wallet context changed.', 'Private Balance worker crashed. Sync again to restart it.', 'Unclassified synthetic runtime failure.']) {
  test(`safe action error copy: ${message}`, () => {
    const copy = humanizePrivateError(new Error(message));
    assert.doesNotMatch(copy.body, /nothing was sent|nothing left|try again/i);
    assert.equal(copy.action, 'details');
  });
}
