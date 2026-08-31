#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const circuitsDir = join(import.meta.dirname, '..');
const actionCircuit = join(circuitsDir, 'circom/action.circom');
const negativeControl = join(circuitsDir, 'test/fixtures/underconstrained.circom');
const CIRCOMSPECT_VERSION = '0.9.0';

function output(result) {
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

const installed = execFileSync('cargo', ['install', '--list'], { encoding: 'utf8' });
if (!installed.includes(`circomspect v${CIRCOMSPECT_VERSION}:`)) {
  throw new Error(
    `Gate A requires circomspect ${CIRCOMSPECT_VERSION}. ` +
    `Install it with: cargo install circomspect --version ${CIRCOMSPECT_VERSION} --locked`,
  );
}

const inspectOutput = mkdtempSync(join(tmpdir(), 'stellarkey-circom-inspect-'));
try {
  execFileSync('circom', [actionCircuit, '--inspect', '--O2', '-o', inspectOutput], {
    stdio: 'inherit',
  });
} finally {
  rmSync(inspectOutput, { recursive: true, force: true });
}

// CS0005 is limited to the reviewed IsZero inverse and CheckBits bit
// assignments. Both are followed by explicit algebraic/boolean constraints;
// Circom's native --inspect also validates the compiled template graph above.
const production = spawnSync(
  'circomspect',
  ['--verbose', '--allow', 'CS0005', actionCircuit],
  { encoding: 'utf8' },
);
if (production.status !== 0 || !/No issues found\./u.test(output(production))) {
  throw new Error(`Gate A rejected action.circom:\n${output(production)}`);
}

// Fail closed if the analyzer or allowlist stops catching the vulnerability
// class. The negative control has a public output with no verifying constraint.
const negative = spawnSync(
  'circomspect',
  ['--verbose', '--allow', 'CS0005', negativeControl],
  { encoding: 'utf8' },
);
if (
  negative.status === 0 ||
  !/warning\[CS0017\]: Intermediate signals should typically occur in at least two separate constraints/u.test(
    output(negative),
  )
) {
  throw new Error(`Gate A negative control was not detected:\n${output(negative)}`);
}

console.log(
  `✓ Gate A static circuit analysis passed with Circomspect ${CIRCOMSPECT_VERSION} ` +
  'and a detected negative control.',
);
