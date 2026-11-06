import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import * as vault from "../src/lib/vault.ts";
import * as signing from "../src/lib/signing-authorization.ts";
import * as walletApi from "../src/lib/api.ts";
import * as multisig from "../src/lib/multisig.ts";
import * as stealth from '../src/features/private-balance/runtime/stealth-payment.ts';
import { runPreparedBroadcast } from "../src/lib/submission.ts";
import * as privateSigning from '../src/lib/private-balance-signing.ts';
import { resolvePrivateFeePayer, assertSamePrivateFeePayer } from '../src/features/private-balance/runtime/fee-policy.ts';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// Execute production callbacks, including approval, scoped key decryption and
// prepared-broadcast ownership. Only React state and HTTP delivery are isolated.
function walletCallback(name, context) {
  const parsed = ts.createSourceFile('useWallet.tsx', read('src/hooks/useWallet.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === name && ts.isCallExpression(node.initializer)) {
      expression = node.initializer.arguments[0].getText(parsed);
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.ok(expression, 'The real wallet callback must exist');
  return vm.runInNewContext(ts.transpileModule(`(${expression})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, context);
}

function deferred() {
  let release;
  let entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  const promise = new Promise(resolve => { release = resolve; });
  return { waiting, release, run: () => { entered(); return promise; } };
}

async function signingHarness(t, gap) {
  const values = new Map();
  globalThis.window = { location: { origin: 'https://wallet.invalid' }, localStorage: {
    get length() { return values.size; }, key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key),
  } };
  vault.lockVault();
  t.after(() => { vault.lockVault(); delete globalThis.window; });
  const password = 'synthetic signing correct horse battery staple';
  const sourceSigner = Keypair.random();
  const { account } = await vault.initializeVault(password, { secret: sourceSigner.secret() });
  const pause = deferred();
  const signerInfo = { thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 },
    signers: [{ key: account.publicKey, weight: 1, type: 'ed25519_public_key' }] };
  const fingerprint = multisig.multisigAuthorityFingerprint(signerInfo);
  const destination = Keypair.random().publicKey();
  const envelope = new TransactionBuilder(new Account(account.publicKey, '1'), { fee: '100', networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.payment({ destination, asset: Asset.native(), amount: '1' })).setTimeout(300).build();
  const balanceId = '00000000' + 'ab'.repeat(32);
  const args = {
    sendBatch: [{ payments: [{ destination, amount: '1', assetCode: 'XLM' }] }],
    claimAirdrops: [[balanceId]], mergeAccount: [destination],
    trustAsset: [{ code: 'TEST', issuer: destination, add: true }],
    trustAssets: [[{ code: 'TEST', issuer: destination }]],
    applyMultisigConfig: [{ signers: [{ key: account.publicKey, weight: 1 }], low: 0, medium: 0, high: 0,
      authority: { expectedFingerprint: fingerprint, confirmedNewSignerKeys: [] } }],
    disableMultisig: [fingerprint], cosignTransaction: [envelope.toXdr(), 'testnet'],
    submitStealthPayment: [{ envelopeXdr: envelope.toXdr(), transactionHash: Buffer.from(envelope.hash()).toString('hex'),
      sourcePublicKey: account.publicKey, network: 'testnet', expiresAt: Number(envelope.timeBounds.maxTime) }],
  };
  const stats = { signs: 0, posts: 0, prepared: 0, discarded: 0, tracked: 0, externalChecks: 0, apiLoads: 0 };
  const originalSign = Keypair.prototype.sign;
  t.mock.method(Keypair.prototype, 'sign', function (...args) { stats.signs++; return originalSign.apply(this, args); });
  let held = false;
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = new URL(String(input));
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (init?.method === 'POST' && url.pathname === '/transactions') {
      stats.posts++;
      if (gap === 'broadcast') await pause.run();
      return json({});
    }
    if (/^\/accounts\/[^/]+$/.test(url.pathname)) {
      if (gap === 'preparation' && !held) { held = true; await pause.run(); }
      return json({ sequence: '1', ...signerInfo });
    }
    return json({}, 503);
  });
  const origin = { accountId: account.id, network: 'testnet', session: vault.getSessionSnapshot() };
  const current = { current: origin };
  const context = {
    ...vault, ...signing,
    assertSamePrivateFeePayer,
    resolvePrivateBalanceFeePayer: id => resolvePrivateFeePayer([account], account.id, id),
    activeAccount: account, network: 'testnet', signingContext: origin, signingContextRef: current,
    NETWORKS: { testnet: { networkPassphrase: Networks.TESTNET } },
    recommendedBaseFeeStroops: 100,
    hardwareSignerFor: () => gap === 'hardware' ? { device: 'trezor', publicKey: account.publicKey, path: "m/44'/148'/0'" } : undefined,
    requestSigningAuthorization: async () => { if (gap === 'approval') await pause.run(); },
    withSigningSecret: (account, hardware, operation) => hardware ? operation(undefined) : vault.withSigningKeypair(account.id, operation),
    runPreparedBroadcast,
    trackingTaskGeneration: { current: 0 },
    prepareSubmissionTracking: () => { stats.prepared++; },
    discardPreparedSubmission: () => { stats.discarded++; },
    trackSubmission: () => { stats.tracked++; },
    transactionTrackingRef: { current: { pending: [] } },
    loadWalletApi: async () => { stats.apiLoads++; if (gap === 'api') await pause.run(); return walletApi; },
    loadMultisigApi: async () => { stats.apiLoads++; if (gap === 'api') await pause.run(); return multisig; },
    loadStealthPaymentApi: async () => { stats.apiLoads++; if (gap === 'api') await pause.run(); return stealth; },
    loadPrivateBalanceSigningApi: async () => { stats.apiLoads++; if (gap === 'api') await pause.run(); return privateSigning; },
  };
  if (gap === 'hardware') {
    const { default: connect } = await import('@trezor/connect-web');
    t.mock.method(connect, 'init', async () => {});
    let transaction = envelope;
    const build = TransactionBuilder.prototype.build;
    t.mock.method(TransactionBuilder.prototype, 'build', function (...args) { transaction = build.apply(this, args); return transaction; });
    t.mock.method(connect, 'stellarSignTransaction', async () => {
      await pause.run();
      return { success: true, payload: { publicKey: Buffer.from(sourceSigner.rawPublicKey()).toString('hex'),
        signature: Buffer.from(sourceSigner.sign(transaction.hash())).toString('hex') } };
    });
  }
  context.captureSigningContext = () => walletCallback('captureSigningContext', context)();
  context.withAuthorizedSigningSecret = walletCallback('withAuthorizedSigningSecret', context);
  context.runTrackedBroadcast = walletCallback('runTrackedBroadcast', context);
  return {
    stats, pause, current, origin, context,
    runPrivate: () => {
      const transaction = new TransactionBuilder(new Account(account.publicKey, '1'), { fee: '100', networkPassphrase: Networks.TESTNET })
        .addOperation(Operation.bumpSequence({ bumpTo: '2' })).setTimeout(300).build();
      return walletCallback('signPrivateBalanceEnvelope', context)({ envelopeXdr: transaction.toXdr(),
        expectedTransactionHash: Buffer.from(transaction.hash()).toString('hex'), networkPassphrase: Networks.TESTNET });
    },
    run: (operation, extra = {}) => args[operation] ? walletCallback(operation, context)(...args[operation]) : walletCallback(operation, context)({
      destination: Keypair.random().publicKey(), amount: '1', assetCode: 'XLM',
      authorizeBeforeSigning: () => { stats.externalChecks++; },
      ...extra,
    }),
    replaceSession: async () => { vault.lockVault(); await vault.unlockVault(password); },
  };
}

const addedFlows = ['sendBatch', 'claimAirdrops', 'mergeAccount', 'trustAsset', 'trustAssets',
  'applyMultisigConfig', 'disableMultisig', 'cosignTransaction', 'submitStealthPayment'];

for (const operation of addedFlows) {
  for (const change of ['account', 'network', 'account-aba', 'network-aba', 'unmount', 'session']) {
    test(`${operation} rejects stale entry after ${change} before API loading`, async t => {
      const h = await signingHarness(t);
      if (change === 'session') await h.replaceSession();
      else h.current.current = change === 'unmount' ? null : { ...h.origin,
        ...(!change.endsWith('aba') ? { [change === 'account' ? 'accountId' : 'network']: 'changed' } : {}) };
      await assert.rejects(h.run(operation));
      assert.equal(h.stats.apiLoads, 0);
      assert.equal(h.stats.signs, 0);
      assert.equal(h.stats.posts, 0);
    });
  }
  for (const gap of operation === 'submitStealthPayment' ? ['api', 'approval'] : ['api', 'approval', 'preparation']) {
    for (const change of ['account', 'network', 'account-aba', 'network-aba', 'unmount', 'session', 'unchanged']) {
      test(`${operation} ${change === 'unchanged' ? 'retains' : 'rejects'} ${change} context during ${gap}`, async t => {
        const h = await signingHarness(t, gap);
        const outcome = h.run(operation).then(() => 'continued', () => 'rejected');
        await h.pause.waiting;
        if (change === 'session') await h.replaceSession();
        else if (change !== 'unchanged') h.current.current = change === 'unmount' ? null : { ...h.origin,
          ...(!change.endsWith('aba') ? { [change === 'account' ? 'accountId' : 'network']: 'changed' } : {}) };
        h.pause.release();
        assert.equal(await outcome, change === 'unchanged' ? 'continued' : 'rejected');
        assert.equal(h.stats.signs, change === 'unchanged' ? 1 : 0);
        assert.equal(h.stats.posts, change === 'unchanged' ? 1 : 0);
      });
    }
  }
}

for (const operation of addedFlows) {
  for (const change of ['account', 'network', 'unmount', 'unchanged']) {
    test(`${operation} revalidates ${change} context after synthetic Trezor approval`, async t => {
      const h = await signingHarness(t, 'hardware');
      const outcome = h.run(operation).then(() => 'continued', () => 'rejected');
      await Promise.race([h.pause.waiting, outcome.then(() => { throw new Error('Synthetic hardware action completed before approval boundary'); })]);
      if (change !== 'unchanged') h.current.current = change === 'unmount' ? null : { ...h.origin, [change === 'account' ? 'accountId' : 'network']: 'changed' };
      h.pause.release();
      assert.equal(await outcome, change === 'unchanged' ? 'continued' : 'rejected');
      assert.equal(h.stats.posts, change === 'unchanged' ? 1 : 0);
    });
  }
  for (const revoke of [false, true]) test(`${operation} guards queued pre-POST work (${revoke ? 'revoked' : 'current'})`, async t => {
    const h = await signingHarness(t);
    h.context.prepareSubmissionTracking = () => {
      h.stats.prepared++;
      if (revoke) queueMicrotask(() => { h.current.current = { ...h.origin, accountId: 'changed' }; });
    };
    const outcome = await h.run(operation).then(() => 'continued', () => 'rejected');
    assert.equal(outcome, revoke ? 'rejected' : 'continued');
    assert.equal(h.stats.posts, revoke ? 0 : 1);
    assert.equal(h.stats.discarded, revoke ? 1 : 0);
    assert.equal(h.stats.tracked, revoke ? 0 : 1);
  });
}

for (const gap of ['api', 'approval']) {
  for (const change of ['account', 'network', 'account-aba', 'network-aba', 'session']) test(`private envelope rejects ${change} replacement during ${gap}`, async t => {
    const harness = await signingHarness(t, gap);
    const outcome = harness.runPrivate().then(() => 'continued', () => 'rejected');
    await harness.pause.waiting;
    if (change === 'session') await harness.replaceSession();
    else {
      harness.current.current = { ...harness.origin, ...(change.startsWith('account') ? { accountId: 'other-account' } : { network: 'mainnet' }) };
      if (change.endsWith('aba')) harness.current.current = { ...harness.origin };
    }
    harness.pause.release();
    assert.equal(await outcome, 'rejected');
    assert.equal(harness.stats.signs, 0);
    assert.equal(harness.stats.posts, 0);
  });
  test(`private envelope preserves unchanged signing authority during ${gap}`, async t => {
    const harness = await signingHarness(t, gap);
    const outcome = harness.runPrivate();
    await harness.pause.waiting; harness.pause.release(); await outcome;
    assert.equal(harness.stats.signs, 1);
  });
}

for (const operation of ['send', 'prepareCosignPayment']) {
  for (const gap of ['api', 'approval', 'preparation']) {
    for (const change of ['account', 'network', 'account-aba', 'network-aba', 'session']) {
      test(`${operation} rejects ${change} context replacement during ${gap}`, async t => {
        const harness = await signingHarness(t, gap);
        const outcome = harness.run(operation).then(() => 'continued', () => 'rejected');
        await harness.pause.waiting;
        if (change === 'session') await harness.replaceSession();
        else {
          const changed = change.startsWith('account') ? { accountId: 'other-account' } : { network: 'mainnet' };
          harness.current.current = { ...harness.origin, ...changed };
          if (change.endsWith('aba')) harness.current.current = { ...harness.origin };
        }
        harness.pause.release();
        assert.equal(await outcome, 'rejected');
        assert.equal(harness.stats.signs, 0);
        assert.equal(harness.stats.posts, 0);
      });
    }
    test(`${operation} retains unchanged context through ${gap}`, async t => {
      const harness = await signingHarness(t, gap);
      const outcome = harness.run(operation);
      await harness.pause.waiting;
      harness.pause.release();
      await outcome;
      assert.equal(harness.stats.signs, 1);
      assert.equal(harness.stats.posts, operation === 'send' ? 1 : 0);
    });
  }
  for (const change of ['account', 'network', 'unmount', 'session']) test(`${operation} rejects stale callback entry before API loading after ${change}`, async t => {
    const harness = await signingHarness(t);
    if (change === 'session') await harness.replaceSession();
    else harness.current.current = change === 'unmount' ? null : { ...harness.origin, [change === 'account' ? 'accountId' : 'network']: 'changed' };
    await assert.rejects(harness.run(operation));
    assert.equal(harness.stats.apiLoads, 0);
    assert.equal(harness.stats.signs, 0);
    assert.equal(harness.stats.posts, 0);
  });
  test(`${operation} ignores another tab's stored network preference until visible selection changes`, async t => {
    const harness = await signingHarness(t);
    vault.saveNetworkPref('mainnet');
    await harness.run(operation);
    assert.equal(harness.stats.signs, 1);
    assert.equal(harness.stats.posts, operation === 'send' ? 1 : 0);
  });
  test(`${operation} preserves external signing authorization`, async t => {
    const harness = await signingHarness(t);
    await assert.rejects(harness.run(operation, { authorizeBeforeSigning: () => { throw new Error('External permission was revoked.'); } }), /External permission/);
    assert.equal(harness.stats.signs, 0);
    assert.equal(harness.stats.posts, 0);
  });
}

test('send rechecks context after a delayed prepared-submission journal without posting', async t => {
  const harness = await signingHarness(t);
  const outcome = harness.run('send', { submissionJournal: { onPrepared: () => harness.pause.run() } });
  const rejection = assert.rejects(outcome);
  await harness.pause.waiting;
  harness.current.current = { ...harness.origin, accountId: 'other' };
  harness.pause.release();
  await rejection;
  assert.equal(harness.stats.signs, 1);
  assert.equal(harness.stats.posts, 0);
  assert.equal(harness.stats.prepared, 1);
  assert.equal(harness.stats.discarded, 1);
  assert.equal(harness.stats.tracked, 0);
});

test('send preserves external authorization at the final prepared broadcast boundary', async t => {
  const harness = await signingHarness(t);
  await assert.rejects(harness.run('send', { authorizeBeforeSigning: () => {
    if (harness.stats.signs > 0) throw new Error('External permission was revoked.');
  } }), /External permission/);
  assert.equal(harness.stats.signs, 1);
  assert.equal(harness.stats.posts, 0);
  assert.equal(harness.stats.discarded, 1);
});

for (const revoke of [true, false]) test(`send ${revoke ? 'rejects revoked' : 'retains unchanged'} authority in a queued pre-POST continuation`, async t => {
  const harness = await signingHarness(t);
  let queued = false;
  const outcome = await harness.run('send', { authorizeBeforeSigning: () => {
    if (!queued && harness.stats.prepared > 0) {
      queued = true;
      queueMicrotask(() => { if (revoke) harness.current.current = { ...harness.origin, accountId: 'other' }; });
    }
  } }).then(() => 'continued', () => 'rejected');
  assert.equal(queued, true);
  assert.equal(harness.stats.posts, revoke ? 0 : 1);
  assert.equal(outcome, revoke ? 'rejected' : 'continued');
  assert.equal(harness.stats.discarded, revoke ? 1 : 0);
  assert.equal(harness.stats.tracked, revoke ? 0 : 1);
});

test('a context change after broadcast preserves canonical tracking ownership', async t => {
  const harness = await signingHarness(t, 'broadcast');
  const outcome = harness.run('send');
  await harness.pause.waiting;
  harness.current.current = { ...harness.origin, network: 'mainnet' };
  harness.pause.release();
  await outcome;
  assert.equal(harness.stats.signs, 1);
  assert.equal(harness.stats.posts, 1);
  assert.equal(harness.stats.tracked, 1);
  assert.equal(harness.stats.discarded, 0);
});

test("new wallet setup asks whether every transaction needs a password", () => {
  const onboarding = read("src/components/Onboarding.tsx");

  assert.match(onboarding, /useState\(true\)/);
  assert.match(onboarding, />\s*Require password to sign\s*</);
  assert.match(onboarding, />\s*Recommended · Password required to disable\s*</);
  assert.doesNotMatch(onboarding, /Confirm your password before each transaction/);
  assert.match(onboarding, /label="Require password before signing transactions"/);
  assert.ok((onboarding.match(/requirePasswordForSigning/g) ?? []).length >= 6);
});

test("Signing Security exposes password rotation and protects policy disable", () => {
  const settings = read("src/components/SettingsPage.tsx");

  assert.match(settings, /label="Require Password to Sign"/);
  assert.match(settings, /label="Change Wallet Password"/);
  assert.match(
    settings,
    /changeSigningPasswordRequired\(false, disableSigningPassword\)/,
  );
  assert.match(settings, /title="Turn Off Password Confirmation\?"/);
  assert.match(settings, /label="Current Wallet Password"/);
  assert.match(settings, /title="Change Wallet Password"/);
  assert.match(settings, /autoComplete="current-password"/);
  assert.ok((settings.match(/autoComplete="new-password"/g) ?? []).length >= 2);
  assert.match(settings, /role="meter"/);
  assert.match(settings, /Existing Face ID or Touch ID[\s\S]*remains available/);
});
