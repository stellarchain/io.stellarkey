#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const circuitsDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const actionSource = join(circuitsDir, 'circom/action.circom');
const actionTest = join(circuitsDir, 'test/action.circuit.test.mjs');
const env = { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:${process.env.PATH}` };

const mutations = [
  {
    name: 'deposit zero-root binding',
    testName: 'deposit bound to a nonzero anchor root',
    needle: '    isDeposit * anchorRoot === 0;',
    replacement: '    isDeposit * anchorRoot * 0 === 0;',
  },
  {
    name: 'shared input ownership',
    testName: 'inputs controlled by different spending keys',
    needle: '        inputEnabled[i] * (inputOwnerCommitment[i] - inputDiversifiedOwner[i].out) === 0;',
    replacement: '        inputEnabled[i] * (inputOwnerCommitment[i] - inputDiversifiedOwner[i].out) * 0 === 0;',
  },
  {
    name: 'duplicate output prevention',
    testName: 'duplicate real output commitments',
    needle: '    bothOutputsEnabled * duplicateOutput.out === 0;',
    replacement: '    bothOutputsEnabled * duplicateOutput.out * 0 === 0;',
  },
];

function replaceExactlyOnce(source, mutation) {
  const first = source.indexOf(mutation.needle);
  if (first < 0 || source.indexOf(mutation.needle, first + 1) >= 0) {
    throw new Error(`Mutation target for ${mutation.name} must occur exactly once.`);
  }
  return `${source.slice(0, first)}${mutation.replacement}${source.slice(first + mutation.needle.length)}`;
}

for (const mutation of mutations) {
  const directory = mkdtempSync(join(tmpdir(), 'stellarkey-circuit-mutant-'));
  try {
    const mutantCircom = join(directory, 'circom');
    const mutantBuild = join(directory, 'build');
    cpSync(join(circuitsDir, 'circom'), mutantCircom, { recursive: true });
    mkdirSync(mutantBuild);
    const mutantAction = join(mutantCircom, 'action.circom');
    writeFileSync(
      mutantAction,
      replaceExactlyOnce(readFileSync(actionSource, 'utf8'), mutation),
    );
    execFileSync('circom', [mutantAction, '--wasm', '--O2', '-o', mutantBuild], {
      env,
      stdio: 'pipe',
    });

    const result = spawnSync(process.execPath, [
      '--no-warnings',
      '--test',
      '--test-name-pattern',
      mutation.testName,
      actionTest,
    ], {
      cwd: circuitsDir,
      encoding: 'utf8',
      env: {
        ...env,
        PRIVATE_BALANCE_ACTION_WASM_PATH: join(mutantBuild, 'action_js/action.wasm'),
      },
      timeout: 30_000,
    });
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    if (result.status === 0 || !/Missing expected rejection/.test(output)) {
      throw new Error(`Mutation survived or failed incorrectly: ${mutation.name}\n${output}`);
    }
    console.log(`✓ Killed mutation: ${mutation.name}`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

console.log(`✓ ${mutations.length} security-constraint mutations were killed by adversarial witnesses.`);
