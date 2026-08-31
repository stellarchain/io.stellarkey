import {
  copyFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { brotliCompressSync, constants as zlibConstants } from 'node:zlib';
import * as snarkjs from 'snarkjs';
import { encodePointCompressedZkey } from './zkey-point-transport.mjs';

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function sha256Files(files) {
  const hash = createHash('sha256');
  for (const file of [...files].sort()) {
    hash.update(relative(process.cwd(), file));
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function contractSourceCommit() {
  const override = process.env.PRIVATE_BALANCE_SOURCE_COMMIT;
  if (override !== undefined) {
    if (!/^[0-9a-f]{40}$/.test(override)) {
      throw new Error('PRIVATE_BALANCE_SOURCE_COMMIT must be a full lowercase Git commit.');
    }
    return override;
  }
  const commit = execFileSync('git', ['log', '-1', '--format=%H', '--',
    'protocol/private-balance/contracts/pool',
    'protocol/private-balance/crates/protocol',
    'protocol/private-balance/crates/verifier',
    'protocol/private-balance/Cargo.lock',
    'protocol/private-balance/rust-toolchain.toml',
  ], { cwd: process.cwd(), encoding: 'utf8' }).trim();
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error('Unable to derive the Private Balance contract source commit.');
  }
  return commit;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`Testnet deployment evidence ${label} does not match the current build.`);
  }
}

function assertJsonEqual(actual, expected, label) {
  assertEqual(JSON.stringify(actual), JSON.stringify(expected), label);
}

function loadTestnetDeploymentEvidence(baseManifest) {
  const fixtureDir = join(
    process.cwd(),
    'protocol/private-balance/results/fixtures',
  );
  const fixtureNames = readdirSync(fixtureDir)
    .filter(name => /^testnet-fixture-C[A-Z2-7]{55}\.json$/.test(name));
  if (fixtureNames.length !== 1) {
    throw new Error(
      `Expected exactly one current testnet deployment evidence file, found ${fixtureNames.length}.`,
    );
  }
  const evidence = JSON.parse(readFileSync(join(fixtureDir, fixtureNames[0]), 'utf8'));
  const deployed = evidence.manifest;
  if (!evidence.fixtureOnly || !deployed || deployed.status !== 'development') {
    throw new Error('Testnet deployment evidence must be a development-only fixture.');
  }

  for (const key of [
    'schemaVersion',
    'protocolVersion',
    'minimumStellarProtocol',
    'networkPassphrase',
    'networkId',
  ]) {
    assertEqual(deployed[key], baseManifest[key], `manifest.${key}`);
  }
  assertJsonEqual(deployed.artifacts, baseManifest.artifacts, 'manifest.artifacts');
  assertJsonEqual(deployed.constants, baseManifest.constants, 'manifest.constants');
  assertJsonEqual(deployed.hpke, baseManifest.hpke, 'manifest.hpke');
  assertJsonEqual(deployed.release, baseManifest.release, 'manifest.release');

  assertEqual(evidence.networkPassphrase, baseManifest.networkPassphrase, 'network passphrase');
  assertEqual(evidence.poolContractId, deployed.poolContractId, 'pool contract ID');
  assertEqual(evidence.wasmSha256, baseManifest.release.contractWasmSha256, 'pool Wasm hash');
  assertEqual(evidence.deploymentBindingHash, deployed.deploymentBindingHash, 'deployment binding');
  assertEqual(evidence.config?.deployment_binding_hash, deployed.deploymentBindingHash, 'contract binding');
  assertEqual(evidence.config?.network_id, baseManifest.networkId, 'contract network ID');
  assertEqual(evidence.config?.realm_id, deployed.realmId, 'contract realm ID');
  assertEqual(evidence.config?.guardian, deployed.guardianAddress, 'contract guardian');
  assertEqual(evidence.config?.circuit_hash, baseManifest.artifacts.r1csSha256, 'contract circuit hash');
  assertEqual(
    evidence.config?.verification_key_hash,
    baseManifest.artifacts.vkBinSha256,
    'contract verification-key hash',
  );
  assertEqual(
    evidence.config?.poseidon2_parameter_hash,
    baseManifest.release.poseidonParametersSha256,
    'contract Poseidon parameter hash',
  );
  if (evidence.asset?.kind !== 'native' || !/^C[A-Z2-7]{55}$/.test(evidence.assetContractId)) {
    throw new Error('Testnet deployment evidence must record the canonical native XLM SAC.');
  }
  if (evidence.depositsPaused !== false || evidence.treeState?.next_index !== 0) {
    throw new Error('Testnet deployment evidence must record a fresh, deposit-enabled pool.');
  }
  return evidence;
}

const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';
const prepareDeployment = process.argv.includes('--prepare-deployment');

const buildDir = join(process.cwd(), 'protocol/private-balance/circuits/build');
const publicDir = join(process.cwd(), 'public/protocol/private-balance/v1');
const expectedManifestModule = join(
  process.cwd(),
  'src/lib/private-balance-expected-manifest.ts',
);
const expectedCatalogueModule = join(
  process.cwd(),
  'src/lib/private-balance-expected-catalogue.ts',
);

mkdirSync(publicDir, { recursive: true });

const wasmBytes = readFileSync(join(buildDir, 'action_js/action.wasm'));
const zkeyBytes = readFileSync(join(buildDir, 'action_dev.zkey'));
const zkeyTransportBytes = await encodePointCompressedZkey(zkeyBytes);
const zkeyTransportBrotliBytes = brotliCompressSync(zkeyTransportBytes, {
  params: {
    [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_GENERIC,
    [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
  },
});
const vkJsonBytes = readFileSync(join(buildDir, 'verification_key.json'));
const vkBinBytes = readFileSync(join(buildDir, 'verifying-key.bin'));
const r1csBytes = readFileSync(join(buildDir, 'action.r1cs'));
const r1csInfo = await snarkjs.r1cs.info(join(buildDir, 'action.r1cs'));
const contractWasmPath = join(
  process.cwd(),
  'protocol/private-balance/target/wasm32v1-none/release/private_balance_pool.wasm',
);
const publicContractWasmPath = join(publicDir, 'pool.wasm');
const contractWasmSource = existsSync(contractWasmPath)
  ? contractWasmPath
  : publicContractWasmPath;
if (!existsSync(contractWasmSource)) {
  throw new Error('Private Balance pool Wasm is missing. Run private:generate first.');
}
if (r1csInfo.nPubInputs !== 13) {
  throw new Error(`Expected 13 public inputs, got ${r1csInfo.nPubInputs}`);
}
const r1csConstraints = r1csInfo.nConstraints;
if (typeof r1csInfo.curve.terminate === 'function') await r1csInfo.curve.terminate();

copyFileSync(join(buildDir, 'action_js/action.wasm'), join(publicDir, 'circuit.wasm'));
copyFileSync(join(buildDir, 'action_dev.zkey'), join(publicDir, 'circuit.zkey'));
writeFileSync(join(publicDir, 'circuit.zkey.pc'), zkeyTransportBytes);
rmSync(join(publicDir, 'circuit.zkey.gz'), { force: true });
copyFileSync(join(buildDir, 'verification_key.json'), join(publicDir, 'verification-key.json'));
if (contractWasmSource !== publicContractWasmPath) {
  copyFileSync(contractWasmSource, publicContractWasmPath);
}
chmodSync(publicContractWasmPath, 0o644);

const baseManifest = {
  schemaVersion: 1,
  protocolVersion: 1,
  artifactVersion: '1.0.2-dev',
  status: 'development',
  minimumStellarProtocol: 25,
  networkPassphrase: TESTNET_PASSPHRASE,
  networkId: sha256(Buffer.from(TESTNET_PASSPHRASE, 'utf8')),
  realmId: '02'.repeat(32),
  poolContractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAITA4',
  guardianAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
  stealthAnnouncerAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
  deploymentBindingHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  artifacts: {
    r1csSha256: sha256(r1csBytes),
    r1csConstraints,
    wasmSha256: sha256(wasmBytes),
    wasmByteLength: wasmBytes.length,
    zkeySha256: sha256(zkeyBytes),
    zkeyByteLength: zkeyBytes.length,
    zkeyTransport: {
      encoding: 'points-compressed',
      sha256: sha256(zkeyTransportBytes),
      byteLength: zkeyTransportBytes.length,
      wireByteLength: zkeyTransportBrotliBytes.length,
    },
    vkJsonSha256: sha256(vkJsonBytes),
    vkBinSha256: sha256(vkBinBytes),
  },
  constants: {
    treeDepth: 32,
    treeArity: 2,
    rootWindowLedgers: 1440,
    pageCapacity: 32,
    maxPagesPerTouch: 4,
    publicInputs: 13,
    notePlaintextBytes: 128,
    recipientEnvelopeBytes: 181,
    outputPackageBytes: 213,
    addressPayloadBytes: 68,
    addressAsciiBytes: 119,
    addressContextTagBytes: 0,
    addressChecksumBytes: 6,
  },
  hpke: {
    kemId: '0x0020',
    kdfId: '0x0001',
    aeadId: '0x0001',
  },
  release: {
    contractWasmSha256: sha256(readFileSync(contractWasmSource)),
    contractSourceCommit: contractSourceCommit(),
    circuitSourceSha256: sha256Files(
      readdirSync(join(process.cwd(), 'protocol/private-balance/circuits/circom'))
        .filter(file => file.endsWith('.circom'))
        .map(file => join(process.cwd(), 'protocol/private-balance/circuits/circom', file)),
    ),
    poseidonParametersSha256: sha256(readFileSync(
      join(process.cwd(), 'protocol/private-balance/parameters/poseidon2-bn254-t4-v1.json'),
    )),
    hpkePackageVersion: '@hpke/core@1.9.0+@hpke/dhkem-x25519@1.8.0',
    hpkeDependencyIntegritySha256: sha256(readFileSync(
      join(process.cwd(), 'protocol/private-balance/packages/browser/package-lock.json'),
    )),
    toolchainLockSha256: sha256Files([
      join(process.cwd(), 'package-lock.json'),
      join(process.cwd(), 'protocol/private-balance/Cargo.lock'),
      join(process.cwd(), 'protocol/private-balance/circuits/package-lock.json'),
      join(process.cwd(), 'protocol/private-balance/rust-toolchain.toml'),
      join(process.cwd(), 'protocol/private-balance/parameters/generator.lock'),
      join(process.cwd(), 'protocol/private-balance/scripts/build-private-balance-artifacts.mjs'),
      join(process.cwd(), 'protocol/private-balance/scripts/zkey-point-transport.mjs'),
    ]),
    ceremonyTranscriptRoot: '0'.repeat(64),
    auditReports: [],
    deploymentTransactions: [],
    allowedEnvironment: 'testnet',
  },
};

if (prepareDeployment) {
  const developmentManifestPath = join(
    process.cwd(),
    'protocol/private-balance/manifests/development.json',
  );
  writeFileSync(developmentManifestPath, `${JSON.stringify(baseManifest, null, 2)}\n`);
  console.log(
    '✓ Staged Private Balance artifacts and development manifest for deployment; ' +
    'published evidence and wallet hash pins are unchanged.',
  );
} else {
const deploymentEvidence = loadTestnetDeploymentEvidence(baseManifest);
const manifest = deploymentEvidence.manifest;

const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
const manifestHash = sha256(Buffer.from(manifestJson));
const catalogue = {
  schemaVersion: 1,
  deployments: [{
    id: 'testnet-private-pool-v2',
    network: 'testnet',
    assets: [
      {
        kind: 'native',
        code: 'XLM',
        issuer: null,
        name: 'Stellar Lumens',
        decimals: 7,
        displayDecimals: 7,
        contractId: deploymentEvidence.assetContractId,
      },
      {
        kind: 'stellar',
        code: 'USDC',
        issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        name: 'USD Coin',
        decimals: 7,
        displayDecimals: 2,
        contractId: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
      },
    ],
    manifestUrl: '/protocol/private-balance/v1/manifest.json',
    manifestSha256: manifestHash,
  }],
};
const catalogueJson = `${JSON.stringify(catalogue, null, 2)}\n`;
const catalogueHash = sha256(Buffer.from(catalogueJson));
writeFileSync(join(publicDir, 'manifest.json'), manifestJson);
writeFileSync(join(publicDir, 'catalogue.json'), catalogueJson);
writeFileSync(join(process.cwd(), 'protocol/private-balance/manifests/development.json'), manifestJson);
writeFileSync(
  expectedManifestModule,
  `/** Generated by protocol/private-balance/scripts/generate-manifest.mjs. */\n` +
    `export const EXPECTED_PRIVATE_BALANCE_MANIFEST_SHA256 =\n` +
    `  '${manifestHash}';\n` +
    `export const ALLOW_PRIVATE_BALANCE_DEVELOPMENT_FIXTURE =\n` +
    `  process.env.NODE_ENV === 'development';\n`,
);
writeFileSync(
  expectedCatalogueModule,
  `/** Generated by protocol/private-balance/scripts/generate-manifest.mjs. */\n` +
    `export const EXPECTED_PRIVATE_BALANCE_CATALOGUE_SHA256 =\n` +
    `  '${catalogueHash}';\n`,
);

console.log('✓ Generated Private Balance manifest, expected hash, and static proof files.');
}
