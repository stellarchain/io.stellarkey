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

test('every pool build selects the pinned Rust toolchain and retains isolated outputs', () => {
  const script = readFileSync(
    join(process.cwd(), 'protocol/private-balance/scripts/build-private-balance-artifacts.mjs'),
    'utf8',
  );
  const toolchain = readFileSync(
    join(process.cwd(), 'protocol/private-balance/rust-toolchain.toml'),
    'utf8',
  ).match(/^channel = "([^"]+)"$/m)?.[1];
  assert.equal(toolchain, '1.97.1');
  const implementation = script.match(/^function buildPool\([^]*?^\}/m)?.[0];
  assert.ok(implementation, 'the actual pool build boundary must be exercised');
  const calls = [];
  const environment = { PATH: '/synthetic/bin', RUSTUP_TOOLCHAIN: 'synthetic-default' };
  const buildPool = new Function('run', 'process', `${implementation}; return buildPool;`)(
    (...args) => calls.push(args), { env: environment },
  );

  buildPool();
  buildPool('/synthetic/pool', {
    env: { CARGO_TARGET_DIR: '/synthetic/cargo-target', RUSTUP_TOOLCHAIN: 'synthetic-override' },
  });

  for (const [file, args, options] of calls) {
    assert.equal(file, 'stellar');
    assert.deepEqual(args.slice(0, 2), ['contract', 'build']);
    assert.ok(args.includes('--locked'));
    assert.equal(options.env?.RUSTUP_TOOLCHAIN, toolchain,
      'Stellar must launch Cargo with the toolchain that owns the installed Wasm target');
    assert.equal(options.env.PATH, environment.PATH);
  }
  assert.equal(calls[0][2].env.CARGO_TARGET_DIR, undefined);
  assert.equal(calls[1][2].env.CARGO_TARGET_DIR, '/synthetic/cargo-target');
  assert.deepEqual(calls[1][1].slice(-2), ['--out-dir', '/synthetic/pool']);
  assert.equal(environment.RUSTUP_TOOLCHAIN, 'synthetic-default', 'do not mutate the caller environment');
});

test('exact reproduction rejects noncanonical operating systems, architectures and Rust hosts before builds', () => {
  const script = readFileSync(
    join(process.cwd(), 'protocol/private-balance/scripts/build-private-balance-artifacts.mjs'), 'utf8',
  );
  const implementation = script.match(/^function assertCanonicalReproductionHost\([^]*?^\}/m)?.[0];
  assert.ok(implementation, 'provide the canonical-host guard');
  assert.match(script, /if \(checkReproducible\) assertCanonicalReproductionHost\(\);/);
  assert.ok(script.indexOf('if (checkReproducible) assertCanonicalReproductionHost();') < script.indexOf("execFileSync('circom'"));
  for (const [platform, arch, host, accepted] of [
    ['darwin', 'arm64', 'aarch64-apple-darwin', true],
    ['darwin', 'arm64', 'x86_64-apple-darwin', false],
    ['darwin', 'x64', 'aarch64-apple-darwin', false],
    ['linux', 'arm64', 'aarch64-unknown-linux-gnu', false],
    ['linux', 'x64', 'x86_64-unknown-linux-gnu', false],
    ['darwin', 'arm64', '', false],
  ]) {
    const calls = [];
    const check = new Function('execFileSync', 'process', `${implementation}; return assertCanonicalReproductionHost;`)(
      (...args) => { calls.push(args); return `rustc 1.97.1\nhost: ${host}\n`; },
      { platform, arch },
    );
    if (accepted) assert.doesNotThrow(check);
    else assert.throws(check, /canonical.*macOS ARM64/i);
    for (const [file, args] of calls) {
      assert.equal(file, 'rustc');
      assert.deepEqual(args, ['+1.97.1', '--version', '--verbose']);
    }
  }
  assert.match(script, /for \(const output of \[first, second\]\)/);
  assert.match(script, /CARGO_TARGET_DIR: join\(output, 'cargo-target'\)/);
  assert.match(script, /if \(trackedPoolHash !== rebuiltPoolHash\)/);
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

test('private action circuit safely binds eleven public signals', () => {
  const action = readFileSync(join(circuitsDir, 'circom/action.circom'), 'utf8');
  assert.match(action, /exactly these eleven public signals/u);
  assert.match(action, /actionFieldZero\.in <== actionField;/u);
  assert.match(action, /actionFieldZero\.out === 0;/u);
  assert.doesNotMatch(action, /signal input (?:relayerField|actionBinding);/u);
  assert.doesNotMatch(action, /inputDummy\[i\] \* inputPositions/u);
  assert.doesNotMatch(action, /include "action_binding\.circom"/u);
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
  assert.match(archive, /signals: &\[\[u8; 32\]; 11\]/u);
  assert.match(contract, /archive::append_record\([\s\S]*?&signals,/u);
});

test('retired private archive paging constants stay out of consensus bindings', () => {
  const paths = [
    'protocol/private-balance/crates/protocol/src/constants.rs',
    'protocol/private-balance/crates/protocol/src/deployment.rs',
    'protocol/private-balance/contracts/pool/src/contract.rs',
    'protocol/private-balance/contracts/pool/src/storage.rs',
    'protocol/private-balance/scripts/generate-manifest.mjs',
    'protocol/private-balance/manifests/development.json',
    'public/protocol/private-balance/v1/manifest.json',
  ];
  for (const path of paths) {
    const source = readFileSync(join(process.cwd(), path), 'utf8');
    assert.doesNotMatch(
      source,
      /PAGE_CAPACITY|MAX_PAGES_PER_TOUCH|pageCapacity|maxPagesPerTouch/u,
      path,
    );
  }
});

test('the governed registry precomputes immutable asset fields', () => {
  const storage = readFileSync(
    join(process.cwd(), 'protocol/private-balance/contracts/pool/src/storage.rs'),
    'utf8',
  );
  const action = readFileSync(
    join(process.cwd(), 'protocol/private-balance/contracts/pool/src/action.rs'),
    'utf8',
  );
  const contract = readFileSync(
    join(process.cwd(), 'protocol/private-balance/contracts/pool/src/contract.rs'),
    'utf8',
  );

  assert.match(storage, /pub asset_field: BytesN<32>/u);
  assert.match(storage, /get_registered_asset/u);
  assert.match(action, /asset_index: None,\s*\n\s*asset: None,/u);
  assert.match(contract, /compute_asset_field\(\(1, asset_payload\)\)/u);
});

test('private proving-key checks pin and authenticate the pot14 ceremony input', () => {
  const transcriptScript = readFileSync(join(circuitsDir, 'scripts/powers-of-tau.mjs'), 'utf8');
  const verifier = readFileSync(join(circuitsDir, 'scripts/verify-proving-key.mjs'), 'utf8');

  assert.match(transcriptScript, /ppot_0080_14\.ptau/);
  assert.match(
    transcriptScript,
    /3ca1149e9349b22b0ee0649399cfb787677129b7b1189d1899fc0d615d9583db/,
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

  const harness = readFileSync(harnessPath, 'utf8');
  assert.match(harness, /Verifier CPU instructions:/u);
  assert.match(harness, /'contract',\s*'build'/u);
  assert.match(harness, /'contract',\s*'optimize'/u);
  assert.match(harness, /baselinePoolSourceRevision = '69335bd/u);
  assert.match(harness, /'worktree',\s*'add',\s*'--detach'/u);
  assert.match(harness, /expectedStellarCliVersion = '27\.0\.0'/u);
  assert.match(harness, /RUSTUP_TOOLCHAIN:\s*'1\.97\.1'/u);
  assert.doesNotMatch(harness, /currentInstructions:\s*29_287_953/u);
  assert.doesNotMatch(harness, /currentRawBytes:\s*66_377/u);
  assert.doesNotMatch(harness, /currentOptimizedBytes:\s*57_042/u);

  const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
  assert.equal(evidence.schemaVersion, 3);
  assert.match(evidence.revision, /^[0-9a-f]{40}$/u);
  assert.equal(evidence.environment.stellarCli, '27.0.0');
  assert.match(evidence.environment.cargo, /^cargo 1\.97\.1\b/u);
  assert.equal(evidence.circuit.baseline.publicInputs, 13);
  assert.equal(evidence.circuit.baseline.constraints, 23_437);
  assert.equal(evidence.circuit.laneFree.constraints, 22_909);
  assert.equal(evidence.circuit.singleTotalRange.constraints, 22_846);
  assert.equal(evidence.circuit.derivedOutputRoles.constraints, 22_844);
  assert.equal(evidence.circuit.prePublicInputReduction.constraints, 14_876);
  assert.equal(evidence.circuit.prePublicInputReduction.publicInputs, 13);
  assert.equal(evidence.circuit.ternaryDepth17.constraints, 14_574);
  assert.equal(evidence.circuit.ternaryDepth17.publicInputs, 11);
  assert.equal(evidence.circuit.ternaryDepth17.privateInputs, 124);
  assert.ok(evidence.circuit.reductionPercent > 36);
  assert.equal(evidence.associationSet.additionalPathConstraints, 4_573);
  assert.equal(evidence.associationSet.publicInputs, 1);
  assert.equal(evidence.associationSet.privateInputs, 53);
  assert.equal(evidence.associationSet.projectedActionConstraints, 19_147);
  assert.ok(evidence.associationSet.projectedIncreasePercent > 31);
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
  assert.equal(evidence.scanBatch.trials, 9);
  assert.equal(
    evidence.scanBatch.selectionPolicy,
    'fixed conservative 8-output cap from repeated exploratory runs; paired median must exceed 1.20x sequential',
  );
  assert.equal(evidence.scanBatch.selectedBatchSize, 8);
  assert.equal(
    evidence.scanBatch.variants['8'].pairedMedianThroughputRatio,
    evidence.scanBatch.throughputRatio,
  );
  assert.ok(Number.isFinite(evidence.scanBatch.selectedP50MicrosecondsPerEnvelope));
  assert.ok(Number.isFinite(evidence.scanBatch.sequentialP50MicrosecondsPerEnvelope));
  assert.ok(evidence.scanBatch.throughputRatio >= evidence.scanBatch.acceptanceThreshold);
  assert.equal(evidence.contractCosts.verifier.baselineInstructions, 39_614_514);
  assert.equal(evidence.contractCosts.verifier.currentInstructions, 29_287_953);
  assert.ok(evidence.contractCosts.verifier.reductionPercent > 26);
  assert.equal(evidence.contractCosts.poolWasm.reviewMisidentifiedBytes, 154_609);
  assert.equal(
    evidence.contractCosts.poolWasm.baselineRevision,
    '69335bd893e6c2739043ddae9434161b2c22a6ce',
  );
  assert.equal(evidence.contractCosts.poolWasm.baselineRawBytes, 93_504);
  assert.equal(evidence.contractCosts.poolWasm.baselineOptimizedBytes, 80_245);
  assert.equal(evidence.contractCosts.poolWasm.currentRawBytes, 66_377);
  assert.equal(evidence.contractCosts.poolWasm.currentOptimizedBytes, 57_042);
  assert.ok(evidence.contractCosts.poolWasm.rawReductionPercent > 29);
  assert.ok(evidence.contractCosts.poolWasm.optimizedReductionPercent > 28);
  assert.deepEqual(Object.keys(evidence.decisions).sort(), [
    '1', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '2',
    '20', '3', '4', '5', '6', '7', '8', '9',
  ]);
  for (const decision of Object.values(evidence.decisions)) {
    assert.match(decision.status, /^(accept|defer|reject)$/u);
    assert.ok(decision.reason.length >= 20);
  }
});
