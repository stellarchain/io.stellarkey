import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRecoveryGateEvidence,
  parseRecoveryGateArguments,
} from '../protocol/private-balance/spikes/scripts/recovery-gate-lib.mjs';

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
