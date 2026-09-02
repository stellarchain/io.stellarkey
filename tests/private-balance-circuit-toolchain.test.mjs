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

test('private action circuit performs one range decomposition for equal totals', () => {
  const actionCircuit = readFileSync(join(circuitsDir, 'circom/action.circom'), 'utf8');
  const totalRangeChecks = actionCircuit.match(
    /component total(?:Input|Output)Range = CheckBits\(63\);/gu,
  ) ?? [];

  assert.equal(totalRangeChecks.length, 1);
  assert.match(actionCircuit, /totalInput === totalOutput;/u);
});

test('private action circuit derives output roles from committed values', () => {
  const actionCircuit = readFileSync(join(circuitsDir, 'circom/action.circom'), 'utf8');
  const actionBuilder = readFileSync(
    join(process.cwd(), 'src/features/private-balance/worker/action-builder.ts'),
    'utf8',
  );

  assert.doesNotMatch(actionCircuit, /signal input outputReal/u);
  assert.match(actionCircuit, /outputReal\[j\] <== 1 - outputValueZero\[j\]\.out;/u);
  assert.doesNotMatch(actionBuilder, /outputReal:/u);
});

test('private action circuit uses a depth-17 ternary Merkle path', () => {
  const actionCircuit = readFileSync(join(circuitsDir, 'circom/action.circom'), 'utf8');
  const merkleCircuit = readFileSync(join(circuitsDir, 'circom/merkle.circom'), 'utf8');

  assert.match(actionCircuit, /inputSiblings\[2\]\[17\]\[2\]/u);
  assert.match(actionCircuit, /inputPositions\[2\]\[17\]/u);
  assert.match(actionCircuit, /MerklePath\(17\)/u);
  assert.match(merkleCircuit, /component hasher = Poseidon2Hash\(3\);/u);
  assert.doesNotMatch(merkleCircuit, /DOMAIN_MERKLE_NODE/u);
});

test('pool contract shares the canonical ternary Merkle hash primitive', () => {
  const contract = readFileSync(
    join(process.cwd(), 'protocol/private-balance/contracts/pool/src/contract.rs'),
    'utf8',
  );

  assert.match(contract, /tree::\{EMPTY_ROOTS, hash_merkle_node\}/u);
  assert.doesNotMatch(contract, /p2\("SKSB_MERKLE_NODE_V1"/u);
});

test('private archive reuses the public signals already verified for the action', () => {
  const archive = readFileSync(
    join(process.cwd(), 'protocol/private-balance/contracts/pool/src/archive.rs'),
    'utf8',
  );
  const contract = readFileSync(
    join(process.cwd(), 'protocol/private-balance/contracts/pool/src/contract.rs'),
    'utf8',
  );

  assert.doesNotMatch(archive, /action::\{[^}]*public_signals/u);
  assert.doesNotMatch(archive, /public_signals\(env, config, action\)/u);
  assert.match(archive, /signals: &\[\[u8; 32\]; 13\]/u);
  assert.match(contract, /archive::append_record\([\s\S]*?&signals,/u);
});

test('asset-pinned pools precompute their immutable public asset field', () => {
  const storage = readFileSync(
    join(process.cwd(), 'protocol/private-balance/contracts/pool/src/storage.rs'),
    'utf8',
  );
  const action = readFileSync(
    join(process.cwd(), 'protocol/private-balance/contracts/pool/src/action.rs'),
    'utf8',
  );

  assert.match(storage, /pub asset_field: BytesN<32>/u);
  assert.match(action, /compute_public_signals_with_asset_field/u);
  assert.match(action, /config\.asset_field\.to_array\(\)/u);
});

test('private proving-key checks pin and authenticate the pot14 ceremony input', () => {
  const transcriptScript = readFileSync(join(circuitsDir, 'scripts/powers-of-tau.mjs'), 'utf8');
  const verifier = readFileSync(join(circuitsDir, 'scripts/verify-proving-key.mjs'), 'utf8');

  assert.match(transcriptScript, /powersOfTau28_hez_final_14\.ptau/);
  assert.match(
    transcriptScript,
    /489be9e5ac65d524f7b1685baac8a183c6e77924fdb73d2b8105e335f277895d/,
  );
  assert.match(transcriptScript, /assertPowersOfTau/);
  assert.match(transcriptScript, /rmSync\(path, \{ force: true \}\)/);
  assert.match(verifier, /ensurePowersOfTau/);
  assert.match(verifier, /'zkey', 'verify'/);
  assert.doesNotMatch(transcriptScript, /pot15|final_15/);
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

test('protocol review decisions are backed by reproducible measurements', () => {
  const evidencePath = join(
    process.cwd(),
    'protocol/private-balance/results/review-validation.json',
  );
  const harnessPath = join(
    process.cwd(),
    'protocol/private-balance/spikes/scripts/run-review-validation.mjs',
  );
  assert.equal(existsSync(harnessPath), true, 'review benchmark harness must exist');
  assert.equal(existsSync(evidencePath), true, 'review evidence must exist');

  const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
  assert.equal(evidence.schemaVersion, 3);
  assert.match(evidence.revision, /^[0-9a-f]{40}$/u);
  assert.equal(evidence.circuit.baseline.publicInputs, 13);
  assert.equal(evidence.circuit.baseline.constraints, 23_437);
  assert.equal(evidence.circuit.laneFree.constraints, 22_909);
  assert.equal(evidence.circuit.singleTotalRange.constraints, 22_846);
  assert.equal(evidence.circuit.derivedOutputRoles.constraints, 22_844);
  assert.equal(evidence.circuit.ternaryDepth17.constraints, 14_876);
  assert.equal(evidence.circuit.ternaryDepth17.publicInputs, 13);
  assert.equal(evidence.circuit.ternaryDepth17.privateInputs, 124);
  assert.ok(evidence.circuit.reductionPercent > 36);
  assert.ok(evidence.x25519.trials >= 3);
  assert.ok(evidence.x25519.samplesPerTrial >= 100);
  for (const measurement of [
    evidence.x25519.nativeJwk,
    evidence.x25519.nativePkcs8Prototype,
    evidence.x25519.portable,
    evidence.x25519.diversifiedAddress,
  ]) {
    assert.ok(Number.isFinite(measurement.p50Microseconds));
    assert.ok(Number.isFinite(measurement.p95Microseconds));
    assert.ok(measurement.p50Microseconds > 0);
    assert.ok(measurement.p95Microseconds >= measurement.p50Microseconds);
  }
  assert.equal(evidence.scanPath.trials >= 3, true);
  assert.equal(evidence.scanPath.samplesPerTrial >= 100, true);
  assert.deepEqual(Object.keys(evidence.scanPath.variants).sort(), [
    'current',
    'ideal',
    'reordered',
    'webcrypto',
  ]);
  for (const measurement of Object.values(evidence.scanPath.variants)) {
    assert.ok(Number.isFinite(measurement.p50Microseconds));
    assert.ok(Number.isFinite(measurement.p95Microseconds));
    assert.ok(measurement.p50Microseconds > 0);
    assert.ok(measurement.p95Microseconds >= measurement.p50Microseconds);
  }
  assert.ok(
    evidence.scanPath.ratios.currentOverWebcrypto > 1,
    'the WebCrypto prototype must beat the current full miss path',
  );
  assert.ok(
    evidence.scanPath.ratios.currentOverIdeal > 1,
    'the ideal cached-key floor must beat the current full miss path',
  );
  assert.deepEqual(Object.keys(evidence.scanBatch.variants).sort(), [
    '1', '16', '32', '4', '64', '8',
  ]);
  assert.ok([1, 4, 8, 16, 32, 64].includes(evidence.scanBatch.selectedBatchSize));
  assert.ok(Number.isFinite(evidence.scanBatch.selectedP50MicrosecondsPerEnvelope));
  assert.ok(Number.isFinite(evidence.scanBatch.sequentialP50MicrosecondsPerEnvelope));
  assert.ok(evidence.scanBatch.throughputRatio > 0);
  assert.equal(evidence.contractCosts.verifier.baselineInstructions, 39_614_514);
  assert.equal(evidence.contractCosts.verifier.batchedMsmInstructions, 29_960_188);
  assert.ok(evidence.contractCosts.verifier.reductionPercent > 24);
  assert.equal(evidence.contractCosts.poolWasm.reviewMisidentifiedBytes, 154_609);
  assert.equal(evidence.contractCosts.poolWasm.measuredBaselineOptimizedBytes, 121_675);
  assert.equal(evidence.contractCosts.poolWasm.withoutRuntimeBigIntOptimizedBytes, 87_145);
  assert.ok(evidence.contractCosts.poolWasm.reductionPercent > 28);
  assert.deepEqual(Object.keys(evidence.decisions).sort(), [
    '1', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '2',
    '20', '3', '4', '5', '6', '7', '8', '9',
  ]);
  for (const decision of Object.values(evidence.decisions)) {
    assert.match(decision.status, /^(accept|defer|reject)$/u);
    assert.ok(decision.reason.length >= 20);
  }
});
