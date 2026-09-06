import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const sentinel = 'NON_USABLE_WALLET_CAPTURE_SENTINEL';

test('real locator/action failures preserve failure status without printing or retaining synthetic private payloads', () => {
  const output = mkdtempSync(path.join(tmpdir(), 'wallet-reporter-probe-'));
  try {
    const run = spawnSync(process.execPath, [
      'node_modules/@playwright/test/cli.js', 'test',
      '--config=tests/fixtures/wallet-reporter/playwright.config.ts', `--output=${output}`,
    ], { cwd: root, env: { ...process.env, CI: '1' }, encoding: 'utf8', timeout: 60_000 });
    assert.equal(run.error, undefined);
    assert.equal(run.status, 1, 'intentional browser failures must fail the process');
    const log = `${run.stdout}\n${run.stderr}`;
    assert.equal(log.includes(sentinel), false, 'raw browser payload escaped through output');
    assert.match(log, /sentinel\.spec\.ts:\d+: failed; errors=1/);
    assert.match(log, /completed=4; failed-attempts=3; skipped=0/);
    const inspect = directory => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) inspect(file);
        else {
          assert.equal(readFileSync(file).includes(sentinel), false, 'raw payload retained after browser failure cleanup');
          assert.doesNotMatch(entry.name, /error-context|\.png$|\.webm$|\.zip$/, 'browser capture retained');
        }
      }
    };
    inspect(output);
  } finally {
    rmSync(output, { recursive: true });
  }
});

test('effective runner configuration rejects capture/reporter overrides and live wallet environment before tests execute', () => {
  for (const override of [
    { args: ['--trace=on'], env: {} },
    { args: ['--reporter=line'], env: {} },
    { args: [], env: { PW_TEST_REPORTER: 'line' } },
    { args: [], env: { PRIVATE_BALANCE_E2E_SENDER_SECRET: sentinel } },
  ]) {
    const output = mkdtempSync(path.join(tmpdir(), 'wallet-policy-probe-'));
    try {
      const run = spawnSync(process.execPath, [
        'node_modules/@playwright/test/cli.js', 'test',
        '--config=tests/fixtures/wallet-reporter/playwright.config.ts', `--output=${output}`, ...override.args,
      ], { cwd: root, env: { ...process.env, CI: '1', ...override.env }, encoding: 'utf8', timeout: 30_000 });
      assert.equal(run.error, undefined);
      assert.equal(run.status, 1, 'unsafe effective configuration must fail');
      const log = `${run.stdout}\n${run.stderr}`;
      assert.equal(log.includes(sentinel), false, 'runner leaked the synthetic live-environment sentinel');
      assert.doesNotMatch(log, /sentinel\.spec\.ts:\d+: failed/, 'unsafe browser tests executed');
      assert.equal(readdirSync(output).some(name => name !== '.last-run.json'), false, 'unsafe run produced test artifacts');
    } finally {
      rmSync(output, { recursive: true });
    }
  }
});
