#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Asset, Keypair, StrKey } from '@stellar/stellar-sdk';

export const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';
export const TESTNET_NETWORK_ID = createHash('sha256')
  .update(TESTNET_PASSPHRASE, 'utf8')
  .digest('hex');
export const TESTNET_USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
export const TESTNET_USDC_SAC_ID = new Asset('USDC', TESTNET_USDC_ISSUER)
  .contractId(TESTNET_PASSPHRASE);

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MANIFEST_PATH = path.join(PROJECT_ROOT, 'protocol/private-balance/manifests/development.json');
const PUBLIC_POOL_WASM_PATH = path.join(
  PROJECT_ROOT,
  'public/protocol/private-balance/v1/pool.wasm',
);
const POSEIDON_PARAMETERS_PATH = path.join(
  PROJECT_ROOT,
  'protocol/private-balance/parameters/poseidon2-bn254-t4-v1.json',
);
const RESULTS_ROOT = path.join(PROJECT_ROOT, 'protocol/private-balance/results/fixtures');
const DOMAIN_DEPLOYMENT_BINDING = 'SKSB_DEPLOYMENT_BINDING_V1';
const TREE_DEPTH = 32;
const ROOT_WINDOW_LEDGERS = 1_440;
const PAGE_CAPACITY = 32;
const PRIVATE_ADDRESS_PAYLOAD_BYTES = 68;
const PRIVATE_ADDRESS_ASCII_BYTES = 119;
const ADDRESS_CONTEXT_TAG_BYTES = 0;
const ADDRESS_CHECKSUM_BYTES = 6;
const HPKE_KEM_ID = 0x0020;
const HPKE_KDF_ID = 0x0001;
const HPKE_AEAD_ID = 0x0001;

function u16(value) {
  const bytes = Buffer.alloc(2);
  bytes.writeUInt16BE(value);
  return bytes;
}

function u32(value) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
}

function hex32(value, label) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${label} must be 32-byte lowercase hex.`);
  }
  return Buffer.from(value, 'hex');
}

function protocolArtifactHashes() {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  const poseidon2ParameterHash = createHash('sha256')
    .update(readFileSync(POSEIDON_PARAMETERS_PATH))
    .digest('hex');
  const circuitHash = manifest?.artifacts?.r1csSha256;
  const verificationKeyHash = manifest?.artifacts?.vkBinSha256;
  for (const [label, value] of [
    ['Poseidon2 parameter hash', poseidon2ParameterHash],
    ['Circuit hash', circuitHash],
    ['Verification-key hash', verificationKeyHash],
  ]) {
    hex32(value, label);
  }
  return { poseidon2ParameterHash, circuitHash, verificationKeyHash };
}

function contractPayload(value, label) {
  try {
    return Buffer.from(StrKey.decodeContract(value));
  } catch {
    throw new Error(`${label} must be a valid Stellar contract address.`);
  }
}

function guardianPayload(value) {
  try {
    if (StrKey.isValidEd25519PublicKey(value)) {
      return { kind: 0, payload: Buffer.from(StrKey.decodeEd25519PublicKey(value)) };
    }
    if (StrKey.isValidContract(value)) {
      return { kind: 1, payload: Buffer.from(StrKey.decodeContract(value)) };
    }
  } catch {
    // Fall through to one stable validation error.
  }
  throw new Error('Guardian must be a valid Stellar account or contract address.');
}

export function computeDeploymentBindingHash(input) {
  const domain = Buffer.from(DOMAIN_DEPLOYMENT_BINDING, 'utf8');
  const guardian = guardianPayload(input.guardianAddress);
  const bytes = Buffer.concat([
    u16(domain.byteLength),
    domain,
    u16(input.protocolVersion),
    hex32(input.networkId, 'Network ID'),
    hex32(input.realmId, 'Realm ID'),
    contractPayload(input.poolContractId, 'Pool contract ID'),
    Buffer.from([guardian.kind]),
    guardian.payload,
    hex32(input.poseidon2ParameterHash, 'Poseidon2 parameter hash'),
    hex32(input.circuitHash, 'Circuit hash'),
    hex32(input.verificationKeyHash, 'Verification-key hash'),
    u32(input.treeDepth),
    u32(input.rootWindowLedgers),
    u32(input.pageCapacity),
    u32(PRIVATE_ADDRESS_PAYLOAD_BYTES),
    u32(PRIVATE_ADDRESS_ASCII_BYTES),
    u32(ADDRESS_CONTEXT_TAG_BYTES),
    u32(ADDRESS_CHECKSUM_BYTES),
    u16(HPKE_KEM_ID),
    u16(HPKE_KDF_ID),
    u16(HPKE_AEAD_ID),
  ]);
  return createHash('sha256').update(bytes).digest('hex');
}

function fixtureBinding({ realmId, poolContractId, guardianAddress }) {
  const artifacts = protocolArtifactHashes();
  return {
    protocolVersion: 1,
    networkId: TESTNET_NETWORK_ID,
    realmId,
    poolContractId,
    guardianAddress,
    ...artifacts,
    treeDepth: TREE_DEPTH,
    rootWindowLedgers: ROOT_WINDOW_LEDGERS,
    pageCapacity: PAGE_CAPACITY,
  };
}

export function buildConstructorArguments(input) {
  const binding = fixtureBinding(input);
  const deploymentBindingHash = computeDeploymentBindingHash(binding);
  return [
    '--protocol_version', '1',
    '--network_id', TESTNET_NETWORK_ID,
    '--realm_id', input.realmId,
    '--guardian', input.guardianAddress,
    '--poseidon2_parameter_hash', binding.poseidon2ParameterHash,
    '--circuit_hash', binding.circuitHash,
    '--verification_key_hash', binding.verificationKeyHash,
    '--tree_depth', String(TREE_DEPTH),
    '--root_window_ledgers', String(ROOT_WINDOW_LEDGERS),
    '--page_capacity', String(PAGE_CAPACITY),
    '--deployment_binding_hash', deploymentBindingHash,
  ];
}

export function createFixtureEntropy(random = randomBytes) {
  const next = label => {
    const value = Buffer.from(random(32));
    if (value.byteLength !== 32) throw new Error(`${label} entropy must be exactly 32 bytes.`);
    if (value.every(byte => byte === 0)) throw new Error(`${label} entropy must be non-zero.`);
    return value.toString('hex');
  };
  return { realmId: next('Realm ID'), salt: next('Contract salt') };
}

export function fixtureAssetDescriptor(value = 'native') {
  if (value === 'native') {
    return {
      cliAsset: 'native',
      kind: 'native',
      code: 'XLM',
      issuer: null,
      name: 'Stellar Lumens',
      decimals: 7,
      displayDecimals: 7,
    };
  }
  const parts = value.split(':');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error('Fixture asset must be native or canonical CODE:ISSUER.');
  }
  const [code, issuer] = parts;
  if (!/^[A-Z0-9]{1,12}$/.test(code) || value !== `${code}:${issuer}`) {
    throw new Error('Fixture asset must use canonical uppercase CODE:ISSUER.');
  }
  if (!StrKey.isValidEd25519PublicKey(issuer)) {
    throw new Error('Fixture asset issuer must be a valid Stellar account address.');
  }
  // The SDK constructor provides a second, independent validation of the
  // classic asset shape before the CLI is allowed to derive its SAC.
  new Asset(code, issuer);
  return {
    cliAsset: value,
    kind: 'stellar',
    code,
    issuer,
    name: code === 'USDC' && issuer === TESTNET_USDC_ISSUER ? 'USD Coin' : `${code} asset`,
    decimals: 7,
    displayDecimals: 7,
  };
}

function sdkAssetContractId(asset) {
  return (asset.kind === 'native'
    ? Asset.native()
    : new Asset(asset.code, asset.issuer))
    .contractId(TESTNET_PASSPHRASE);
}

export function parseFixtureArguments(argv, environment = process.env) {
  const parsed = { asset: 'native', deploy: false, ephemeral: false, output: null, source: null };
  let assetSeen = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--deploy') {
      parsed.deploy = true;
      continue;
    }
    if (argument === '--ephemeral') {
      parsed.ephemeral = true;
      continue;
    }
    if (argument === '--source' || argument === '--output' || argument === '--asset') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value.`);
      if (argument === '--asset') {
        if (assetSeen) throw new Error('--asset may be provided only once.');
        fixtureAssetDescriptor(value);
        parsed.asset = value;
        assetSeen = true;
      } else {
        parsed[argument === '--source' ? 'source' : 'output'] = value;
      }
      index += 1;
      continue;
    }
    throw new Error(`Unknown fixture argument: ${argument}`);
  }
  if (parsed.source && parsed.ephemeral) {
    throw new Error('Choose either --ephemeral or --source, not both.');
  }
  if (parsed.deploy && !parsed.source && !parsed.ephemeral) {
    throw new Error('Live testnet deployment requires --ephemeral or an explicit --source signer.');
  }
  if (parsed.deploy && environment.PRIVATE_BALANCE_TESTNET_DEPLOY !== '1') {
    throw new Error('Set PRIVATE_BALANCE_TESTNET_DEPLOY=1 to confirm live testnet deployment.');
  }
  return parsed;
}

export function sanitizeFixtureEvidence(value) {
  const forbidden = /secret|seed|mnemonic|private.?key|configDirectory/i;
  if (Array.isArray(value)) return value.map(sanitizeFixtureEvidence);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !forbidden.test(key))
      .map(([key, child]) => [key, sanitizeFixtureEvidence(child)]),
  );
}

function stellar(args, options = {}) {
  const { configDirectory, ...executionOptions } = options;
  const commandArguments = configDirectory
    ? ['--config-dir', configDirectory, ...args]
    : args;
  return execFileSync('stellar', commandArguments, {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...executionOptions,
  }).trim();
}

function sourcePublicKey(source, options = {}) {
  if (StrKey.isValidEd25519PublicKey(source)) return source;
  if (StrKey.isValidEd25519SecretSeed(source)) return Keypair.fromSecret(source).publicKey();
  const resolved = stellar(['keys', 'public-key', source], options);
  if (!StrKey.isValidEd25519PublicKey(resolved)) {
    throw new Error('The selected Stellar CLI identity did not resolve to an account address.');
  }
  return resolved;
}

export function loadDeploymentWasm() {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  const bytes = readFileSync(PUBLIC_POOL_WASM_PATH);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const expected = manifest?.release?.contractWasmSha256;
  if (!/^[0-9a-f]{64}$/.test(expected ?? '')) {
    throw new Error('Development manifest does not pin a valid pool Wasm hash.');
  }
  if (sha256 !== expected) {
    throw new Error(`Committed pool Wasm does not match the development manifest: ${sha256} != ${expected}.`);
  }
  return { path: PUBLIC_POOL_WASM_PATH, sha256 };
}

function parseJsonOutput(source, label) {
  try {
    return JSON.parse(source);
  } catch {
    throw new Error(`${label} did not return JSON.`);
  }
}

function safeOutputPath(requested, poolContractId) {
  const target = requested
    ? path.resolve(PROJECT_ROOT, requested)
    : path.join(RESULTS_ROOT, `testnet-fixture-${poolContractId}.json`);
  const relative = path.relative(RESULTS_ROOT, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Fixture evidence must stay under protocol/private-balance/results/fixtures/.');
  }
  return target;
}

function createFixtureManifest({ poolContractId, guardianAddress, realmId, deploymentBindingHash }) {
  const development = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  return {
    ...development,
    artifactVersion: `${development.artifactVersion}-fixture`,
    status: 'development',
    networkPassphrase: TESTNET_PASSPHRASE,
    networkId: TESTNET_NETWORK_ID,
    realmId,
    poolContractId,
    guardianAddress,
    stealthAnnouncerAddress: guardianAddress,
    deploymentBindingHash,
  };
}

function deployFixture(parsed) {
  const configDirectory = parsed.ephemeral
    ? mkdtempSync(path.join(tmpdir(), 'stellarkey-private-cli-'))
    : null;
  try {
    const cliOptions = configDirectory ? { configDirectory } : {};
    const signer = parsed.ephemeral ? 'private-balance-fixture' : parsed.source;
    if (parsed.ephemeral) {
      stellar(['keys', 'generate', signer], cliOptions);
      stellar(['keys', 'fund', signer, '--network', 'testnet'], cliOptions);
    }
    const sourceAccount = sourcePublicKey(signer, cliOptions);
    const { realmId, salt } = createFixtureEntropy();
    const asset = fixtureAssetDescriptor(parsed.asset);
    const assetContractId = stellar([
      'contract', 'id', 'asset', '--asset', asset.cliAsset, '--network', 'testnet',
    ], cliOptions);
    if (!StrKey.isValidContract(assetContractId)) {
      throw new Error('Stellar CLI returned an invalid asset SAC ID.');
    }
    const expectedAssetContractId = sdkAssetContractId(asset);
    if (assetContractId !== expectedAssetContractId) {
      throw new Error('Stellar CLI and JavaScript SDK derived different asset SAC IDs.');
    }
    const predictedPoolContractId = stellar([
      'contract', 'id', 'wasm',
      '--source-account', sourceAccount,
      '--salt', salt,
      '--network', 'testnet',
    ], cliOptions);
    if (!StrKey.isValidContract(predictedPoolContractId)) {
      throw new Error('Stellar CLI returned an invalid predicted pool contract ID.');
    }
    const constructorArguments = buildConstructorArguments({
      realmId,
      poolContractId: predictedPoolContractId,
      guardianAddress: sourceAccount,
    });
    const bindingIndex = constructorArguments.indexOf('--deployment_binding_hash');
    const deploymentBindingHash = constructorArguments[bindingIndex + 1];
    const { path: wasmPath, sha256: wasmSha256 } = loadDeploymentWasm();
    const actualPoolContractId = stellar([
      'contract', 'deploy',
      '--wasm', wasmPath,
      '--optimize=false',
      '--source-account', signer,
      '--salt', salt,
      '--network', 'testnet',
      '--',
      ...constructorArguments,
    ], cliOptions);
    if (actualPoolContractId !== predictedPoolContractId) {
      throw new Error('Deployed pool ID does not match the precomputed deployment binding.');
    }
    const [config, archiveMeta, treeState, depositsPaused] = [
      ['config'],
      ['archive_meta'],
      ['tree_state'],
      ['deposits_paused'],
    ].map(contractArguments => parseJsonOutput(stellar([
      'contract', 'invoke',
      '--id', actualPoolContractId,
      '--source-account', sourceAccount,
      '--network', 'testnet',
      '--send', 'no',
      '--',
      ...contractArguments,
    ], cliOptions), contractArguments[0]));

    const manifest = createFixtureManifest({
      poolContractId: actualPoolContractId,
      guardianAddress: sourceAccount,
      realmId,
      deploymentBindingHash,
    });
    const evidence = sanitizeFixtureEvidence({
      schemaVersion: 1,
      fixtureOnly: true,
      createdAt: new Date().toISOString(),
      networkPassphrase: TESTNET_PASSPHRASE,
      sourceAccount,
      asset,
      poolContractId: actualPoolContractId,
      assetContractId,
      realmId,
      salt,
      deploymentBindingHash,
      wasmSha256,
      config,
      archiveMeta,
      treeState,
      depositsPaused,
      manifest,
    });
    const outputPath = safeOutputPath(parsed.output, actualPoolContractId);
    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
    return { ...evidence, outputPath: path.relative(PROJECT_ROOT, outputPath) };
  } finally {
    if (configDirectory) rmSync(configDirectory, { recursive: true, force: true });
  }
}

function dryRunPlan(parsed) {
  const { realmId, salt } = createFixtureEntropy();
  const asset = fixtureAssetDescriptor(parsed.asset);
  return {
    schemaVersion: 1,
    mode: 'plan',
    liveMutation: false,
    networkPassphrase: TESTNET_PASSPHRASE,
    networkId: TESTNET_NETWORK_ID,
    asset,
    assetContractId: sdkAssetContractId(asset),
    realmId,
    salt,
    requiredConsent: 'PRIVATE_BALANCE_TESTNET_DEPLOY=1 plus --deploy and either --ephemeral or --source',
    evidenceDirectory: 'protocol/private-balance/results/fixtures/',
  };
}

export function runFixture(argv = process.argv.slice(2), environment = process.env) {
  const parsed = parseFixtureArguments(argv, environment);
  return parsed.deploy ? deployFixture(parsed) : dryRunPlan(parsed);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  const result = runFixture();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
