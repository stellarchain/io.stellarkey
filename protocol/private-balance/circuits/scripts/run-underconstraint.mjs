#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const circuitsDir = join(import.meta.dirname, '..');
const actionCircuit = join(circuitsDir, 'circom/action.circom');
const negativeControl = join(circuitsDir, 'test/fixtures/underconstrained.circom');
const includeDirectory = join(circuitsDir, 'node_modules');
const CIVER_COMMIT = 'af7d4ed0325e6f7743d8a1ac0e415d0c69b8aae8';
const CIVER_VERSION = '2.1.6';
const VERIFICATION_TIMEOUT_MS = '60000';

function combinedOutput(result) {
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

function execute(binary, args, label) {
  const result = spawnSync(binary, args, { encoding: 'utf8' });
  const output = combinedOutput(result);
  if (result.error) {
    throw new Error(`${label} could not start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${label} exited ${result.status}:\n${output}`);
  }
  return output;
}

function counter(output, name) {
  const match = output.match(
    new RegExp(`Number of ${name} components \\(weak-safety\\):\\s*(\\d+)`, 'u'),
  );
  if (!match) throw new Error(`CIVER omitted the ${name} weak-safety counter:\n${output}`);
  return Number.parseInt(match[1], 10);
}

function verifiedConstraints(output) {
  const match = output.match(
    /Percentage of verified constraints:\s*100(?:\.0+)?\s*-\s*\((\d+)\s*\/\s*(\d+)\)/u,
  );
  if (!match || match[1] !== match[2] || match[1] === '0') {
    throw new Error(`CIVER did not verify the complete production constraint set:\n${output}`);
  }
  return Number.parseInt(match[1], 10);
}

const civer = process.env.CIVER_CIRCOM;
if (!civer) {
  throw new Error(
    'Gate A requires CIVER_CIRCOM to point to the pinned civer_circom executable. ' +
    `Required source commit: ${CIVER_COMMIT}`,
  );
}
if (process.env.CIVER_SOURCE_COMMIT !== CIVER_COMMIT) {
  throw new Error(
    `Gate A requires CIVER source commit ${CIVER_COMMIT}; ` +
    `received ${process.env.CIVER_SOURCE_COMMIT ?? 'no commit evidence'}.`,
  );
}

const version = execute(civer, ['--version'], 'CIVER version check');
if (!version.includes(`circom compiler ${CIVER_VERSION}`)) {
  throw new Error(
    `Gate A requires CIVER's Circom ${CIVER_VERSION} fork from ${CIVER_COMMIT}; received:\n${version}`,
  );
}

const commonArguments = [
  '--check_safety',
  '--apply_deduction_assigned',
  '--verification_timeout',
  VERIFICATION_TIMEOUT_MS,
  '--O2',
];
const outputDirectory = mkdtempSync(join(tmpdir(), 'stellarkey-civer-gate-'));
const negativeOutputDirectory = join(outputDirectory, 'negative');
const productionOutputDirectory = join(outputDirectory, 'production');
mkdirSync(negativeOutputDirectory);
mkdirSync(productionOutputDirectory);

try {
  const negative = execute(
    civer,
    [negativeControl, ...commonArguments, '-o', negativeOutputDirectory],
    'CIVER negative control',
  );
  const negativeFailed = counter(negative, 'failed');
  const negativeTimedOut = counter(negative, 'timeout');
  if (
    negativeFailed < 1 ||
    negativeTimedOut !== 0 ||
    !negative.includes('UnderconstrainedFixture()')
  ) {
    throw new Error(`Gate A negative control was not detected decisively:\n${negative}`);
  }

  const production = execute(
    civer,
    [
      actionCircuit,
      ...commonArguments,
      '-l',
      includeDirectory,
      '-o',
      productionOutputDirectory,
    ],
    'CIVER production analysis',
  );
  const productionFailed = counter(production, 'failed');
  const productionTimedOut = counter(production, 'timeout');
  if (productionTimedOut !== 0) {
    throw new Error(`CIVER production analysis timed out:\n${production}`);
  }
  if (productionFailed !== 0 || !production.includes('All components satisfy weak safety')) {
    throw new Error(`CIVER rejected the production circuit:\n${production}`);
  }
  const verified = counter(production, 'verified');
  const constraints = verifiedConstraints(production);
  console.log(
    `✓ Gate A CIVER weak-safety analysis passed at ${CIVER_COMMIT}: ` +
    `${verified} verified components, ${constraints} verified constraints, ` +
    'zero failures, zero timeouts; negative control detected.',
  );
} finally {
  rmSync(outputDirectory, { recursive: true, force: true });
}
