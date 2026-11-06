import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

// Exercise the release entrypoint with disposable synthetic artifacts. Only the
// compilers are stubbed; hashing, manifest checks and cleanup use the real fs.
const script = readFileSync('protocol/private-balance/scripts/build-private-balance-artifacts.mjs', 'utf8')
  .replace(/^#!.*\n/u, '').replace(/^import .*;\n/gmu, '');
const tracked = {
  'protocol/private-balance/circuits/build/action.r1cs': 'r1cs',
  'protocol/private-balance/circuits/build/action_js/action.wasm': 'witness',
  'public/protocol/private-balance/v1/circuit.wasm': 'witness',
  'public/protocol/private-balance/v1/pool.wasm': 'pool',
};
const digest = value => createHash('sha256').update(value).digest('hex');

function check({ staleFile, staleField, mismatchBuild = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'stellarkey-repro-test-'));
  const write = (path, value) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, value); };
  let circuitBuilds = 0;
  try {
    for (const [path, value] of Object.entries(tracked)) write(join(root, path), staleFile === path ? 'stale' : value);
    const manifest = {
      artifacts: { r1csSha256: digest('r1cs'), wasmSha256: digest('witness') },
      release: { contractWasmSha256: digest('pool') },
    };
    if (staleField) {
      const [section, field] = staleField.split('.');
      manifest[section][field] = digest('stale');
    }
    write(join(root, 'public/protocol/private-balance/v1/manifest.json'), JSON.stringify(manifest));
    runInNewContext(script, {
      createHash, mkdirSync, mkdtempSync, readFileSync, rmSync, join,
      tmpdir: () => root,
      console: { log() {} },
      process: { cwd: () => root, platform: 'darwin', arch: 'arm64', env: {}, argv: ['--check-reproducible'] },
      execFileSync(file, args) {
        if (file === 'rustc') return 'rustc 1.97.1\nhost: aarch64-apple-darwin\n';
        if (args[0] === '--version') return file === 'circom' ? 'circom compiler 2.2.3' : 'stellar 27.0.0';
        if (file === 'circom') {
          const output = args[args.indexOf('-o') + 1];
          circuitBuilds += 1;
          write(join(output, 'action.r1cs'), mismatchBuild && circuitBuilds === 2 ? 'different' : 'r1cs');
          write(join(output, 'action_js/action.wasm'), 'witness');
        } else if (file === 'stellar') {
          write(join(args[args.indexOf('--out-dir') + 1], 'private_balance_pool.wasm'), 'pool');
        } else throw new Error('Unexpected compiler command');
      },
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('reproducibility accepts identical rebuilds matching shipped artifacts and manifest', () => {
  assert.doesNotThrow(() => check());
});
for (const staleFile of Object.keys(tracked)) {
  test(`reproducibility rejects a stale ${staleFile}`, () => {
    assert.throws(() => check({ staleFile }), /stale|mismatch/i);
  });
}
for (const staleField of ['artifacts.r1csSha256', 'artifacts.wasmSha256', 'release.contractWasmSha256']) {
  test(`reproducibility rejects a stale manifest ${staleField}`, () => {
    assert.throws(() => check({ staleField }), /manifest|mismatch/i);
  });
}
test('reproducibility still rejects unequal rebuilds', () => {
  assert.throws(() => check({ mismatchBuild: true }), /not reproducible/i);
});
