export interface PrivateBalanceArtifacts {
  r1csSha256: string;
  r1csConstraints: number;
  wasmSha256: string;
  wasmByteLength: number;
  zkeySha256: string;
  zkeyByteLength: number;
  /** Optional transport; expansion still yields the exact hash-pinned zkey above. */
  zkeyTransport?: {
    encoding: 'points-compressed';
    sha256: string;
    byteLength: number;
    /** Measured Brotli-11 transfer size used for honest setup/download copy. */
    wireByteLength: number;
  };
  vkJsonSha256: string;
  vkBinSha256: string;
}

export interface PrivateBalanceConstants {
  treeDepth: number;
  treeArity: number;
  rootWindowLedgers: number;
  publicInputs: number;
  notePlaintextBytes: number;
  recipientEnvelopeBytes: number;
  outgoingEnvelopeBytes: number;
  outputPackageBytes: number;
  outputsPerAction: number;
  addressPayloadBytes: number;
  addressAsciiBytes: number;
  addressContextTagBytes: number;
  addressChecksumBytes: number;
}

export interface PrivateBalanceHpke {
  kemId: string;
  kdfId: string;
  aeadId: string;
}

export interface PrivateBalanceReleaseProvenance {
  contractWasmSha256: string;
  contractSourceCommit: string;
  circuitSourceSha256: string;
  poseidonParametersSha256: string;
  hpkePackageVersion: string;
  hpkeDependencyIntegritySha256: string;
  toolchainLockSha256: string;
  powersOfTauSha256: string;
  zkeyVerified: boolean;
  ceremonyTranscriptRoot: string;
  auditReports: Array<{ url: string; sha256: string }>;
  deploymentTransactions: Array<{ kind: string; hash: string; ledger: number }>;
  allowedEnvironment: 'testnet';
}

export interface PrivateBalanceDeploymentCheckpoint {
  ledger: number;
  hash: string;
}

export interface PrivateBalanceRegistryCheckpoint extends PrivateBalanceDeploymentCheckpoint {
  assetCount: number;
}

export interface PrivateBalanceManifestAsset {
  index: number;
  kind: 'native' | 'stellar';
  code: string;
  issuer: string | null;
  name: string;
  decimals: number;
  displayDecimals: number;
  contractId: string;
}

export interface PrivateBalanceManifest {
  schemaVersion: number;
  protocolVersion: number;
  artifactVersion: string;
  status: 'development' | 'testnet-preview' | 'testnet-beta' | 'production';
  minimumStellarProtocol: number;
  networkPassphrase: string;
  networkId: string;
  realmId: string;
  poolContractId: string;
  guardianAddress: string;
  assetAdminAddress: string;
  /** Curated labels for immutable on-chain indices; registry state remains authoritative. */
  assets: PrivateBalanceManifestAsset[];
  /** Public classic-account sink used to index backend-free stealth announcements. */
  stealthAnnouncerAddress: string;
  /** Independently operated read-only RPC used to corroborate recovery checkpoints. */
  witnessRpcUrl: string;
  deploymentCheckpoint: PrivateBalanceDeploymentCheckpoint;
  registryCheckpoint: PrivateBalanceRegistryCheckpoint;
  deploymentBindingHash: string;
  artifacts: PrivateBalanceArtifacts;
  constants: PrivateBalanceConstants;
  hpke: PrivateBalanceHpke;
  release?: PrivateBalanceReleaseProvenance;
  mirrorBaseUrl?: string; // Optional read-only archive mirror; defaults off
}

export type PrivateBalanceAvailability =
  | { ready: true }
  | { ready: false; reason: string };

export interface PrivateBalanceAvailabilityOptions {
  allowDevelopmentFixture?: boolean;
}

const HEX_32 = /^[0-9a-f]{64}$/;
const CONTRACT_ADDRESS = /^C[A-Z2-7]{55}$/;
const ACCOUNT_ADDRESS = /^G[A-Z2-7]{55}$/;
const ASSET_CODE = /^[A-Z0-9]{1,12}$/;
const EXPECTED_CONSTANTS: PrivateBalanceConstants = {
  treeDepth: 17,
  treeArity: 3,
  rootWindowLedgers: 1440,
  publicInputs: 11,
  notePlaintextBytes: 128,
  recipientEnvelopeBytes: 181,
  outgoingEnvelopeBytes: 157,
  outputPackageBytes: 370,
  outputsPerAction: 3,
  addressPayloadBytes: 84,
  addressAsciiBytes: 128,
  addressContextTagBytes: 16,
  addressChecksumBytes: 4,
};
const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';
const DEVELOPMENT_POOL_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAITA4';
const DEVELOPMENT_GUARDIAN = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const MAX_MANIFEST_BYTES = 64 * 1024;

export interface LoadPrivateBalanceManifestOptions {
  url?: string;
  fetchImpl?: typeof fetch;
  expectedHash?: string;
}

async function readBoundedManifest(response: Response): Promise<ArrayBuffer> {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0 || length > MAX_MANIFEST_BYTES) {
      throw new Error(`Private Balance manifest size exceeds ${MAX_MANIFEST_BYTES} bytes.`);
    }
  }
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_MANIFEST_BYTES) {
      throw new Error(`Private Balance manifest size exceeds ${MAX_MANIFEST_BYTES} bytes.`);
    }
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_MANIFEST_BYTES) {
      await reader.cancel();
      throw new Error(`Private Balance manifest size exceeds ${MAX_MANIFEST_BYTES} bytes.`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Private Balance manifest verification requires Web Crypto.');
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function loadExpectedPrivateBalanceManifest(
  options: LoadPrivateBalanceManifestOptions = {},
): Promise<{ manifest: PrivateBalanceManifest; manifestHash: string }> {
  const url = options.url ?? '/protocol/private-balance/v1/manifest.json';
  const expectedHash = options.expectedHash ?? EXPECTED_PRIVATE_BALANCE_MANIFEST_SHA256;
  if (!HEX_32.test(expectedHash)) {
    throw new Error('Expected Private Balance manifest hash is invalid.');
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('Private Balance manifest fetch is unavailable.');
  }
  const response = await fetchImpl(url, {
    cache: 'no-store',
    credentials: 'same-origin',
  });
  if (!response.ok) {
    throw new Error(`Private Balance manifest request failed with HTTP ${response.status}.`);
  }
  const buffer = await readBoundedManifest(response);
  const manifestHash = await sha256Hex(buffer);
  if (manifestHash !== expectedHash) {
    throw new Error('Private Balance manifest hash mismatch.');
  }

  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer));
  } catch {
    throw new Error('Private Balance manifest is not valid UTF-8 JSON.');
  }
  return { manifest: validateManifest(raw), manifestHash };
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(name === 'Manifest' ? 'Manifest must be a non-null object' : `${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${name} is invalid`);
  return value;
}

function integer(value: unknown, name: string, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) {
    throw new Error(`${name} is invalid`);
  }
  return value as number;
}

function boolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${name} is invalid`);
  return value;
}

function hex32(value: unknown, name: string): string {
  const parsed = string(value, name).toLowerCase();
  if (!HEX_32.test(parsed)) throw new Error(`${name} must be 32-byte lowercase hex`);
  return parsed;
}

function canonicalHex32(value: unknown, name: string): string {
  const parsed = string(value, name);
  if (!HEX_32.test(parsed)) throw new Error(`${name} must be 32-byte lowercase hex`);
  return parsed;
}

function rpcUrl(value: unknown, name: string): string {
  const source = string(value, name);
  let parsed: URL;
  try {
    parsed = new URL(source);
  } catch {
    throw new Error(`${name} is invalid`);
  }
  const loopback = parsed.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !loopback) {
    throw new Error(`${name} requires HTTPS or a loopback development endpoint`);
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${name} must not contain credentials, query, or fragment`);
  }
  if (parsed.href.length > 2_048) throw new Error(`${name} is too long`);
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed.toString().replace(/\/$/, '');
}

function manifestAsset(value: unknown, expectedIndex: number): PrivateBalanceManifestAsset {
  const path = `assets[${expectedIndex}]`;
  const asset = record(value, path);
  if (asset.index !== expectedIndex) throw new Error(`${path}.index must be contiguous and immutable`);
  if (asset.kind !== 'native' && asset.kind !== 'stellar') throw new Error(`${path}.kind is invalid`);
  const code = string(asset.code, `${path}.code`);
  if (!ASSET_CODE.test(code)) throw new Error(`${path}.code is invalid`);
  const name = string(asset.name, `${path}.name`);
  if (name !== name.trim() || name.length > 64 || /[\u0000-\u001f\u007f]/u.test(name)) {
    throw new Error(`${path}.name is invalid`);
  }
  const contractId = string(asset.contractId, `${path}.contractId`);
  if (!CONTRACT_ADDRESS.test(contractId)) throw new Error(`${path}.contractId is invalid`);
  const decimals = integer(asset.decimals, `${path}.decimals`, 18);
  const displayDecimals = integer(asset.displayDecimals, `${path}.displayDecimals`, decimals);
  let issuer: string | null;
  if (asset.kind === 'native') {
    if (code !== 'XLM' || asset.issuer !== null || decimals !== 7) {
      throw new Error(`${path} native code, issuer, or decimals are invalid`);
    }
    issuer = null;
  } else {
    issuer = string(asset.issuer, `${path}.issuer`);
    if (!ACCOUNT_ADDRESS.test(issuer) || decimals !== 7) {
      throw new Error(`${path} issuer or decimals are invalid`);
    }
  }
  return {
    index: expectedIndex,
    kind: asset.kind,
    code,
    issuer,
    name,
    decimals,
    displayDecimals,
    contractId,
  };
}

export function validateManifest(raw: unknown): PrivateBalanceManifest {
  const obj = record(raw, 'Manifest');

  if (obj.schemaVersion !== 1) {
    throw new Error(`Unsupported schemaVersion: ${String(obj.schemaVersion)}`);
  }
  if (obj.protocolVersion !== 1) {
    throw new Error(`Unsupported protocolVersion: ${String(obj.protocolVersion)}`);
  }
  if (
    typeof obj.status !== 'string' ||
    !['development', 'testnet-preview', 'testnet-beta', 'production'].includes(obj.status)
  ) {
    throw new Error(`Invalid manifest status: ${String(obj.status)}`);
  }
  const networkPassphrase = string(obj.networkPassphrase, 'networkPassphrase');
  if (networkPassphrase !== TESTNET_PASSPHRASE) {
    throw new Error('Private Payments are available on Stellar testnet only.');
  }
  const poolContractId = string(obj.poolContractId, 'poolContractId');
  const guardianAddress = string(obj.guardianAddress, 'guardianAddress');
  const assetAdminAddress = string(obj.assetAdminAddress, 'assetAdminAddress');
  const stealthAnnouncerAddress = string(
    obj.stealthAnnouncerAddress,
    'stealthAnnouncerAddress',
  );
  const witnessRpcUrl = rpcUrl(obj.witnessRpcUrl, 'witnessRpcUrl');
  const deploymentCheckpoint = record(
    obj.deploymentCheckpoint,
    'deploymentCheckpoint',
  );
  const registryCheckpoint = record(obj.registryCheckpoint, 'registryCheckpoint');
  if (!Array.isArray(obj.assets) || obj.assets.length > 256) {
    throw new Error('assets must be a bounded array');
  }
  const assets = obj.assets.map(manifestAsset);
  const assetContracts = new Set(assets.map(asset => asset.contractId));
  if (assetContracts.size !== assets.length) throw new Error('assets contain a duplicate contractId');
  if (!CONTRACT_ADDRESS.test(poolContractId)) throw new Error('poolContractId is invalid');
  if (!ACCOUNT_ADDRESS.test(guardianAddress) && !CONTRACT_ADDRESS.test(guardianAddress)) {
    throw new Error('guardianAddress is invalid');
  }
  if (!ACCOUNT_ADDRESS.test(assetAdminAddress) && !CONTRACT_ADDRESS.test(assetAdminAddress)) {
    throw new Error('assetAdminAddress is invalid');
  }
  if (!ACCOUNT_ADDRESS.test(stealthAnnouncerAddress)) {
    throw new Error('stealthAnnouncerAddress is invalid');
  }

  const artifacts = record(obj.artifacts, 'artifacts');
  const constants = record(obj.constants, 'constants');
  const hpke = record(obj.hpke, 'hpke');
  const parsedConstants = Object.fromEntries(
    Object.entries(EXPECTED_CONSTANTS).map(([name, expected]) => {
      const actual = constants[name] === undefined && obj.status === 'development'
        ? expected
        : integer(constants[name], `constants.${name}`);
      if (actual !== expected) throw new Error(`constants.${name} must equal ${expected}`);
      return [name, actual];
    }),
  ) as unknown as PrivateBalanceConstants;

  const wasmByteLength = integer(artifacts.wasmByteLength, 'artifacts.wasmByteLength', 4 * 1024 * 1024);
  const zkeyByteLength = integer(artifacts.zkeyByteLength, 'artifacts.zkeyByteLength', 64 * 1024 * 1024);
  if (wasmByteLength === 0 || zkeyByteLength === 0) throw new Error('Artifact sizes must be nonzero');
  let zkeyTransport: PrivateBalanceArtifacts['zkeyTransport'];
  if (artifacts.zkeyTransport !== undefined) {
    const transport = record(artifacts.zkeyTransport, 'artifacts.zkeyTransport');
    if (transport.encoding !== 'points-compressed') {
      throw new Error('artifacts.zkeyTransport.encoding must equal points-compressed');
    }
    const byteLength = integer(
      transport.byteLength,
      'artifacts.zkeyTransport.byteLength',
      64 * 1024 * 1024,
    );
    if (byteLength === 0 || byteLength >= zkeyByteLength) {
      throw new Error('artifacts.zkeyTransport must be nonzero and smaller than the raw zkey');
    }
    const wireByteLength = integer(
      transport.wireByteLength,
      'artifacts.zkeyTransport.wireByteLength',
      64 * 1024 * 1024,
    );
    if (wireByteLength === 0 || wireByteLength > byteLength) {
      throw new Error('artifacts.zkeyTransport.wireByteLength must fit the transport');
    }
    zkeyTransport = {
      encoding: 'points-compressed',
      sha256: hex32(transport.sha256, 'artifacts.zkeyTransport.sha256'),
      byteLength,
      wireByteLength,
    };
  }

  const parsed: PrivateBalanceManifest = {
    schemaVersion: 1,
    protocolVersion: 1,
    artifactVersion: string(obj.artifactVersion, 'artifactVersion'),
    status: obj.status as PrivateBalanceManifest['status'],
    minimumStellarProtocol: integer(obj.minimumStellarProtocol, 'minimumStellarProtocol'),
    networkPassphrase,
    networkId: hex32(obj.networkId, 'networkId'),
    realmId: hex32(obj.realmId, 'realmId'),
    poolContractId,
    guardianAddress,
    assetAdminAddress,
    assets,
    stealthAnnouncerAddress,
    witnessRpcUrl,
    deploymentCheckpoint: {
      ledger: integer(deploymentCheckpoint.ledger, 'deploymentCheckpoint.ledger', 0xffff_ffff),
      hash: canonicalHex32(deploymentCheckpoint.hash, 'deploymentCheckpoint.hash'),
    },
    registryCheckpoint: {
      ledger: integer(registryCheckpoint.ledger, 'registryCheckpoint.ledger', 0xffff_ffff),
      hash: canonicalHex32(registryCheckpoint.hash, 'registryCheckpoint.hash'),
      assetCount: integer(registryCheckpoint.assetCount, 'registryCheckpoint.assetCount', 256),
    },
    deploymentBindingHash: hex32(obj.deploymentBindingHash, 'deploymentBindingHash'),
    artifacts: {
      r1csSha256: hex32(artifacts.r1csSha256, 'artifacts.r1csSha256'),
      r1csConstraints: integer(artifacts.r1csConstraints, 'artifacts.r1csConstraints'),
      wasmSha256: hex32(artifacts.wasmSha256, 'artifacts.wasmSha256'),
      wasmByteLength,
      zkeySha256: hex32(artifacts.zkeySha256, 'artifacts.zkeySha256'),
      zkeyByteLength,
      ...(zkeyTransport ? { zkeyTransport } : {}),
      vkJsonSha256: hex32(artifacts.vkJsonSha256, 'artifacts.vkJsonSha256'),
      vkBinSha256: hex32(artifacts.vkBinSha256, 'artifacts.vkBinSha256'),
    },
    constants: parsedConstants,
    hpke: {
      kemId: string(hpke.kemId, 'hpke.kemId'),
      kdfId: string(hpke.kdfId, 'hpke.kdfId'),
      aeadId: string(hpke.aeadId, 'hpke.aeadId'),
    },
  };
  if (parsed.registryCheckpoint.assetCount !== parsed.assets.length) {
    throw new Error('registryCheckpoint.assetCount must match curated assets');
  }
  if (
    parsed.status !== 'development' &&
    (parsed.deploymentCheckpoint.ledger === 0 || parsed.deploymentCheckpoint.hash === EMPTY_SHA256)
  ) {
    throw new Error('deploymentCheckpoint must pin a deployed ledger for published releases');
  }
  if (obj.mirrorBaseUrl !== undefined) {
    const mirrorBaseUrl = string(obj.mirrorBaseUrl, 'mirrorBaseUrl');
    let mirror: URL;
    try {
      mirror = new URL(mirrorBaseUrl);
    } catch {
      throw new Error('mirrorBaseUrl is invalid');
    }
    const loopback = mirror.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(mirror.hostname);
    if (mirror.protocol !== 'https:' && !loopback) {
      throw new Error('mirrorBaseUrl requires HTTPS or a loopback development endpoint');
    }
    if (mirror.username || mirror.password || mirror.search || mirror.hash) {
      throw new Error('mirrorBaseUrl must not contain credentials, query, or fragment');
    }
    parsed.mirrorBaseUrl = mirrorBaseUrl;
  }
  if (obj.release !== undefined) {
    const release = record(obj.release, 'release');
    const auditReports = Array.isArray(release.auditReports)
      ? release.auditReports.map((item, index) => {
          const report = record(item, `release.auditReports[${index}]`);
          return {
            url: string(report.url, `release.auditReports[${index}].url`),
            sha256: hex32(report.sha256, `release.auditReports[${index}].sha256`),
          };
        })
      : [];
    const deploymentTransactions = Array.isArray(release.deploymentTransactions)
      ? release.deploymentTransactions.map((item, index) => {
          const transaction = record(item, `release.deploymentTransactions[${index}]`);
          return {
            kind: string(transaction.kind, `release.deploymentTransactions[${index}].kind`),
            hash: hex32(transaction.hash, `release.deploymentTransactions[${index}].hash`),
            ledger: integer(transaction.ledger, `release.deploymentTransactions[${index}].ledger`),
          };
        })
      : [];
    const contractSourceCommit = string(release.contractSourceCommit, 'release.contractSourceCommit');
    if (!/^[0-9a-f]{40}$/.test(contractSourceCommit)) {
      throw new Error('release.contractSourceCommit must be 20-byte lowercase hex');
    }
    if (release.allowedEnvironment !== 'testnet') {
      throw new Error('release.allowedEnvironment must be testnet');
    }
    parsed.release = {
      contractWasmSha256: hex32(release.contractWasmSha256, 'release.contractWasmSha256'),
      contractSourceCommit,
      circuitSourceSha256: hex32(release.circuitSourceSha256, 'release.circuitSourceSha256'),
      poseidonParametersSha256: hex32(
        release.poseidonParametersSha256,
        'release.poseidonParametersSha256',
      ),
      hpkePackageVersion: string(release.hpkePackageVersion, 'release.hpkePackageVersion'),
      hpkeDependencyIntegritySha256: hex32(
        release.hpkeDependencyIntegritySha256,
        'release.hpkeDependencyIntegritySha256',
      ),
      toolchainLockSha256: hex32(release.toolchainLockSha256, 'release.toolchainLockSha256'),
      powersOfTauSha256: hex32(
        release.powersOfTauSha256,
        'release.powersOfTauSha256',
      ),
      zkeyVerified: boolean(release.zkeyVerified, 'release.zkeyVerified'),
      ceremonyTranscriptRoot: hex32(
        release.ceremonyTranscriptRoot,
        'release.ceremonyTranscriptRoot',
      ),
      auditReports,
      deploymentTransactions,
      allowedEnvironment: 'testnet',
    };
  }
  if (parsed.status !== 'development' && !parsed.release) {
    throw new Error('Release provenance is required outside development.');
  }
  if (parsed.status !== 'development') {
    if (
      !parsed.release ||
      parsed.release.zkeyVerified !== true ||
      parsed.release.ceremonyTranscriptRoot === '0'.repeat(64) ||
      parsed.release.auditReports.length === 0 ||
      parsed.release.deploymentTransactions.length === 0
    ) {
      throw new Error('Release provenance is incomplete.');
    }
  }
  if (parsed.minimumStellarProtocol < 25) {
    throw new Error('minimumStellarProtocol must be at least 25');
  }
  if (parsed.realmId === '0'.repeat(64)) throw new Error('realmId must be nonzero');
  if (parsed.hpke.kemId !== '0x0020' || parsed.hpke.kdfId !== '0x0001' || parsed.hpke.aeadId !== '0x0001') {
    throw new Error('HPKE suite does not match protocol V1');
  }
  return parsed;
}

export function privateBalanceAvailability(
  manifest: PrivateBalanceManifest,
  network: 'testnet' | 'mainnet',
  options: PrivateBalanceAvailabilityOptions = {},
): PrivateBalanceAvailability {
  if (network !== 'testnet') {
    return {
      ready: false,
      reason: 'Private Payments are available on Stellar testnet only.',
    };
  }
  const developmentFixtureAllowed =
    manifest.status === 'development' && options.allowDevelopmentFixture === true;
  if (manifest.status === 'development' && !developmentFixtureAllowed) {
    return { ready: false, reason: 'Private Balance is still using development artifacts.' };
  }
  if (manifest.networkPassphrase !== TESTNET_PASSPHRASE) {
    return { ready: false, reason: 'Private Balance is not deployed on the selected network.' };
  }
  if (
    !developmentFixtureAllowed &&
    (
      manifest.poolContractId === DEVELOPMENT_POOL_ID ||
      manifest.guardianAddress === DEVELOPMENT_GUARDIAN ||
      manifest.deploymentBindingHash === EMPTY_SHA256
    )
  ) {
    return { ready: false, reason: 'Private Balance deployment evidence is incomplete.' };
  }
  return { ready: true };
}
import { EXPECTED_PRIVATE_BALANCE_MANIFEST_SHA256 } from './private-balance-expected-manifest';

export { EXPECTED_PRIVATE_BALANCE_MANIFEST_SHA256 } from './private-balance-expected-manifest';
