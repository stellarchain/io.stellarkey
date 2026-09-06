import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Execute actual handlers; the browser suite separately exercises real wallet,
// encryption, signing, HTTP delivery, tracking and Modal composition.
function handler(component, name, context) {
  const source = readFileSync(new URL(`../src/components/${component}.tsx`, import.meta.url), 'utf8');
  const parsed = ts.createSourceFile(component, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) expression = node.getText(parsed);
    if (name === 'trackedConfirmationEffect' && ts.isCallExpression(node) && node.expression.getText(parsed) === 'useEffect') {
      const callback = node.arguments[0]?.getText(parsed);
      if (callback?.includes('trackedStatus')) expression = callback;
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.ok(expression);
  return vm.runInNewContext(ts.transpileModule(`(${expression})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, context);
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function context() {
  const state = { closes: 0, writes: 0, haptics: 0, busy: false, error: null };
  const set = () => { state.writes++; };
  const scope = {
    Error,
    ownerRef: { current: true }, busyRef: { current: false },
    mode: 'import', secretInput: 'synthetic', label: '', watchKey: '', canSubmit: true,
    busy: false, hasMnemonicVault: false, selectedIds: ['synthetic'], pendingAirdropClaim: false,
    pendingSubmission: null, activeAccount: { watchOnly: false }, confirmed: false,
    setBusy(value) { state.busy = value; state.writes++; },
    setError(value) { state.error = value; state.writes++; },
    setSelected: set, setPendingSubmission: set, setLabel: set, setSecretInput: set,
    setWatchKey: set, setConnectedInfo: set, setHardwareIndex: set, setMode: set,
    setConfirmed: set,
    triggerHaptic() { state.haptics++; },
    onClose() { state.closes++; },
  };
  return { state, scope };
}

for (const component of ['AddAccountModal', 'ClaimableBalancesModal']) {
  for (const outcome of ['success', 'failure']) {
    test(`${component} ignores ${outcome} and final cleanup after its owner is revoked`, async () => {
      const { state, scope } = context();
      const operation = deferred();
      scope.addAccount = scope.claimAirdrops = () => operation.promise;
      scope.refresh = async () => {};
      const act = handler(component, component === 'AddAccountModal' ? 'handleCreate' : 'handleClaimSelected', scope);
      const result = act();
      scope.ownerRef.current = false;
      const before = { ...state };
      if (outcome === 'success') operation.resolve({ status: 'confirmed' });
      else operation.reject(new Error('Synthetic transport payload must not appear'));
      await result;
      assert.deepEqual(state, before);
    });
  }

  test(`${component} rejects a second activation before React commits busy state`, async () => {
    const { scope } = context();
    const operation = deferred();
    let requests = 0;
    scope.addAccount = scope.claimAirdrops = () => { requests++; return operation.promise; };
    scope.refresh = async () => {};
    const act = handler(component, component === 'AddAccountModal' ? 'handleCreate' : 'handleClaimSelected', scope);
    const first = act();
    const second = act();
    operation.resolve({ status: 'confirmed' });
    await Promise.all([first, second]);
    assert.equal(requests, 1);
  });
}

test('canonical claim confirmation releases close guards before waiting for refresh', async () => {
  const { scope, state } = context();
  const refresh = deferred();
  scope.claimAirdrops = async () => ({ status: 'confirmed' });
  scope.refresh = () => refresh.promise;
  const act = handler('ClaimableBalancesModal', 'handleClaimSelected', scope);
  const result = act();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.busy, false);
  assert.equal(scope.busyRef.current, false);
  refresh.resolve();
  await result;
  assert.equal(state.closes, 1);
});

test('a confirmed claim refresh rejection preserves canonical success and hides raw details', async () => {
  const { scope, state } = context();
  scope.claimAirdrops = async () => ({ status: 'confirmed' });
  scope.refresh = async () => { throw new Error('Synthetic transport payload must not appear'); };
  await handler('ClaimableBalancesModal', 'handleClaimSelected', scope)();
  assert.equal(state.closes, 0);
  assert.equal(state.error, 'Claim confirmed, but balances could not be refreshed. Close this review and refresh your wallet.');
});

for (const outcome of ['success', 'failure']) {
  test(`hardware connection ignores ${outcome} after its modal owner is revoked`, async () => {
    const { state, scope } = context();
    const operation = deferred();
    scope.hardwareIndex = 0;
    scope.connectTrezorDevice = () => operation.promise;
    const result = handler('AddAccountModal', 'handleConnectHardware', scope)();
    scope.ownerRef.current = false;
    const before = { ...state };
    if (outcome === 'success') operation.resolve({ label: 'Synthetic device' });
    else operation.reject(new Error('Synthetic failure'));
    await result;
    assert.deepEqual(state, before);
  });
}

for (const [component, action] of [['AddAccountModal', 'handleClose'], ['ClaimableBalancesModal', 'handleClose'], ['ClaimableBalancesModal', 'handleAddAsset']]) {
  test(`${component} ${action} shares the synchronous busy guard`, () => {
    const { state, scope } = context();
    scope.onAddAsset = scope.onClose;
    scope.busyRef.current = true;
    handler(component, action, scope)();
    assert.equal(state.closes, 0);
    scope.busyRef.current = false;
    handler(component, action, scope)();
    assert.equal(state.closes, 1);
  });
}

test('tracked confirmation scopes a refresh failure without rejecting the effect or changing its confirmed outcome', async () => {
  const { state, scope } = context();
  scope.pendingSubmission = { status: 'accepted' };
  scope.trackedStatus = 'confirmed';
  scope.onCloseRef = { current: scope.onClose };
  scope.refresh = async () => { throw new Error('Synthetic response detail'); };
  handler('ClaimableBalancesModal', 'trackedConfirmationEffect', scope)();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.error, 'Claim confirmed, but balances could not be refreshed. Close this review and refresh your wallet.');
  assert.equal(state.closes, 0);
  assert.equal(state.haptics, 0);
});

test('tracked confirmation uses the latest close callback without restarting refresh', async () => {
  const { state, scope } = context();
  const operation = deferred();
  let refreshes = 0;
  let latestCloses = 0;
  scope.pendingSubmission = { status: 'accepted' };
  scope.trackedStatus = 'confirmed';
  scope.onCloseRef = { current: scope.onClose };
  scope.refresh = () => { refreshes++; return operation.promise; };
  handler('ClaimableBalancesModal', 'trackedConfirmationEffect', scope)();
  await new Promise(resolve => setImmediate(resolve));
  scope.onCloseRef.current = () => { latestCloses++; };
  operation.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(refreshes, 1);
  assert.equal(latestCloses, 1);
  assert.equal(state.closes, 0);
});

test('tracked confirmation refresh ignores late rejection after layout revocation', async () => {
  const { state, scope } = context();
  const operation = deferred();
  scope.pendingSubmission = { status: 'accepted' };
  scope.trackedStatus = 'confirmed';
  scope.onCloseRef = { current: scope.onClose };
  scope.refresh = () => operation.promise;
  handler('ClaimableBalancesModal', 'trackedConfirmationEffect', scope)();
  await new Promise(resolve => setImmediate(resolve));
  scope.ownerRef.current = false;
  const before = { ...state };
  operation.reject(new Error('Synthetic late refresh failure'));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(state, before);
});
