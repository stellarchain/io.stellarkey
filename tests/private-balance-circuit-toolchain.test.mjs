import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const circuitsDir = join(process.cwd(), 'protocol/private-balance/circuits');

test('private circuit compilation pins O2 for every Circom target', () => {
  const compileScript = readFileSync(join(circuitsDir, 'scripts/compile.mjs'), 'utf8');
  const invocations = [...compileScript.matchAll(/execFileSync\(\s*'circom',\s*\[([\s\S]*?)\]/g)];

  assert.ok(invocations.length >= 2, 'expected the action and helper Circom invocations');
  for (const invocation of invocations) {
    assert.match(invocation[1], /['"]--O2['"]/, 'every Circom invocation must pin --O2');
  }
});

test('private reproducibility rebuild pins the same O2 compiler mode', () => {
  const rebuildScript = readFileSync(
    join(process.cwd(), 'protocol/private-balance/scripts/build-private-balance-artifacts.mjs'),
    'utf8',
  );
  const invocation = rebuildScript.match(/run\('circom',\s*\[([\s\S]*?)\]\);/);

  assert.ok(invocation, 'expected the isolated reproducibility Circom invocation');
  assert.match(invocation[1], /['"]--O2['"]/, 'reproducibility must rebuild the shipped O2 circuit');
});

test('private proving-key checks pin and authenticate the pot15 ceremony input', () => {
  const transcriptScript = readFileSync(join(circuitsDir, 'scripts/powers-of-tau.mjs'), 'utf8');
  const verifier = readFileSync(join(circuitsDir, 'scripts/verify-proving-key.mjs'), 'utf8');

  assert.match(transcriptScript, /powersOfTau28_hez_final_15\.ptau/);
  assert.match(
    transcriptScript,
    /3ef2ecc5b75d687048cf2d59195119b42fb07c5af639c5f283d84bfa69829e7f/,
  );
  assert.match(transcriptScript, /assertPowersOfTau/);
  assert.match(transcriptScript, /rmSync\(path, \{ force: true \}\)/);
  assert.match(verifier, /ensurePowersOfTau/);
  assert.match(verifier, /'zkey', 'verify'/);
  assert.doesNotMatch(transcriptScript, /pot17|final_17/);
});

test('private artifact generation refreshes and checks proving-key-bound proof vectors', () => {
  const generator = readFileSync(
    join(process.cwd(), 'protocol/private-balance/scripts/build-private-balance-artifacts.mjs'),
    'utf8',
  );
  const generatedCheck = readFileSync(
    join(process.cwd(), 'protocol/private-balance/scripts/check-generated.mjs'),
    'utf8',
  );
  const proofVerifier = readFileSync(
    join(process.cwd(), 'protocol/private-balance/scripts/verify-proof-vectors.mjs'),
    'utf8',
  );

  assert.match(generator, /generate-proof-vectors\.mjs/);
  assert.match(generatedCheck, /verify-proof-vectors\.mjs/);
  assert.doesNotMatch(generatedCheck, /generate-proof-vectors\.mjs/);
  assert.match(generatedCheck, /vectors\/proofs-v1\.json/);
  assert.match(proofVerifier, /process\.exit\(0\)/, 'snarkjs workers must not hold release checks open');
});

test('curve benchmark compilation is explicit and cannot overwrite production artifacts', () => {
  const compileScript = readFileSync(join(circuitsDir, 'scripts/compile.mjs'), 'utf8');

  assert.match(compileScript, /--benchmark-curve/);
  assert.match(compileScript, /bn128/);
  assert.match(compileScript, /bls12381/);
  assert.match(compileScript, /--prime/);
  assert.match(compileScript, /--output/);
  assert.match(compileScript, /production build directory/i);
});

test('curve benchmark ships a browser harness, schema, and provisional evidence', () => {
  const spikeRoot = join(process.cwd(), 'protocol/private-balance/spikes');
  const paths = [
    join(spikeRoot, 'scripts/run-curve-benchmark.mjs'),
    join(spikeRoot, 'browser/prover-bench.ts'),
    join(spikeRoot, 'results/curve-benchmark.schema.json'),
    join(process.cwd(), 'protocol/private-balance/results/curve-benchmark.json'),
  ];
  for (const path of paths) assert.equal(existsSync(path), true, `${path} must exist`);

  const browserHarness = readFileSync(paths[1], 'utf8');
  assert.match(browserHarness, /p50Ms/);
  assert.match(browserHarness, /p95Ms/);
  assert.match(browserHarness, /peakRssBytes|peakMemoryBytes/);
  assert.match(browserHarness, /wasmSimd/);
  assert.match(browserHarness, /wasmThreads/);
  assert.match(browserHarness, /physicalDevice/);
  assert.match(browserHarness, /provingKeyStreaming/);
  assert.match(browserHarness, /nativeMobileProver/);
});
