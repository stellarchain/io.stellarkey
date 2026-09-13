import { parseArgs } from 'node:util';

const DEFAULT_ACTIONS = 10_000;
const MAX_ACTIONS = 100_000;
const DEFAULT_OUTPUT = 'protocol/private-balance/spikes/results/recovery-10k.json';

function canonicalPositiveInteger(value, name, maximum) {
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`${name} must be a canonical positive integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw new Error(`${name} must be at most ${maximum}.`);
  }
  return parsed;
}

export function parseRecoveryGateArguments(argv) {
  const { values } = parseArgs({
    args: argv,
    allowPositionals: false,
    strict: true,
    options: {
      actions: { type: 'string', default: String(DEFAULT_ACTIONS) },
      'no-events': { type: 'boolean', default: false },
      'no-mirror': { type: 'boolean', default: false },
      output: { type: 'string', default: DEFAULT_OUTPUT },
    },
  });
  if (!values['no-events']) {
    throw new Error('Recovery gate requires --no-events.');
  }
  if (!values['no-mirror']) {
    throw new Error('Recovery gate requires --no-mirror.');
  }
  if (!values.output?.trim()) {
    throw new Error('Recovery gate output path is required.');
  }
  return {
    actionCount: canonicalPositiveInteger(values.actions, 'Actions', MAX_ACTIONS),
    eventsEnabled: false,
    mirrorEnabled: false,
    outputPath: values.output,
  };
}

function lowercaseHash(value, name) {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${name} must be a 32-byte lowercase hex value.`);
  }
  return value;
}

export function buildRecoveryGateEvidence(input) {
  for (const [name, value] of [
    ['Action count', input.actionCount],
    ['Record batch size', input.recordBatchSize],
    ['Owned action count', input.ownedActionCount],
    ['Recovered activity count', input.recoveredActivityCount],
    ['Elapsed milliseconds', input.elapsedMs],
    ['Peak RSS bytes', input.peakRssBytes],
  ]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${name} is invalid.`);
    }
  }
  if (input.actionCount === 0 || input.recordBatchSize === 0) {
    throw new Error('Recovery dataset dimensions are invalid.');
  }
  if (
    input.recoveredBalance !== input.expectedBalance ||
    input.recoveredActivityCount !== input.ownedActionCount
  ) {
    throw new Error('Recovery result mismatch.');
  }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(input.completedAt)) {
    throw new Error('Recovery completion timestamp is invalid.');
  }

  return {
    schemaVersion: 2,
    scope: 'backend-free-seed-recovery-mvp',
    passed: true,
    completedAt: input.completedAt,
    sources: { events: false, mirror: false, indexer: false },
    dataset: {
      deterministicActions: input.actionCount,
      canonicalRecords: input.actionCount,
      recordBatches: Math.ceil(input.actionCount / input.recordBatchSize),
      recordBatchSize: input.recordBatchSize,
      ownedActions: input.ownedActionCount,
    },
    checks: {
      everyRecordHashLinked: true,
      finalTranscriptHeadMatched: true,
      finalTreeRootMatched: true,
      exactOwnedBalanceRecovered: true,
      exactOwnedActivityRecovered: true,
    },
    recovery: {
      expectedBalance: input.expectedBalance.toString(),
      recoveredBalance: input.recoveredBalance.toString(),
      recoveredActivityCount: input.recoveredActivityCount,
      finalRecordHash: lowercaseHash(input.finalRecordHash, 'Final record hash'),
      finalTreeRoot: lowercaseHash(input.finalTreeRoot, 'Final tree root'),
      elapsedMs: input.elapsedMs,
      peakRssBytes: input.peakRssBytes,
    },
    limitations: [
      'This local scanner gate is paired with the controlled-Core archive gate; it does not claim that 10,000 actions were submitted on chain.',
      'This is minimal MVP evidence, not Gate D beta approval or Gate E mainnet approval.',
    ],
  };
}
