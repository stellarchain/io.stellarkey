import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createRelayRecoveryScenario, SyntheticRecordDriver } from '../e2e/fixtures/relay-recovery-scenario.ts';
import { initialPrivateBalanceState, privateBalanceReducer } from '../src/features/private-balance/runtime/reducer.ts';
import { initializeVault, withPrivacySessionRoot, lockVault, unlockVault } from '../src/lib/vault.ts';
import { Keypair } from '@stellar/stellar-sdk';
import * as proofDisclosure from '../src/features/private-balance/runtime/proof-disclosure.ts';
import { assertPrivateRecoveryReplacement } from '../src/features/private-balance/runtime/spend-recovery.ts';
import vm from 'node:vm';
import ts from 'typescript';

const manifest = JSON.parse(readFileSync(new URL('../protocol/private-balance/manifests/development.json', import.meta.url), 'utf8'));
const expected = (bob, reserved = '0', alice = '0', charlie = '0', pending = 0) => ({ bob, reserved, alice, charlie, pending });

test('submission cleanup rechecks authority after its durable state read', async () => {
  const source = readFileSync(new URL('../src/features/private-balance/runtime/provider.tsx', import.meta.url), 'utf8');
  const parsed = ts.createSourceFile('provider.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === 'cancelAction' && ts.isCallExpression(node.initializer)) expression = node.initializer.arguments[0].getText(parsed);
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.ok(expression, 'The production cancellation callback must exist');
  let releaseRead, enteredRead;
  const gate = new Promise(resolve => { releaseRead = resolve; });
  const entered = new Promise(resolve => { enteredRead = resolve; });
  let current = true, reflected = 0;
  // Execute the real provider callback; control only the storage await and
  // React publication, since the encrypted-storage paths are covered below.
  const cancel = vm.runInNewContext(ts.transpileModule(`(${expression})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, {
    manifest: {}, accountId: 'synthetic', storageScope: {}, deploymentContext: () => ({}),
    IndexedDbEncryptedRecordDriver: class {}, mutexRef: { current: { runExclusive: operation => operation() } },
    withPrivacySessionRoot: (_account, _context, operation) => operation(null, null),
    loadPrivateBalanceState: async () => { enteredRead(); await gate; return { pendingActions: [{ id: 'synthetic-held' }] }; },
    hasExposedPrivateSpend: () => true, reflectDurableState: () => { reflected++; },
  });
  const pending = cancel('synthetic-held', () => assert.ok(current, 'synthetic authority revoked'));
  await entered; current = false; releaseRead();
  await assert.rejects(pending, /authority revoked/);
  assert.equal(reflected, 0);
});

test('recovery rejects replacement input, value, asset, route and nullifier tampering', async () => {
  const scenario = await createRelayRecoveryScenario(manifest, new SyntheticRecordDriver());
  await assert.rejects(scenario.prepare('helper-reject'));
  const original = (await scenario.state()).pendingActions[0];
  await scenario.prepare('approve', undefined, true);
  // The replacement validator runs at disclosure, before envelope review.
  const replacement = { ...(await scenario.state()).pendingActions[0], status: 'prepared' };
  assertPrivateRecoveryReplacement(original, replacement, 1000000000n);
  for (const patch of [
    { reservedNoteIds: ['19'.repeat(32)] }, { amountStroops: '1' }, { changeValueStroops: '1' },
    { assetContractId: 'different-synthetic-asset' }, { assetIndex: 1 }, { submissionMode: 'relay' },
    { proofExposure: 'local' }, { nullifiers: ['21'.repeat(32), '22'.repeat(32)] },
    { nullifiers: [replacement.nullifiers[0], replacement.nullifiers[0]] },
  ]) assert.throws(() => assertPrivateRecoveryReplacement(original, { ...replacement, ...patch }, 1000000000n));
});

test('private action lifetime rejects a replaced vault session even when React scope is unchanged', async () => {
  assert.equal(typeof proofDisclosure.createPrivateActionLifetime, 'function');
  const previousWindow = globalThis.window;
  const entries = new Map();
  globalThis.window = { localStorage: { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key) } };
  try {
    const password = 'synthetic recovery correct horse battery staple';
    await initializeVault(password, { secret: Keypair.random().secret() });
    const operation = proofDisclosure.createPrivateActionLifetime(() => {});
    operation.assertCurrent();
    lockVault(); await unlockVault(password);
    assert.equal(operation.signal.aborted, true);
    assert.throws(operation.assertCurrent);
    operation.dispose();
    const fresh = proofDisclosure.createPrivateActionLifetime(() => {});
    fresh.assertCurrent(); fresh.dispose();
    const cancellation = new AbortController();
    const cancelled = proofDisclosure.createPrivateActionLifetime(() => {}, cancellation.signal);
    cancellation.abort();
    assert.throws(cancelled.assertCurrent);
    // User cancellation may still publish a conservative durable proof hold;
    // authority replacement may not publish old private state.
    assert.equal(typeof cancelled.assertAuthority, 'function');
    cancelled.assertAuthority(); cancelled.dispose();
  } finally { lockVault(); globalThis.window = previousWindow; }
});

test('real vault-derived Bob identity can seed the recovery provider fixture', async () => {
  const previousWindow = globalThis.window;
  const entries = new Map();
  globalThis.window = { localStorage: { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key) } };
  try {
    const { account } = await initializeVault('synthetic recovery correct horse battery staple', { secret: Keypair.random().secret() });
    const scenario = await withPrivacySessionRoot(account.id, manifest, (root, storageKey) => createRelayRecoveryScenario(manifest, new SyntheticRecordDriver(), {
      bob: { accountId: account.id, publicKey: account.publicKey, root, storageKey },
    }));
    await assert.rejects(scenario.prepare('helper-reject'), error => error.name === 'PrivateProofExposedError');
    await scenario.prepare('approve', undefined, true);
    await scenario.confirm(true);
    assert.deepEqual(await scenario.balances(), expected('100'));
  } finally { lockVault(); globalThis.window = previousWindow; }
});

test('runtime hydration publishes recovery lineage and clears it on reset', () => {
  const recovery = { originalActionField: '11'.repeat(32), recoveryActionFields: ['22'.repeat(32)], reservedNoteIds: ['33'.repeat(32)],
    assetContractId: manifest.assets[0].contractId, outcome: 'pending' };
  const hydrated = privateBalanceReducer(initialPrivateBalanceState, { type: 'SET_SPEND_RECOVERY', spendRecovery: recovery });
  assert.equal(hydrated.spendRecovery, recovery);
  assert.equal(privateBalanceReducer(hydrated, { type: 'RESET' }).spendRecovery ?? null, null);
});

test('caught-up sync resolves lineage left pending by an older client', async () => {
  const scenario = await createRelayRecoveryScenario(manifest, new SyntheticRecordDriver());
  await assert.rejects(scenario.prepare('helper-reject'));
  await scenario.prepare('approve', undefined, true);
  await scenario.confirm(true);
  await scenario.changeState(state => ({ ...state, spendRecovery: { ...state.spendRecovery, outcome: 'pending' } }));
  await scenario.sync();
  assert.equal((await scenario.state()).spendRecovery.outcome, 'recovered');
});

test('bounded recovery history never disables retry after repeated simulation failures', async () => {
  const scenario = await createRelayRecoveryScenario(manifest, new SyntheticRecordDriver());
  await assert.rejects(scenario.prepare('helper-reject'));
  await assert.rejects(scenario.prepare('helper-reject', undefined, true), error => error.name === 'PrivateProofExposedError');
  await scenario.changeState(state => ({ ...state, spendRecovery: { ...state.spendRecovery,
    recoveryActionFields: [...Array.from({ length: 31 }, (_, index) => (index + 1).toString(16).padStart(64, '0')), state.pendingActions[0].actionField] } }));
  await scenario.prepare('approve', undefined, true);
  assert.equal((await scenario.state()).spendRecovery.recoveryActionFields.length, 32);
  await scenario.confirm(true);
  assert.deepEqual(await scenario.balances(), expected('100'));
});

for (const originalWins of [false, true]) test(`held input recovery: ${originalWins ? 'original payment' : 'self recovery'} confirms first`, async () => {
  const scenario = await createRelayRecoveryScenario(manifest, new SyntheticRecordDriver());
  await assert.rejects(scenario.prepare('helper-reject'), error => error.name === 'PrivateProofExposedError');
  const original = (await scenario.state()).pendingActions[0];
  await scenario.prepare('approve', async request => {
    assert.equal(request.privateFeeAtomic, '0');
    assert.equal(request.submissionMode, 'direct');
    assert.equal(request.amountStroops, '1000000000');
    assert.deepEqual((await scenario.state()).pendingActions, [original]);
  }, true);
  const recovered = (await scenario.state()).pendingActions[0];
  assert.notEqual(recovered.id, original.id);
  assert.deepEqual(recovered.reservedNoteIds, original.reservedNoteIds);
  assert.equal(recovered.nullifiers.filter(value => original.nullifiers.includes(value)).length, 1);
  assert.deepEqual(await scenario.balances(), expected('0', '100', '0', '0', 1));
  await scenario.confirm(!originalWins);
  assert.deepEqual(await scenario.balances(), originalWins ? expected('87', '0', '3', '10') : expected('100'));
  assert.equal((await scenario.state()).spendRecovery.outcome, originalWins ? 'original-confirmed' : 'recovered');
  await scenario.sync();
  assert.deepEqual(await scenario.freshScanBalances(), originalWins ? { bob: '87', alice: '3', charlie: '10' } : { bob: '100', alice: '0', charlie: '0' });
});

for (const mode of ['cancel', 'proof-failure']) test(`held input recovery ${mode} preserves the original hold`, async () => {
  const scenario = await createRelayRecoveryScenario(manifest, new SyntheticRecordDriver());
  await assert.rejects(scenario.prepare('helper-reject'), error => error.name === 'PrivateProofExposedError');
  const original = await scenario.state();
  await assert.rejects(scenario.prepare(mode, undefined, true), mode === 'cancel' ? /Synthetic consent cancelled/ : /Synthetic prover failure/);
  assert.deepEqual(await scenario.state(), original);
});

test('original payment wins before recovery disclosure: stale CAS shares no recovery proof', async () => {
  const scenario = await createRelayRecoveryScenario(manifest, new SyntheticRecordDriver());
  await assert.rejects(scenario.prepare('helper-reject'));
  await assert.rejects(scenario.prepare('approve', () => scenario.confirm(), true), /recovery state changed/);
  assert.equal(scenario.shared, 1);
  assert.deepEqual(await scenario.balances(), expected('87', '0', '3', '10'));
  assert.equal((await scenario.state()).spendRecovery, undefined);
});

test('competing tabs can build locally but only one recovery disclosure CAS wins', async () => {
  const scenario = await createRelayRecoveryScenario(manifest, new SyntheticRecordDriver());
  await assert.rejects(scenario.prepare('helper-reject'));
  let firstReady;
  const ready = new Promise(resolve => { firstReady = resolve; });
  let releaseFirst;
  const gate = new Promise(resolve => { releaseFirst = resolve; });
  const first = scenario.prepare('approve', async () => { firstReady(); await gate; }, true);
  await ready;
  await scenario.prepare('approve', undefined, true);
  const winner = (await scenario.state()).pendingActions[0];
  releaseFirst();
  await assert.rejects(first, /recovery state changed/);
  assert.equal(scenario.shared, 2); // Original helper plus exactly one recovery.
  assert.deepEqual((await scenario.state()).pendingActions, [winner]);
  await scenario.confirm(true);
  assert.deepEqual(await scenario.balances(), expected('100'));
});

test('two-input recovery preserves the entire held value and leaves unrelated notes alone', async () => {
  const scenario = await createRelayRecoveryScenario(manifest, new SyntheticRecordDriver(), { deposits: ['20', '20', '5'], amount: '30' });
  await assert.rejects(scenario.prepare('helper-reject'));
  const original = (await scenario.state()).pendingActions[0];
  await scenario.prepare('approve', undefined, true);
  const replacement = (await scenario.state()).pendingActions[0];
  assert.deepEqual(new Set(replacement.nullifiers), new Set(original.nullifiers));
  assert.deepEqual(replacement.reservedNoteIds, original.reservedNoteIds);
  assert.equal(replacement.amountStroops, '400000000');
  assert.deepEqual(await scenario.balances(), expected('5', '40', '0', '0', 1));
  await scenario.confirm(true);
  assert.deepEqual(await scenario.balances(), expected('45'));
});

test('legacy exposed hold can recover without inferring its old submission route', async () => {
  const scenario = await createRelayRecoveryScenario(manifest, new SyntheticRecordDriver());
  await assert.rejects(scenario.prepare('helper-reject'));
  await scenario.changeState(state => {
    delete state.pendingActions[0].proofExposure;
    delete state.pendingActions[0].submissionMode;
    return state;
  });
  await scenario.prepare('approve', undefined, true);
  assert.equal((await scenario.state()).pendingActions[0].submissionMode, 'direct');
  await scenario.confirm(true);
  assert.deepEqual(await scenario.balances(), expected('100'));
});

test('backup restore retains exposed recovery inputs and lineage before canonical reconciliation', async () => {
  const scenario = await createRelayRecoveryScenario(manifest, new SyntheticRecordDriver());
  await assert.rejects(scenario.prepare('helper-reject'));
  await scenario.prepare('approve', undefined, true);
  const pending = (await scenario.state()).pendingActions[0];
  await scenario.restoreBackup();
  assert.deepEqual((await scenario.state()).pendingActions, [pending]);
  assert.equal((await scenario.state()).spendRecovery.outcome, 'pending');
  assert.deepEqual(await scenario.balances(), expected('0', '100', '0', '0', 1));
  await scenario.sync();
  await scenario.confirm(true);
  assert.deepEqual(await scenario.balances(), expected('100'));
});

for (const mode of ['PENDING', 'ERROR', 'timeout', 'signer-reject']) test(`direct recovery ${mode} is never ledger confirmation`, async () => {
  const scenario = await createRelayRecoveryScenario(manifest, new SyntheticRecordDriver());
  await assert.rejects(scenario.prepare('helper-reject'));
  await scenario.prepare('approve', undefined, true);
  if (mode === 'signer-reject') await assert.rejects(scenario.submit(mode), /rejected signing/);
  else assert.equal((await scenario.submit(mode)).status, mode === 'PENDING' ? 'broadcast' : 'ambiguous');
  assert.equal((await scenario.state()).spendRecovery.outcome, 'pending');
  assert.deepEqual(await scenario.balances(), expected('0', '100', '0', '0', 1));
  // Another explicit attempt still uses exactly the original inputs.
  await scenario.prepare('approve', undefined, true);
  await scenario.confirm(true);
  assert.deepEqual(await scenario.balances(), expected('100'));
});

for (const [name, deposits, amount, change] of [
  ['one deposit with change', ['100'], '10', '87'],
  ['exact payment plus fee', ['13'], '10', '0'],
  ['two deposits with change', ['20', '20'], '30', '7'],
  ['fractional payment and change', ['20.5'], '10.125', '7.375'],
]) test(`Alice charges 3 XLM: ${name}`, async () => {
  const scenario = await createRelayRecoveryScenario(manifest, new SyntheticRecordDriver(), { deposits, amount });
  await scenario.prepare('approve');
  const submitted = await scenario.submit('PENDING');
  assert.equal(submitted.status, 'broadcast');
  assert.equal(submitted.rpcStatus, 'PENDING');
  assert.equal(scenario.submissions, 1);
  assert.deepEqual(await scenario.balances(), expected('0', String(deposits.reduce((n, value) => n + Number(value), 0)), '0', '0', 1));
  await scenario.confirm();
  assert.deepEqual(await scenario.balances(), expected(change, '0', '3', amount));
  await scenario.sync();
  assert.deepEqual(await scenario.balances(), expected(change, '0', '3', amount));
  assert.deepEqual(await scenario.freshScanBalances(), { bob: change, alice: '3', charlie: amount });
});

for (const [mode, error] of [['cancel', /Synthetic consent cancelled/], ['proof-failure', /Synthetic prover failure/],
  ['quote-expired', /helper quote expired before proof sharing/]]) test(`before sharing: ${mode} preserves Bob's spendable deposit`, async () => {
  const scenario = await createRelayRecoveryScenario(manifest, new SyntheticRecordDriver());
  await assert.rejects(scenario.prepare(mode), error);
  assert.deepEqual(await scenario.balances(), expected('100'));
  assert.equal(scenario.shared, 0);
  assert.ok(scenario.stages.includes('proving-locally'));
  assert.ok(!scenario.stages.includes('simulating'));
  assert.deepEqual(await scenario.journal(), { builds: 0, pending: [] });
});

test('payment fits but payment plus Alice fee does not: no input is reserved or shared', async () => {
  const scenario = await createRelayRecoveryScenario(manifest, new SyntheticRecordDriver(), { deposits: ['12'] });
  await assert.rejects(scenario.prepare('approve'), /insufficient/i);
  assert.deepEqual(await scenario.balances(), expected('12'));
  assert.equal(scenario.shared, 0);
});

for (const [mode, message] of [['helper-reject', 'Synthetic helper rejected preparation'], ['helper-timeout', 'Synthetic helper preparation timed out']]) test(`reproduction: ${mode} leaves the entire deposit reserved without any payment`, async () => {
  const scenario = await createRelayRecoveryScenario(manifest, new SyntheticRecordDriver());
  await assert.rejects(scenario.prepare(mode), error => error.name === 'PrivateProofExposedError' && error.cause?.message === message);
  assert.deepEqual(await scenario.balances(), expected('0', '100', '0', '0', 1));
  assert.equal(scenario.shared, 1);
  assert.equal(scenario.submissions, 0);
  assert.deepEqual(await scenario.journal(), { builds: 0, pending: [{ status: 'prepared', exposure: 'shared', attempts: 0, rpc: null, hasEnvelope: false }] });
  await scenario.expireAndRecover();
  assert.equal(scenario.senderLookups, 0);
  assert.deepEqual(await scenario.balances(), expected('0', '100', '0', '0', 1));
  await assert.rejects(scenario.prepare('approve'), error => error.name === 'PrivateActionInFlightError');
  await scenario.confirm();
  assert.deepEqual(await scenario.balances(), expected('87', '0', '3', '10'));
});

test('a helper failure holds the selected deposit but does not delete an unrelated deposit', async () => {
  const scenario = await createRelayRecoveryScenario(manifest, new SyntheticRecordDriver(), { deposits: ['100', '5'] });
  await assert.rejects(scenario.prepare('helper-reject'), error => error.name === 'PrivateProofExposedError');
  assert.deepEqual(await scenario.balances(), expected('5', '100', '0', '0', 1));
  await scenario.expireAndRecover();
  assert.deepEqual(await scenario.balances(), expected('5', '100', '0', '0', 1));
  assert.equal(scenario.senderLookups, 0);
});

test('three-input payment requires consolidation before any proof sharing or reservation', async () => {
  const scenario = await createRelayRecoveryScenario(manifest, new SyntheticRecordDriver(), { deposits: ['20', '20', '20'], amount: '50' });
  await assert.rejects(scenario.prepare('approve'), error => error.name === 'PrivateConsolidationRequiredError');
  assert.deepEqual(await scenario.balances(), expected('60'));
  assert.deepEqual(await scenario.journal(), { builds: 0, pending: [] });
  assert.equal(scenario.shared, 0);
});

test('minimized outgoing history still recovers Bob change, Alice fee and Charlie payment', async () => {
  const scenario = await createRelayRecoveryScenario(manifest, new SyntheticRecordDriver(), { outgoingHistory: 'minimized' });
  await scenario.prepare('approve');
  await scenario.submit('PENDING');
  await scenario.confirm();
  assert.deepEqual(await scenario.balances(), expected('87', '0', '3', '10'));
  assert.deepEqual(await scenario.freshScanBalances(), { bob: '87', alice: '3', charlie: '10' });
});

for (const [status, classification, rpcStatus] of [['PENDING', 'broadcast', 'PENDING'], ['ERROR', 'ambiguous', 'ERROR'],
  ['timeout', 'ambiguous', 'UNAVAILABLE'], ['signer-reject', 'reviewed', null]]) test(`${status} never invents confirmation, and canonical inclusion recovers all three outputs`, async () => {
  const scenario = await createRelayRecoveryScenario(manifest, new SyntheticRecordDriver());
  await scenario.prepare('approve');
  if (status === 'signer-reject') await assert.rejects(scenario.submit(status), /Synthetic Alice rejected signing/);
  else {
    const result = await scenario.submit(status);
    assert.equal(result.status, classification);
    assert.equal(result.rpcStatus, rpcStatus);
  }
  assert.equal(scenario.submissions, status === 'signer-reject' ? 0 : 1);
  assert.deepEqual(await scenario.journal(), { builds: 0, pending: [{ status: classification, exposure: 'shared',
    attempts: status === 'signer-reject' ? 0 : 1, rpc: rpcStatus, hasEnvelope: status !== 'signer-reject' }] });
  assert.deepEqual(await scenario.balances(), expected('0', '100', '0', '0', 1));
  await scenario.expireAndRecover();
  assert.equal(scenario.senderLookups, 0);
  assert.deepEqual(await scenario.balances(), expected('0', '100', '0', '0', 1));
  await scenario.confirm();
  assert.deepEqual(await scenario.balances(), expected('87', '0', '3', '10'));
  assert.deepEqual(await scenario.freshScanBalances(), { bob: '87', alice: '3', charlie: '10' });
});
