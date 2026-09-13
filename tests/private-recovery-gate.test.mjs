import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRecoveryGateEvidence,
  parseRecoveryGateArguments,
} from '../protocol/private-balance/spikes/scripts/recovery-gate-lib.mjs';
import {
  validateCurveBenchmarkEvidence,
} from '../protocol/private-balance/spikes/scripts/run-curve-benchmark.mjs';
import { readFileSync } from 'node:fs';

test('recovery gate requires the backend-free sources to be disabled', () => {
  assert.throws(
    () => parseRecoveryGateArguments(['--actions', '10000', '--no-events']),
    /--no-mirror/i,
  );
  assert.throws(
    () => parseRecoveryGateArguments(['--actions', '10000', '--no-mirror']),
    /--no-events/i,
  );
  assert.deepEqual(
    parseRecoveryGateArguments([
      '--actions', '10000', '--no-events', '--no-mirror', '--output', 'result.json',
    ]),
    {
      actionCount: 10_000,
      eventsEnabled: false,
      mirrorEnabled: false,
      outputPath: 'result.json',
    },
  );
});

test('recovery gate rejects invalid or misleading action counts', () => {
  for (const value of ['0', '-1', '1.5', '100001', 'words']) {
    assert.throws(
      () => parseRecoveryGateArguments([
        '--actions', value, '--no-events', '--no-mirror',
      ]),
      /actions/i,
    );
  }
});

test('recovery evidence reports exact canonical and owned results', () => {
  assert.deepEqual(buildRecoveryGateEvidence({
    actionCount: 10_000,
    recordBatchSize: 200,
    ownedActionCount: 10,
    recoveredActivityCount: 10,
    recoveredBalance: 55n,
    expectedBalance: 55n,
    finalRecordHash: 'ab'.repeat(32),
    finalTreeRoot: 'cd'.repeat(32),
    elapsedMs: 1_234,
    peakRssBytes: 5_000_000,
    completedAt: '2026-08-30T00:00:00.000Z',
  }), {
    schemaVersion: 2,
    scope: 'backend-free-seed-recovery-mvp',
    passed: true,
    completedAt: '2026-08-30T00:00:00.000Z',
    sources: { events: false, mirror: false, indexer: false },
    dataset: {
      deterministicActions: 10_000,
      canonicalRecords: 10_000,
      recordBatches: 50,
      recordBatchSize: 200,
      ownedActions: 10,
    },
    checks: {
      everyRecordHashLinked: true,
      finalTranscriptHeadMatched: true,
      finalTreeRootMatched: true,
      exactOwnedBalanceRecovered: true,
      exactOwnedActivityRecovered: true,
    },
    recovery: {
      expectedBalance: '55',
      recoveredBalance: '55',
      recoveredActivityCount: 10,
      finalRecordHash: 'ab'.repeat(32),
      finalTreeRoot: 'cd'.repeat(32),
      elapsedMs: 1_234,
      peakRssBytes: 5_000_000,
    },
    limitations: [
      'This local scanner gate is paired with the controlled-Core archive gate; it does not claim that 10,000 actions were submitted on chain.',
      'This is minimal MVP evidence, not Gate D beta approval or Gate E mainnet approval.',
    ],
  });
});

test('recovery evidence fails closed on any balance or activity mismatch', () => {
  assert.throws(
    () => buildRecoveryGateEvidence({
      actionCount: 10,
      recordBatchSize: 200,
      ownedActionCount: 2,
      recoveredActivityCount: 1,
      recoveredBalance: 1n,
      expectedBalance: 2n,
      finalRecordHash: 'ab'.repeat(32),
      finalTreeRoot: 'cd'.repeat(32),
      elapsedMs: 1,
      peakRssBytes: 1,
      completedAt: '2026-08-30T00:00:00.000Z',
    }),
    /mismatch/i,
  );
});

test('curve benchmark evidence records both curves without claiming a winner', () => {
  const evidence = JSON.parse(readFileSync(
    new URL('../protocol/private-balance/results/curve-benchmark.json', import.meta.url),
    'utf8',
  ));
  assert.equal(validateCurveBenchmarkEvidence(evidence), evidence);
  assert.equal(evidence.decision.status, 'pending-physical-device-evidence');
  assert.equal(evidence.decision.selectedCurve, null);
  assert.deepEqual(evidence.runs.map(run => run.curve).sort(), ['bls12-381', 'bn254']);
  for (const run of evidence.runs) {
    assert.equal(run.status, 'measured');
    assert.equal(run.physicalDevice, false);
    assert.equal(run.device.class, 'desktop');
    assert.equal(run.proofSystem, 'groth16');
    assert.ok(run.circuit.constraintCount > 0);
    assert.ok(run.circuit.provingKeyBytes > 0);
    assert.ok(run.proof.jsonBytes > 0);
    assert.ok(run.proving.p50Ms > 0);
    assert.ok(run.proving.p95Ms >= run.proving.p50Ms);
    assert.ok(run.proving.peakRssBytes > 0);
    assert.ok(run.verification.p50Ms > 0);
    assert.equal(run.contract.status, 'pending');
    for (const field of [
      'instructions',
      'readBytes',
      'writeBytes',
      'resourceFeeStroops',
      'transactionBytes',
    ]) assert.equal(field in run.contract, true);
  }
  assert.deepEqual(
    evidence.pendingPhysicalDevices.map(item => item.browser).sort(),
    ['Android Chrome', 'iOS Safari'],
  );
});

test('curve benchmark rejects empty and fabricated phone evidence', () => {
  const evidence = JSON.parse(readFileSync(
    new URL('../protocol/private-balance/results/curve-benchmark.json', import.meta.url),
    'utf8',
  ));
  assert.throws(
    () => validateCurveBenchmarkEvidence({ ...evidence, runs: [] }),
    /exactly one measured run per curve/i,
  );
  assert.throws(
    () => validateCurveBenchmarkEvidence({
      ...evidence,
      runs: evidence.runs.map((run, index) => index === 0
        ? { ...run, physicalDevice: true, device: { ...run.device, class: 'desktop' } }
        : run),
    }),
    /physical phone evidence/i,
  );
  assert.throws(
    () => validateCurveBenchmarkEvidence({
      ...evidence,
      decision: { ...evidence.decision, selectedCurve: 'bn254' },
    }),
    /must not select a curve/i,
  );
});
