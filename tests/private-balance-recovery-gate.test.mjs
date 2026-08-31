import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('backend-free recovery gate runs without module or deprecation warnings', () => {
  const directory = mkdtempSync(join(tmpdir(), 'stellarkey-private-recovery-'));
  const output = join(directory, 'evidence.json');

  try {
    const result = spawnSync(process.execPath, [
      'protocol/private-balance/spikes/scripts/run-recovery.mjs',
      '--actions',
      '1',
      '--no-events',
      '--no-mirror',
      '--output',
      output,
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 30_000,
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.doesNotMatch(result.stderr, /MODULE_TYPELESS_PACKAGE_JSON|DeprecationWarning/);
    const evidence = JSON.parse(readFileSync(output, 'utf8'));
    assert.equal(evidence.passed, true);
    assert.equal(evidence.dataset.deterministicActions, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
