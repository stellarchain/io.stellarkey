import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = new URL('../', import.meta.url);

test('wallet browser configs disable automatic captures and retain no test output', async () => {
  for (const file of ['playwright.config.ts', 'playwright.private-components.config.ts']) {
    const { default: config } = await import(new URL(file, root));
    for (const capture of ['screenshot', 'trace', 'video']) {
      assert.equal(config.use[capture], 'off', `${file}: ${capture} must be off`);
    }
    assert.equal(config.preserveOutput, 'never');
    assert.equal(config.webServer.reuseExistingServer, false);
    assert.deepEqual(config.reporter, [['./scripts/testing/safe-wallet-reporter.mjs']]);
    assert.equal(config.globalSetup, './scripts/testing/wallet-test-policy.mjs');
  }
  assert.equal(process.env.PLAYWRIGHT_NO_COPY_PROMPT, '1');
});

test('every configured isolated component spec requires runner intent before browser setup', async () => {
  const { default: config } = await import('../playwright.private-components.config.ts');
  assert.ok(Array.isArray(config.testMatch) && config.testMatch.length > 0, 'isolated component specs must be explicitly configured');
  for (const file of config.testMatch) {
    assert.equal(typeof file, 'string', 'isolated component specs must remain individually inspectable');
    const source = readFileSync(new URL(`e2e/${file}`, root), 'utf8');
    const guard = source.search(/^test\.skip\(\s*!process\.env\.PRIVATE_COMPONENT_FIXTURE_SHA256\s*,/m);
    assert.ok(guard >= 0, `${file}: require isolated runner intent before executing browser checks`);
    const setup = source.indexOf('test.beforeEach(');
    assert.ok(setup < 0 || guard < setup, `${file}: runner intent must be checked before browser setup`);
  }
});

test('wallet runner rejects capture overrides, unsafe reporters, and usable wallet imports', async () => {
  const policyUrl = new URL('scripts/testing/wallet-test-policy.mjs', root);
  assert.equal(existsSync(policyUrl), true, 'wallet runner needs a fail-closed capture policy');
  const { assertSafeWalletConfig, assertLiveWalletTestingSafe } = await import(policyUrl);
  const safe = {
    preserveOutput: 'never',
    reporter: [[new URL('scripts/testing/safe-wallet-reporter.mjs', root).pathname]],
    projects: [{ use: { screenshot: 'off', trace: 'off', video: 'off' } }],
  };
  assert.doesNotThrow(() => assertSafeWalletConfig(safe));
  for (const capture of ['screenshot', 'trace', 'video']) {
    assert.throws(() => assertSafeWalletConfig({ ...safe, projects: [{ use: { ...safe.projects[0].use, [capture]: 'on' } }] }), /capture/i);
  }
  assert.throws(() => assertSafeWalletConfig({ ...safe, preserveOutput: 'always' }), /output/i);
  assert.throws(() => assertSafeWalletConfig({ ...safe, reporter: [['line']] }), /reporter/i);
  assert.throws(() => assertSafeWalletConfig(safe, { PW_TEST_REPORTER: 'line' }), /reporter/i);
  assert.throws(() => assertLiveWalletTestingSafe(), /Live wallet.*failure snapshots/i);
});

test('local Waku integration requires both fixture ownership and explicit network intent', () => {
  const source = readFileSync(new URL('e2e/relay-waku-live.spec.ts', root), 'utf8');
  const fixtureGuard = source.indexOf('test.skip(!process.env.PRIVATE_COMPONENT_FIXTURE_SHA256,');
  const networkGuard = source.indexOf("test.skip(process.env.E2E_WAKU_LOCAL_NODES !== '1',");
  const setup = source.indexOf("test('real local SDK");
  assert.ok(fixtureGuard >= 0 && networkGuard >= 0 && fixtureGuard < setup && networkGuard < setup);
  const fixture = readFileSync(new URL('e2e/fixtures/relay-waku-panel.tsx', root), 'utf8');
  assert.doesNotMatch(fixture, /PrivateRelayMessenger\.create\s*=/);
  assert.match(fixture, /Live connection check cannot publish/);
  assert.match(fixture, /crypto\.randomUUID\(\)/);
});

test('Testnet runner refuses before build, funding, and browser import', async () => {
  const { runTestnetE2e } = await import('../protocol/private-balance/scripts/run-testnet-e2e.mjs');
  await assert.rejects(runTestnetE2e(['--fixture', 'does-not-exist']), /Live wallet.*failure snapshots/i);
  const { importLiveWallet } = await import('../e2e/private-balance/helpers.ts');
  await assert.rejects(importLiveWallet({ goto() { assert.fail('Live browser was touched'); } }, 'NON_USABLE_SYNTHETIC_SENTINEL'), /Live wallet.*failure snapshots/i);
});

test('wallet reporter emits locations and structural failures without reading payloads', async () => {
  const reporterUrl = new URL('scripts/testing/safe-wallet-reporter.mjs', root);
  assert.equal(existsSync(reporterUrl), true, 'wallet tests need a structural-only reporter');
  const { default: Reporter } = await import(reporterUrl);
  const output = [];
  const reporter = new Reporter({ write: text => output.push(text) });
  const sensitive = { toString() { assert.fail('Reporter read a private payload'); } };
  const check = { location: { file: new URL('e2e/wallet.spec.ts', root).pathname, line: 42, column: 3 }, title: sensitive, parent: { project: () => ({ name: 'iphone-webkit' }) } };
  const result = { status: 'failed', retry: 0, errors: [sensitive], attachments: [sensitive], stdout: [sensitive], stderr: [sensitive] };
  reporter.onBegin({ rootDir: root.pathname }, { allTests: () => [check] });
  reporter.onStdOut(sensitive);
  reporter.onStdErr(sensitive);
  reporter.onError(sensitive);
  reporter.onTestEnd(check, result);
  assert.equal(await reporter.onEnd({ status: 'failed' }), undefined, 'reporter must not override failure status');
  assert.match(output.join(''), /e2e\/wallet\.spec\.ts:42/);
  assert.match(output.join(''), /\[iphone-webkit\]/);
  assert.match(output.join(''), /failed.*errors=1/);
  assert.match(output.join(''), /Runner error/);
  assert.doesNotMatch(JSON.stringify(reporter), /attachments|stdout|stderr/);
});

test('wallet reporter emits failed step lines without reading or retaining payloads', async () => {
  const { default: Reporter } = await import('../scripts/testing/safe-wallet-reporter.mjs');
  const output = [];
  const reporter = new Reporter({ write: text => output.push(text) });
  const fields = Reflect.ownKeys(reporter);
  const unreadable = (target, names) => {
    for (const name of names) Object.defineProperty(target, name, {
      get() { assert.fail('Reporter read a private payload field'); },
    });
    return Object.freeze(target);
  };
  const error = unreadable({}, ['message', 'stack', 'snippet', 'cause', 'value', 'location', 'toString']);
  const result = unreadable({}, ['status', 'errors', 'attachments', 'stdout', 'stderr']);
  for (const file of ['e2e/wallet.spec.ts', 'tests/fixtures/wallet-reporter/sentinel.spec.ts']) {
    const location = { file: new URL(file, root).pathname, line: 84, column: 7 };
    const check = unreadable({ location: { ...location, line: 42 } }, ['title', 'parent', 'annotations']);
    const step = unreadable({ location, error }, ['title', 'category', 'duration', 'parent', 'steps', 'attachments', 'annotations', 'titlePath']);
    assert.equal(reporter.onStepEnd?.(check, result, step), undefined);
  }
  assert.deepEqual(output, [
    'Wallet browser failed step: e2e/wallet.spec.ts:84.\n',
    'Wallet browser failed step: tests/fixtures/wallet-reporter/sentinel.spec.ts:84.\n',
  ]);
  assert.deepEqual(Reflect.ownKeys(reporter), fields, 'step and error objects must not be retained');
  assert.deepEqual([reporter.completed, reporter.failures, reporter.skipped], [0, 0, 0], 'step diagnostics must not change test counts');
});

test('wallet reporter ignores successful steps and missing or invalid step locations', async () => {
  const { default: Reporter } = await import('../scripts/testing/safe-wallet-reporter.mjs');
  const output = [];
  const reporter = new Reporter({ write: text => output.push(text) });
  const file = new URL('e2e/wallet.spec.ts', root).pathname;
  const check = { location: { file, line: 42 } };
  reporter.onStepEnd?.(check, {}, {
    get location() { assert.fail('Successful step location must not be inspected'); },
  });
  for (const location of [undefined, null, {}, { file }, { file: null, line: 84 }]) {
    reporter.onStepEnd?.(check, {}, { error: {}, location });
  }
  for (const line of [undefined, null, 0, -1, 1.5, NaN, Infinity, '84', 84n]) {
    reporter.onStepEnd?.(check, {}, { error: {}, location: { file, line } });
  }
  reporter.onStepEnd?.({}, {}, { error: {}, location: { file, line: 84 } });
  reporter.onStepEnd?.(check, {}, { error: {}, location: { file: new URL('e2e/merchant.spec.ts', root).pathname, line: 84 } });
  for (const invalidFile of [
    'e2e/wallet.spec.ts',
    new URL('src/app/page.tsx', root).pathname,
    '/tmp/e2e/wallet.spec.ts',
    `${root.pathname}e2e/../e2e/wallet.spec.ts`,
    `${root.pathname}e2e/./wallet.spec.ts`,
    `${root.pathname}e2e/wallet\n.spec.ts`,
    `${root.pathname}e2e/wallet.spec.ts\n`,
    `${root.pathname}e2e/wallet.spec.ts\r`,
    `${root.pathname}e2e/wallet.spec.ts\u2028`,
    { toString() { assert.fail('Reporter coerced an invalid source path'); } },
  ]) {
    const location = { file: invalidFile, line: 84 };
    reporter.onStepEnd?.({ location }, {}, { error: {}, location });
  }
  assert.deepEqual(output, [], 'unvalidated source locations must not be emitted');
});

test('required isolated component checks cannot pass by skipping every test', async () => {
  const { default: Reporter } = await import('../scripts/testing/safe-wallet-reporter.mjs');
  const reporter = new Reporter({ write() {} });
  const check = { location: { file: new URL('e2e/private-components.spec.ts', root).pathname, line: 1 } };
  reporter.onBegin({ metadata: { requiredSyntheticComponents: true } }, { allTests: () => [check] });
  reporter.onTestEnd(check, { status: 'skipped', retry: 0, errors: [] });
  assert.deepEqual(reporter.onEnd({ status: 'passed' }), { status: 'failed' });
});

test('listing isolated component checks remains a non-executing collection operation', async () => {
  const { default: Reporter } = await import('../scripts/testing/safe-wallet-reporter.mjs');
  const previous = process.argv;
  try {
    process.argv = [...previous, '--list'];
    const reporter = new Reporter({ write() {} });
    reporter.onBegin({ metadata: { requiredSyntheticComponents: true } }, { allTests: () => [{}] });
    assert.equal(reporter.onEnd({ status: 'passed' }), undefined);
  } finally {
    process.argv = previous;
  }
});

test('fixture cleanup gate rejects source routes and exported fixture references', async () => {
  const policyUrl = new URL('scripts/testing/wallet-test-policy.mjs', root);
  assert.equal(existsSync(policyUrl), true, 'wallet runner needs verified fixture cleanup');
  const { assertNoPrivateComponentFixture } = await import(policyUrl);
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'wallet-cleanup-test-'));
  try {
    assert.doesNotThrow(() => assertNoPrivateComponentFixture(fixtureRoot));
    const route = path.join(fixtureRoot, 'src/app/private-component-fixture');
    mkdirSync(route, { recursive: true });
    assert.throws(() => assertNoPrivateComponentFixture(fixtureRoot), /fixture/i);
    rmSync(route, { recursive: true });
    mkdirSync(path.join(fixtureRoot, 'out/_next'), { recursive: true });
    const bundle = path.join(fixtureRoot, 'out/_next/synthetic.js');
    writeFileSync(bundle, 'private-component-fixture');
    assert.throws(() => assertNoPrivateComponentFixture(fixtureRoot), /fixture/i);
    rmSync(bundle);
    writeFileSync(path.join(fixtureRoot, 'out/private-component-fixture.html'), 'synthetic');
    assert.throws(() => assertNoPrivateComponentFixture(fixtureRoot), /fixture/i);
  } finally {
    rmSync(fixtureRoot, { recursive: true });
  }
});
