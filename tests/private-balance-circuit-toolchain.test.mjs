import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
    /cc9b7fdc5f632d1d5f9fccc58b9d01a8bf6a4ff26400ea8224fc20ee7e13e357/,
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
