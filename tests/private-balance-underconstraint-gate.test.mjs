import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repoRoot = new URL('..', import.meta.url).pathname;
const runner = join(
  repoRoot,
  'protocol/private-balance/circuits/scripts/run-underconstraint.mjs',
);
const pinnedCommit = 'af7d4ed0325e6f7743d8a1ac0e415d0c69b8aae8';

function fixtureAnalyzer() {
  const directory = mkdtempSync(join(tmpdir(), 'stellarkey-civer-fixture-'));
  const executable = join(directory, 'civer-fixture.mjs');
  const log = join(directory, 'invocations.jsonl');
  writeFileSync(log, '', 'utf8');
  writeFileSync(executable, `#!/usr/bin/env node
import { appendFileSync, existsSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_CIVER_LOG, JSON.stringify(args) + '\\n');
if (args.includes('--version')) {
  console.log('circom compiler 2.1.6');
  process.exit(0);
}
const outputIndex = args.indexOf('-o');
if (outputIndex >= 0 && !existsSync(args[outputIndex + 1])) {
  console.error('invalid output path');
  process.exit(1);
}
if (args.some(value => value.endsWith('underconstrained.circom'))) {
  console.log('-> CIVER could not verify weak safety of all components');
  console.log('    - UnderconstrainedFixture(),');
  console.log('  * Number of verified components (weak-safety): 0');
  console.log('  * Number of failed components (weak-safety): 1');
  console.log('  * Number of timeout components (weak-safety): 0');
  process.exit(0);
}
if (process.env.FAKE_CIVER_PRODUCTION === 'timeout') {
  console.log('-> CIVER could not verify weak safety of all components');
  console.log('  * Number of verified components (weak-safety): 17');
  console.log('  * Number of failed components (weak-safety): 0');
  console.log('  * Number of timeout components (weak-safety): 1');
  process.exit(0);
}
console.log('-> All components satisfy weak safety :)');
console.log('  * Number of verified components (weak-safety): 18');
console.log('  * Number of failed components (weak-safety): 0');
console.log('  * Number of timeout components (weak-safety): 0');
console.log('  * Percentage of verified constraints: 100 - (103717 / 103717)');
`, 'utf8');
  chmodSync(executable, 0o755);
  return { executable, log };
}

function runGate(productionResult = 'pass', sourceCommit = pinnedCommit) {
  const fixture = fixtureAnalyzer();
  const result = spawnSync(process.execPath, [runner], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      CIVER_CIRCOM: fixture.executable,
      CIVER_SOURCE_COMMIT: sourceCommit,
      FAKE_CIVER_LOG: fixture.log,
      FAKE_CIVER_PRODUCTION: productionResult,
    },
  });
  return {
    ...result,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
    invocations: readFileSync(fixture.log, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line)),
  };
}

test('Gate A rejects a production weak-safety timeout even when CIVER exits zero', () => {
  const result = runGate('timeout');
  assert.notEqual(result.status, 0);
  assert.match(result.output, /production analysis timed out/i);
});

test('Gate A pins CIVER and proves the negative control before production', () => {
  const wrongCommit = runGate('pass', '0'.repeat(40));
  assert.notEqual(wrongCommit.status, 0);
  assert.match(wrongCommit.output, new RegExp(pinnedCommit));

  const result = runGate();
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /18 verified components, 103717 verified constraints/i);

  const analyzed = result.invocations.filter(args => !args.includes('--version'));
  assert.equal(analyzed.length, 2);
  assert.match(analyzed[0][0], /underconstrained\.circom$/);
  assert.match(analyzed[1][0], /action\.circom$/);
  for (const args of analyzed) {
    assert.ok(args.includes('--check_safety'));
    assert.ok(args.includes('--apply_deduction_assigned'));
    assert.ok(args.includes('--O2'));
    assert.deepEqual(
      args.slice(args.indexOf('--verification_timeout'), args.indexOf('--verification_timeout') + 2),
      ['--verification_timeout', '60000'],
    );
  }
});

test('the circuit Gate A runs static analysis, weak safety, vectors, and mutations', () => {
  const packageJson = JSON.parse(readFileSync(join(
    repoRoot,
    'protocol/private-balance/circuits/package.json',
  ), 'utf8'));
  assert.equal(
    packageJson.scripts['inspect:underconstraint'],
    'node scripts/run-underconstraint.mjs',
  );
  assert.equal(
    packageJson.scripts['gate:a'],
    'npm run inspect:circomspect && npm run inspect:underconstraint && npm test && npm run test:mutation',
  );
});
