#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { cpus, arch, platform, release } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as snarkjs from 'snarkjs';
import {
  POSEIDON2_DIAGONAL,
  POSEIDON2_ROUND_CONSTANTS,
} from '../../packages/browser/dist/generated/poseidon2-parameters.js';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PRIVATE_BALANCE_ROOT = resolve(dirname(SCRIPT_PATH), '../..');
const PROJECT_ROOT = resolve(PRIVATE_BALANCE_ROOT, '../..');
const CIRCUITS_DIR = join(PRIVATE_BALANCE_ROOT, 'circuits');
const COMPILE_SCRIPT = join(CIRCUITS_DIR, 'scripts/compile.mjs');
const SNARKJS_CLI = join(PROJECT_ROOT, 'node_modules/snarkjs/build/cli.cjs');
const DEFAULT_OUTPUT = join(PRIVATE_BALANCE_ROOT, 'results/curve-benchmark.json');
const RESULTS_ROOT = join(PRIVATE_BALANCE_ROOT, 'results');
const PTAU_POWER = 15;

const CURVES = Object.freeze([
  Object.freeze({
    evidenceName: 'bn254',
    circomName: 'bn128',
    snarkjsName: 'bn128',
    scalarModulus: 21888242871839275222246405745257275088548364400416034343698204186575808495617n,
    canonicalUncompressedProofBytes: 256,
  }),
  Object.freeze({
    evidenceName: 'bls12-381',
    circomName: 'bls12381',
    snarkjsName: 'bls12381',
    scalarModulus: 52435875175126190479447740508185965837690552500527637822603658699938581184513n,
    canonicalUncompressedProofBytes: 384,
  }),
]);

const DOMAIN = Object.freeze({
  owner: 6572291656506234975797969757609184236602078616932335549748672120887455719780n,
  diversifiedOwner: 14648730730437137655665581460901063522972457499366870315302424102560973417853n,
  note: 12305356573583967990145829509939363390395175012772578063495555266515310494866n,
  dummyNullifier: 11079287110993094273924039464477300343037036643499336743423997609200409937317n,
  actionBinding: 17365170631394812078082042073070794658064087641845391218072061672105615249472n,
});

const CORPUS_DESCRIPTOR = Object.freeze({
  name: 'deterministic-deposit-v1',
  contextField: '42',
  assetField: '84',
  actionField: '7654321',
  publicValueField: '5000000',
  inputDummySecrets: ['901', '902'],
  outputOwners: [
    { ask: '111', nk: '222', diversifier: '7' },
    { ask: '333', nk: '444', diversifier: '11' },
  ],
  outputValues: ['5000000', '0'],
  outputRhos: ['77777', '88888'],
});

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function exactObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }
  return value;
}

function nonempty(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} must be nonempty.`);
  }
  return value;
}

function sha256Value(value, name) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${name} must be a lowercase SHA-256 hash.`);
  }
  return value;
}

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function positiveNumber(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive finite number.`);
  }
  return value;
}

function percentile(samples, fraction) {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new Error('Curve benchmark timing samples must not be empty.');
  }
  const sorted = samples.map((value, index) =>
    positiveNumber(value, `Timing sample ${index}`)).sort((left, right) => left - right);
  return Number(sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)].toFixed(3));
}

function validateDistribution(value, name) {
  const distribution = exactObject(value, name);
  if (!Array.isArray(distribution.samplesMs) || distribution.samplesMs.length === 0) {
    throw new Error(`${name} samples must not be empty.`);
  }
  const expectedP50 = percentile(distribution.samplesMs, 0.5);
  const expectedP95 = percentile(distribution.samplesMs, 0.95);
  if (distribution.p50Ms !== expectedP50 || distribution.p95Ms !== expectedP95) {
    throw new Error(`${name} percentiles do not match the recorded samples.`);
  }
  if (distribution.p95Ms < distribution.p50Ms) {
    throw new Error(`${name} p95 must not be below p50.`);
  }
}

function validateContractMetrics(value, name) {
  const contract = exactObject(value, name);
  const metricKeys = [
    'instructions',
    'readBytes',
    'writeBytes',
    'resourceFeeStroops',
    'transactionBytes',
  ];
  if (!['measured', 'pending'].includes(contract.status)) {
    throw new Error(`${name} status is invalid.`);
  }
  nonempty(contract.reason, `${name} reason`);
  if (contract.status === 'pending') {
    if (metricKeys.some(key => !(key in contract) || contract[key] !== null)) {
      throw new Error(`${name} pending metrics must be explicit nulls.`);
    }
    return;
  }
  for (const key of ['instructions', 'readBytes', 'writeBytes', 'transactionBytes']) {
    positiveInteger(contract[key], `${name} ${key}`);
  }
  if (typeof contract.resourceFeeStroops !== 'string' || !/^[1-9][0-9]*$/.test(contract.resourceFeeStroops)) {
    throw new Error(`${name} resource fee is invalid.`);
  }
}

export function validateCurveBenchmarkEvidence(value) {
  const evidence = exactObject(value, 'Curve benchmark evidence');
  if (evidence.schemaVersion !== 1 || evidence.benchmark !== 'private-action-groth16-curves') {
    throw new Error('Curve benchmark schema identity is invalid.');
  }
  if (!Number.isFinite(Date.parse(evidence.generatedAt))) {
    throw new Error('Curve benchmark timestamp is invalid.');
  }
  sha256Value(evidence.circuitCorpusSha256, 'Curve benchmark circuit corpus hash');
  const decision = exactObject(evidence.decision, 'Curve benchmark decision');
  if (
    decision.status !== 'pending-physical-device-evidence' ||
    decision.selectedCurve !== null
  ) {
    throw new Error('Provisional curve benchmark must not select a curve.');
  }
  nonempty(decision.reason, 'Curve benchmark decision reason');
  if (!Array.isArray(evidence.runs) || evidence.runs.length !== 2) {
    throw new Error('Curve benchmark requires exactly one measured run per curve.');
  }
  const seenCurves = new Set();
  for (const [index, runValue] of evidence.runs.entries()) {
    const run = exactObject(runValue, `Curve benchmark run ${index}`);
    if (!['bn254', 'bls12-381'].includes(run.curve) || seenCurves.has(run.curve)) {
      throw new Error('Curve benchmark requires exactly one measured run per curve.');
    }
    seenCurves.add(run.curve);
    if (run.proofSystem !== 'groth16' || run.status !== 'measured') {
      throw new Error(`Curve benchmark ${run.curve} proof status is invalid.`);
    }
    const device = exactObject(run.device, `Curve benchmark ${run.curve} device`);
    const browser = exactObject(device.browser, `Curve benchmark ${run.curve} browser`);
    for (const [name, field] of [
      ['manufacturer', device.manufacturer],
      ['model', device.model],
      ['cpu', device.cpu],
      ['browser name', browser.name],
      ['browser version', browser.version],
      ['browser user agent', browser.userAgent],
    ]) nonempty(field, `Curve benchmark ${run.curve} ${name}`);
    if (run.physicalDevice === true) {
      if (
        device.class !== 'phone' ||
        run.evidenceKind !== 'physical-device' ||
        /Node\.js/i.test(browser.name)
      ) {
        throw new Error('Physical phone evidence must identify a real mobile browser and phone.');
      }
      const attestation = exactObject(
        run.physicalAttestation,
        `Curve benchmark ${run.curve} physical attestation`,
      );
      if (!Number.isFinite(Date.parse(attestation.observedAt))) {
        throw new Error('Physical phone evidence must include a valid observation time.');
      }
      nonempty(attestation.operator, `Curve benchmark ${run.curve} attestation operator`);
      sha256Value(
        attestation.evidenceSha256,
        `Curve benchmark ${run.curve} attestation evidence hash`,
      );
    } else if (
      run.physicalDevice !== false ||
      device.class === 'phone' ||
      run.physicalAttestation !== null
    ) {
      throw new Error('Physical phone evidence must not be inferred from desktop or emulator runs.');
    }
    const capabilities = exactObject(
      run.capabilities,
      `Curve benchmark ${run.curve} capabilities`,
    );
    for (const key of [
      'wasmSimd',
      'wasmThreads',
      'crossOriginIsolated',
      'provingKeyStreaming',
      'nativeMobileProver',
    ]) {
      if (typeof capabilities[key] !== 'boolean') {
        throw new Error(`Curve benchmark ${run.curve} ${key} flag is invalid.`);
      }
    }
    const circuit = exactObject(run.circuit, `Curve benchmark ${run.curve} circuit`);
    for (const key of [
      'constraintCount',
      'publicInputCount',
      'privateInputCount',
      'r1csBytes',
      'witnessWasmBytes',
      'provingKeyBytes',
      'verificationKeyBytes',
    ]) positiveInteger(circuit[key], `Curve benchmark ${run.curve} ${key}`);
    for (const key of ['r1csSha256', 'witnessWasmSha256', 'provingKeySha256']) {
      sha256Value(circuit[key], `Curve benchmark ${run.curve} ${key}`);
    }
    const workload = exactObject(run.workload, `Curve benchmark ${run.curve} workload`);
    if (workload.corpus !== CORPUS_DESCRIPTOR.name) {
      throw new Error(`Curve benchmark ${run.curve} corpus is invalid.`);
    }
    sha256Value(workload.corpusSha256, `Curve benchmark ${run.curve} corpus hash`);
    if (workload.corpusSha256 !== evidence.circuitCorpusSha256) {
      throw new Error(`Curve benchmark ${run.curve} corpus hash does not match.`);
    }
    if (!Number.isSafeInteger(workload.warmupIterations) || workload.warmupIterations < 0) {
      throw new Error(`Curve benchmark ${run.curve} warmup count is invalid.`);
    }
    positiveInteger(workload.measuredIterations, `Curve benchmark ${run.curve} iterations`);
    validateDistribution(run.proving, `Curve benchmark ${run.curve} proving`);
    positiveInteger(run.proving.peakRssBytes, `Curve benchmark ${run.curve} peak memory`);
    validateDistribution(run.verification, `Curve benchmark ${run.curve} verification`);
    const proof = exactObject(run.proof, `Curve benchmark ${run.curve} proof`);
    positiveInteger(proof.jsonBytes, `Curve benchmark ${run.curve} proof JSON size`);
    positiveInteger(
      proof.canonicalUncompressedBytes,
      `Curve benchmark ${run.curve} canonical proof size`,
    );
    if (proof.verified !== true) {
      throw new Error(`Curve benchmark ${run.curve} proof was not verified.`);
    }
    validateContractMetrics(run.contract, `Curve benchmark ${run.curve} contract`);
  }
  if (!Array.isArray(evidence.pendingPhysicalDevices) || evidence.pendingPhysicalDevices.length < 2) {
    throw new Error('Curve benchmark must record the pending physical-phone matrix.');
  }
  const pendingBrowsers = new Set();
  for (const pendingValue of evidence.pendingPhysicalDevices) {
    const pending = exactObject(pendingValue, 'Pending physical device');
    if (
      pending.physicalDevice !== true ||
      pending.status !== 'pending' ||
      pending.deviceClass !== 'mid-range-phone' ||
      !['iOS Safari', 'Android Chrome'].includes(pending.browser)
    ) {
      throw new Error('Pending physical-device evidence is invalid.');
    }
    pendingBrowsers.add(pending.browser);
  }
  if (!pendingBrowsers.has('iOS Safari') || !pendingBrowsers.has('Android Chrome')) {
    throw new Error('Both iOS Safari and Android Chrome physical evidence must remain explicit.');
  }
  if (!Array.isArray(evidence.limitations) || evidence.limitations.length === 0) {
    throw new Error('Curve benchmark limitations must not be empty.');
  }
  evidence.limitations.forEach((item, index) => nonempty(item, `Curve benchmark limitation ${index}`));
  return value;
}

function parseArguments(argv) {
  let outputPath = DEFAULT_OUTPUT;
  let iterations = 3;
  let warmupIterations = 1;
  let measurement = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (['--output', '--iterations', '--warmups', '--measure'].includes(argument)) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value.`);
      if (argument === '--output') outputPath = resolve(value);
      if (argument === '--iterations') iterations = Number(value);
      if (argument === '--warmups') warmupIterations = Number(value);
      if (argument === '--measure') measurement = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown curve benchmark argument: ${argument}`);
  }
  if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > 20) {
    throw new Error('--iterations must be an integer from 1 through 20.');
  }
  if (!Number.isSafeInteger(warmupIterations) || warmupIterations < 0 || warmupIterations > 5) {
    throw new Error('--warmups must be an integer from 0 through 5.');
  }
  if (measurement !== null && !CURVES.some(curve => curve.evidenceName === measurement)) {
    throw new Error('--measure must be bn254 or bls12-381.');
  }
  if (measurement === null) {
    const outputRelative = relative(RESULTS_ROOT, outputPath);
    if (outputRelative.startsWith('..') || outputRelative === '') {
      throw new Error('Curve benchmark output must be a file under protocol/private-balance/results.');
    }
  }
  return { outputPath, iterations, warmupIterations, measurement };
}

function mod(value, modulus) {
  const reduced = value % modulus;
  return reduced >= 0n ? reduced : reduced + modulus;
}

function sbox5(value, modulus) {
  const squared = mod(value * value, modulus);
  return mod(squared * squared * value, modulus);
}

function externalMatrix(state, modulus) {
  const t0 = mod(state[0] + state[1], modulus);
  const t1 = mod(state[2] + state[3], modulus);
  const t2 = mod(2n * state[1] + t1, modulus);
  const t3 = mod(2n * state[3] + t0, modulus);
  const t4 = mod(4n * t1 + t3, modulus);
  const t5 = mod(4n * t0 + t2, modulus);
  return [mod(t3 + t5, modulus), t5, mod(t2 + t4, modulus), t4];
}

function internalMatrix(state, modulus) {
  const sum = mod(state[0] + state[1] + state[2] + state[3], modulus);
  return state.map((value, index) =>
    mod(value * POSEIDON2_DIAGONAL[index] + sum, modulus));
}

function poseidon2Hash(inputs, modulus) {
  let state = [0n, 0n, 0n, BigInt(inputs.length) * (1n << 64n)];
  let inputIndex = 0;
  const blockCount = Math.max(1, Math.ceil(inputs.length / 3));
  for (let block = 0; block < blockCount; block += 1) {
    for (let rateIndex = 0; rateIndex < 3 && inputIndex < inputs.length; rateIndex += 1) {
      state[rateIndex] = mod(state[rateIndex] + inputs[inputIndex], modulus);
      inputIndex += 1;
    }
    state = externalMatrix(state, modulus);
    for (let round = 0; round < 4; round += 1) {
      state = externalMatrix(
        state.map((value, index) =>
          sbox5(value + POSEIDON2_ROUND_CONSTANTS[round * 4 + index], modulus)),
        modulus,
      );
    }
    for (let partial = 0; partial < 56; partial += 1) {
      const round = 4 + partial;
      state[0] = sbox5(state[0] + POSEIDON2_ROUND_CONSTANTS[round * 4], modulus);
      state = internalMatrix(state, modulus);
    }
    for (let finalRound = 0; finalRound < 4; finalRound += 1) {
      const round = 60 + finalRound;
      state = externalMatrix(
        state.map((value, index) =>
          sbox5(value + POSEIDON2_ROUND_CONSTANTS[round * 4 + index], modulus)),
        modulus,
      );
    }
  }
  return state[0];
}

function benchmarkWitness(curve) {
  const modulus = curve.scalarModulus;
  const hash = values => poseidon2Hash(values.map(BigInt), modulus).toString();
  const ownerCommitment = ({ ask, nk, diversifier }) => {
    const base = hash([DOMAIN.owner, CORPUS_DESCRIPTOR.contextField, ask, nk]);
    return hash([DOMAIN.diversifiedOwner, base, diversifier]);
  };
  const outputOwners = CORPUS_DESCRIPTOR.outputOwners.map(ownerCommitment);
  const outputCommitments = outputOwners.map((owner, index) => hash([
    DOMAIN.note,
    CORPUS_DESCRIPTOR.contextField,
    CORPUS_DESCRIPTOR.assetField,
    owner,
    CORPUS_DESCRIPTOR.outputValues[index],
    CORPUS_DESCRIPTOR.outputRhos[index],
  ]));
  const nullifiers = CORPUS_DESCRIPTOR.inputDummySecrets.map((secret, lane) => hash([
    DOMAIN.dummyNullifier,
    CORPUS_DESCRIPTOR.contextField,
    secret,
    lane,
  ]));
  const actionBinding = hash([
    DOMAIN.actionBinding,
    CORPUS_DESCRIPTOR.contextField,
    CORPUS_DESCRIPTOR.actionField,
  ]);
  const zeroPath = new Array(32).fill('0');
  return {
    contextField: CORPUS_DESCRIPTOR.contextField,
    assetField: CORPUS_DESCRIPTOR.assetField,
    actionKindField: '1',
    anchorRoot: '0',
    publicValueField: CORPUS_DESCRIPTOR.publicValueField,
    relayerFeeField: '0',
    relayerField: '0',
    actionField: CORPUS_DESCRIPTOR.actionField,
    actionBinding,
    nullifier: nullifiers,
    outputCommitment: outputCommitments,
    ask: '0',
    nk: '0',
    inputReal: ['0', '0'],
    inputDummySecret: CORPUS_DESCRIPTOR.inputDummySecrets,
    inputOwnerCommitment: ['0', '0'],
    inputDiversifier: ['0', '0'],
    inputValue: ['0', '0'],
    inputRho: ['0', '0'],
    inputLeafIndex: ['0', '0'],
    inputSiblings: [zeroPath, zeroPath],
    inputDirectionBits: [zeroPath, zeroPath],
    outputReal: ['1', '0'],
    outputOwnerCommitment: outputOwners,
    outputValue: CORPUS_DESCRIPTOR.outputValues,
    outputRho: CORPUS_DESCRIPTOR.outputRhos,
  };
}

function roundedDuration(started) {
  return Number((performance.now() - started).toFixed(3));
}

async function measureCurve(curve, directory, iterations, warmupIterations) {
  const wasmPath = join(directory, 'action_js/action.wasm');
  const zkeyPath = join(directory, 'action_benchmark.zkey');
  const verificationKey = JSON.parse(readFileSync(join(directory, 'verification_key.json'), 'utf8'));
  const witness = benchmarkWitness(curve);
  let latestProof = null;

  for (let warmup = 0; warmup < warmupIterations; warmup += 1) {
    latestProof = await snarkjs.groth16.fullProve(witness, wasmPath, zkeyPath);
    if (!await snarkjs.groth16.verify(
      verificationKey,
      latestProof.publicSignals,
      latestProof.proof,
    )) throw new Error(`${curve.evidenceName} warmup proof failed verification.`);
  }

  const provingSamples = [];
  const verificationSamples = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const provingStarted = performance.now();
    latestProof = await snarkjs.groth16.fullProve(witness, wasmPath, zkeyPath);
    provingSamples.push(roundedDuration(provingStarted));
    const verificationStarted = performance.now();
    const verified = await snarkjs.groth16.verify(
      verificationKey,
      latestProof.publicSignals,
      latestProof.proof,
    );
    verificationSamples.push(roundedDuration(verificationStarted));
    if (!verified) throw new Error(`${curve.evidenceName} benchmark proof failed verification.`);
  }
  if (!latestProof) throw new Error(`${curve.evidenceName} benchmark produced no proof.`);
  return {
    proving: {
      samplesMs: provingSamples,
      p50Ms: percentile(provingSamples, 0.5),
      p95Ms: percentile(provingSamples, 0.95),
      peakRssBytes: Math.max(1, process.resourceUsage().maxRSS * 1024),
    },
    verification: {
      samplesMs: verificationSamples,
      p50Ms: percentile(verificationSamples, 0.5),
      p95Ms: percentile(verificationSamples, 0.95),
    },
    proof: {
      jsonBytes: Buffer.byteLength(JSON.stringify(latestProof.proof)),
      canonicalUncompressedBytes: curve.canonicalUncompressedProofBytes,
      verified: true,
    },
  };
}

function compileMetadata(output) {
  const match = label => {
    const found = output.match(new RegExp(`${label}:\\s*([0-9]+)`));
    if (!found) throw new Error(`Circom output did not report ${label}.`);
    return Number(found[1]);
  };
  return {
    constraintCount: match('non-linear constraints'),
    publicInputCount: match('public inputs'),
    privateInputCount: match('private inputs'),
  };
}

function fileEvidence(path) {
  const bytes = readFileSync(path);
  return { bytes: statSync(path).size, sha256: sha256(bytes) };
}

function nodeDevice() {
  const cpu = cpus()[0]?.model?.trim() || 'Unknown CPU';
  const osName = platform() === 'darwin'
    ? 'macOS'
    : platform() === 'win32'
      ? 'Windows'
      : platform();
  return {
    class: 'desktop',
    manufacturer: platform() === 'darwin' ? 'Apple' : 'Unknown',
    model: 'Desktop benchmark host',
    cpu,
    os: { name: osName, version: release(), architecture: arch() },
    browser: {
      name: 'Node.js desktop harness',
      version: process.versions.node,
      userAgent: `Node.js/${process.versions.node} (${platform()}; ${arch()})`,
    },
  };
}

function pendingContractMetrics() {
  return {
    status: 'pending',
    instructions: null,
    readBytes: null,
    writeBytes: null,
    resourceFeeStroops: null,
    transactionBytes: null,
    reason: 'No curve-specific Soroban verifier transaction was built; resource and transaction measurements remain pending.',
  };
}

function prepareCurve(curve, workRoot) {
  const directory = join(workRoot, curve.evidenceName);
  mkdirSync(directory, { recursive: true });
  const compileOutput = execFileSync(process.execPath, [
    COMPILE_SCRIPT,
    '--benchmark-curve', curve.circomName,
    '--output', directory,
  ], { cwd: PROJECT_ROOT, encoding: 'utf8' });
  const initialPtau = join(directory, 'pot15_0000.ptau');
  const finalPtau = join(directory, 'pot15_final.ptau');
  execFileSync(process.execPath, [
    SNARKJS_CLI,
    'powersoftau', 'new', curve.snarkjsName, String(PTAU_POWER), initialPtau,
  ], { cwd: PROJECT_ROOT, stdio: 'ignore' });
  execFileSync(process.execPath, [
    SNARKJS_CLI,
    'powersoftau', 'prepare', 'phase2', initialPtau, finalPtau,
  ], { cwd: PROJECT_ROOT, stdio: 'ignore' });
  const zkeyPath = join(directory, 'action_benchmark.zkey');
  execFileSync(process.execPath, [
    SNARKJS_CLI,
    'groth16', 'setup', join(directory, 'action.r1cs'), finalPtau, zkeyPath,
  ], { cwd: PROJECT_ROOT, stdio: 'ignore' });
  execFileSync(process.execPath, [
    SNARKJS_CLI,
    'zkey', 'export', 'verificationkey', zkeyPath, join(directory, 'verification_key.json'),
  ], { cwd: PROJECT_ROOT, stdio: 'ignore' });
  return { directory, compile: compileMetadata(compileOutput) };
}

function measureInFreshProcess(curve, directory, iterations, warmupIterations) {
  const stdout = execFileSync(process.execPath, [
    SCRIPT_PATH,
    '--measure', curve.evidenceName,
    '--output', directory,
    '--iterations', String(iterations),
    '--warmups', String(warmupIterations),
  ], { cwd: PROJECT_ROOT, encoding: 'utf8' });
  return JSON.parse(stdout);
}

async function runBenchmark(options) {
  const workRoot = mkdtempSync(join(tmpdir(), 'stellarkey-curve-benchmark-'));
  const corpusSha256 = sha256(JSON.stringify(CORPUS_DESCRIPTOR));
  const runs = [];
  for (const curve of CURVES) {
    process.stderr.write(`Preparing ${curve.evidenceName} benchmark artifacts…\n`);
    const prepared = prepareCurve(curve, workRoot);
    process.stderr.write(`Measuring ${curve.evidenceName} proofs…\n`);
    const measured = measureInFreshProcess(
      curve,
      prepared.directory,
      options.iterations,
      options.warmupIterations,
    );
    const r1cs = fileEvidence(join(prepared.directory, 'action.r1cs'));
    const witnessWasm = fileEvidence(join(prepared.directory, 'action_js/action.wasm'));
    const provingKey = fileEvidence(join(prepared.directory, 'action_benchmark.zkey'));
    const verificationKey = fileEvidence(join(prepared.directory, 'verification_key.json'));
    runs.push({
      id: `${curve.evidenceName}-node-desktop-smoke`,
      curve: curve.evidenceName,
      proofSystem: 'groth16',
      status: 'measured',
      evidenceKind: 'desktop-smoke',
      physicalDevice: false,
      physicalAttestation: null,
      device: nodeDevice(),
      capabilities: {
        wasmSimd: false,
        wasmThreads: false,
        crossOriginIsolated: false,
        provingKeyStreaming: false,
        nativeMobileProver: false,
      },
      circuit: {
        ...prepared.compile,
        r1csBytes: r1cs.bytes,
        witnessWasmBytes: witnessWasm.bytes,
        provingKeyBytes: provingKey.bytes,
        verificationKeyBytes: verificationKey.bytes,
        r1csSha256: r1cs.sha256,
        witnessWasmSha256: witnessWasm.sha256,
        provingKeySha256: provingKey.sha256,
      },
      workload: {
        corpus: CORPUS_DESCRIPTOR.name,
        corpusSha256,
        warmupIterations: options.warmupIterations,
        measuredIterations: options.iterations,
      },
      ...measured,
      contract: pendingContractMetrics(),
    });
  }
  const evidence = {
    schemaVersion: 1,
    benchmark: 'private-action-groth16-curves',
    generatedAt: new Date().toISOString(),
    circuitCorpusSha256: corpusSha256,
    decision: {
      status: 'pending-physical-device-evidence',
      selectedCurve: null,
      reason: 'Desktop smoke measurements cannot select a production curve without physical-phone and Soroban resource evidence.',
    },
    runs,
    pendingPhysicalDevices: [
      {
        platform: 'ios',
        browser: 'iOS Safari',
        deviceClass: 'mid-range-phone',
        physicalDevice: true,
        status: 'pending',
      },
      {
        platform: 'android',
        browser: 'Android Chrome',
        deviceClass: 'mid-range-phone',
        physicalDevice: true,
        status: 'pending',
      },
    ],
    limitations: [
      'These are Node.js desktop smoke measurements, not browser or physical-device evidence.',
      'The BLS12-381 compile reuses the frozen circuit corpus for comparison; a production design still requires curve-reviewed hash parameters and verifier code.',
      'Soroban instructions, ledger I/O, simulated resource fee, and transaction bytes remain pending until a curve-specific verifier transaction exists.',
      'The benchmark-only powers-of-tau and Groth16 setup are disposable development material and are not release ceremony artifacts.',
    ],
  };
  validateCurveBenchmarkEvidence(evidence);
  mkdirSync(dirname(options.outputPath), { recursive: true });
  writeFileSync(options.outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o644 });
  return evidence;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  const options = parseArguments(process.argv.slice(2));
  if (options.measurement) {
    const curve = CURVES.find(item => item.evidenceName === options.measurement);
    const result = await measureCurve(
      curve,
      options.outputPath,
      options.iterations,
      options.warmupIterations,
    );
    process.stdout.write(JSON.stringify(result));
    process.exit(0);
  }
  await runBenchmark(options);
}
