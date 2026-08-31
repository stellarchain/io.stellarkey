import { loadExpectedPrivateBalanceManifest, type PrivateBalanceManifest } from './private-balance-manifest';
import { EXPECTED_PRIVATE_BALANCE_CATALOGUE_SHA256 } from './private-balance-expected-catalogue';

export type PrivateBalanceNetwork = 'testnet' | 'mainnet';

export interface PrivateBalanceAsset {
  kind: 'native' | 'stellar';
  code: string;
  issuer: string | null;
  name: string;
  decimals: number;
  displayDecimals: number;
  contractId: string;
}

export interface PrivateBalanceCatalogueDeployment {
  id: string;
  network: PrivateBalanceNetwork;
  assets: PrivateBalanceAsset[];
  manifestUrl: string;
  manifestSha256: string;
}

export interface PrivateBalanceCatalogue {
  schemaVersion: 1;
  deployments: PrivateBalanceCatalogueDeployment[];
}

export interface LoadedPrivateBalanceDeployment {
  /** Asset-option ID; the underlying pool deployment is `poolDeploymentId`. */
  id: string;
  poolDeploymentId: string;
  network: PrivateBalanceNetwork;
  asset: PrivateBalanceAsset;
  manifestUrl: string;
  manifestSha256: string;
  manifest: PrivateBalanceManifest;
  manifestHash: string;
}

const HEX_32 = /^[0-9a-f]{64}$/;
const CONTRACT_ADDRESS = /^C[A-Z2-7]{55}$/;
const ACCOUNT_ADDRESS = /^G[A-Z2-7]{55}$/;
const ASSET_CODE = /^[A-Z0-9]{1,12}$/;
const DEPLOYMENT_ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const MAX_CATALOGUE_BYTES = 64 * 1024;
const MAX_DEPLOYMENTS = 32;

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${name} is invalid.`);
  return value;
}

function integer(value: unknown, name: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) {
    throw new Error(`${name} is invalid.`);
  }
  return value as number;
}

function safeManifestUrl(value: unknown): string {
  const url = string(value, 'manifestUrl');
  if (!url.startsWith('/') || url.startsWith('//') || url.includes('\\')) {
    throw new Error('manifestUrl must be a same-origin absolute path.');
  }
  let parsed: URL;
  try {
    parsed = new URL(url, 'https://stellarkey.local');
  } catch {
    throw new Error('manifestUrl is invalid.');
  }
  if (parsed.origin !== 'https://stellarkey.local' || parsed.search || parsed.hash || !parsed.pathname.endsWith('.json')) {
    throw new Error('manifestUrl must be a same-origin JSON path without query or fragment.');
  }
  return parsed.pathname;
}

function validateAsset(value: unknown, deploymentIndex: number, assetIndex: number): PrivateBalanceAsset {
  const path = `deployments[${deploymentIndex}].assets[${assetIndex}]`;
  const asset = object(value, path);
  if (asset.kind !== 'native' && asset.kind !== 'stellar') {
    throw new Error(`${path}.kind is invalid.`);
  }
  const code = string(asset.code, `${path}.code`);
  if (!ASSET_CODE.test(code)) throw new Error(`${path}.code is invalid.`);
  const name = string(asset.name, `${path}.name`);
  if (name !== name.trim() || name.length > 64 || /[\u0000-\u001f\u007f]/u.test(name)) {
    throw new Error(`${path}.name is invalid.`);
  }
  const contractId = string(asset.contractId, `${path}.contractId`);
  if (!CONTRACT_ADDRESS.test(contractId)) {
    throw new Error(`${path}.contractId is invalid.`);
  }
  const decimals = integer(asset.decimals, `${path}.decimals`, 18);
  const displayDecimals = integer(
    asset.displayDecimals,
    `${path}.displayDecimals`,
    decimals,
  );
  let issuer: string | null;
  if (asset.kind === 'native') {
    if (code !== 'XLM' || asset.issuer !== null || decimals !== 7) {
      throw new Error(`${path} native code, issuer, or decimals are invalid.`);
    }
    issuer = null;
  } else {
    issuer = string(asset.issuer, `${path}.issuer`);
    if (!ACCOUNT_ADDRESS.test(issuer) || decimals !== 7) {
      throw new Error(`${path} issuer or decimals are invalid.`);
    }
  }
  return { kind: asset.kind, code, issuer, name, decimals, displayDecimals, contractId };
}

export function privateBalanceAssetKey(
  asset: Pick<PrivateBalanceAsset, 'kind' | 'code' | 'issuer'>,
): string {
  return asset.kind === 'native' ? 'native' : `${asset.code}:${asset.issuer ?? ''}`;
}

export function validatePrivateBalanceCatalogue(raw: unknown): PrivateBalanceCatalogue {
  const value = object(raw, 'Private Balance catalogue');
  if (value.schemaVersion !== 1) throw new Error('Unsupported Private Balance catalogue schemaVersion.');
  if (!Array.isArray(value.deployments) || value.deployments.length === 0 || value.deployments.length > MAX_DEPLOYMENTS) {
    throw new Error('Private Balance catalogue deployments are invalid.');
  }
  const ids = new Set<string>();
  const assets = new Set<string>();
  const contractIds = new Set<string>();
  const deployments = value.deployments.map((candidate, index) => {
    const deployment = object(candidate, `deployments[${index}]`);
    const id = string(deployment.id, `deployments[${index}].id`);
    if (!DEPLOYMENT_ID.test(id)) throw new Error(`deployments[${index}].id is invalid.`);
    if (ids.has(id)) throw new Error(`Private Balance catalogue contains duplicate deployment ID ${id}.`);
    ids.add(id);
    if (deployment.network !== 'testnet' && deployment.network !== 'mainnet') {
      throw new Error(`deployments[${index}].network is invalid.`);
    }
    const network: PrivateBalanceNetwork = deployment.network;
    if (!Array.isArray(deployment.assets) || deployment.assets.length === 0 || deployment.assets.length > 32) {
      throw new Error(`deployments[${index}].assets is invalid.`);
    }
    const approvedAssets = deployment.assets.map((candidate, assetIndex) => {
      const asset = validateAsset(candidate, index, assetIndex);
      const assetKey = `${network}:${privateBalanceAssetKey(asset)}`;
      if (assets.has(assetKey)) throw new Error(`Private Balance catalogue contains duplicate asset ${assetKey}.`);
      assets.add(assetKey);
      const contractKey = `${network}:${asset.contractId}`;
      if (contractIds.has(contractKey)) {
        throw new Error(`Private Balance catalogue contains duplicate asset contract ${asset.contractId}.`);
      }
      contractIds.add(contractKey);
      return asset;
    });
    const manifestSha256 = string(deployment.manifestSha256, `deployments[${index}].manifestSha256`).toLowerCase();
    if (!HEX_32.test(manifestSha256)) {
      throw new Error(`deployments[${index}].manifestSha256 is invalid.`);
    }
    return {
      id,
      network,
      assets: approvedAssets,
      manifestUrl: safeManifestUrl(deployment.manifestUrl),
      manifestSha256,
    };
  });
  return { schemaVersion: 1, deployments };
}

async function readBoundedCatalogue(response: Response): Promise<ArrayBuffer> {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0 || length > MAX_CATALOGUE_BYTES) {
      throw new Error(`Private Balance catalogue size exceeds ${MAX_CATALOGUE_BYTES} bytes.`);
    }
  }
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_CATALOGUE_BYTES) {
      throw new Error(`Private Balance catalogue size exceeds ${MAX_CATALOGUE_BYTES} bytes.`);
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
    if (total > MAX_CATALOGUE_BYTES) {
      await reader.cancel();
      throw new Error(`Private Balance catalogue size exceeds ${MAX_CATALOGUE_BYTES} bytes.`);
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
  if (!globalThis.crypto?.subtle) throw new Error('Private Balance catalogue verification requires Web Crypto.');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function loadExpectedPrivateBalanceCatalogue(options: {
  url?: string;
  fetchImpl?: typeof fetch;
  expectedHash?: string;
} = {}): Promise<{ catalogue: PrivateBalanceCatalogue; catalogueHash: string }> {
  const expectedHash = options.expectedHash ?? EXPECTED_PRIVATE_BALANCE_CATALOGUE_SHA256;
  if (!HEX_32.test(expectedHash)) throw new Error('Expected Private Balance catalogue hash is invalid.');
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('Private Balance catalogue fetch is unavailable.');
  const response = await fetchImpl(options.url ?? '/protocol/private-balance/v1/catalogue.json', {
    cache: 'no-store',
    credentials: 'same-origin',
  });
  if (!response.ok) throw new Error(`Private Balance catalogue request failed with HTTP ${response.status}.`);
  const buffer = await readBoundedCatalogue(response);
  const catalogueHash = await sha256Hex(buffer);
  if (catalogueHash !== expectedHash) throw new Error('Private Balance catalogue hash mismatch.');
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer));
  } catch {
    throw new Error('Private Balance catalogue is not valid UTF-8 JSON.');
  }
  return { catalogue: validatePrivateBalanceCatalogue(raw), catalogueHash };
}

export async function loadPrivateBalanceDeployments(input: {
  catalogue: PrivateBalanceCatalogue;
  network: PrivateBalanceNetwork;
  fetchImpl?: typeof fetch;
}): Promise<LoadedPrivateBalanceDeployment[]> {
  const catalogue = validatePrivateBalanceCatalogue(input.catalogue);
  const selected = catalogue.deployments.filter(deployment => deployment.network === input.network);
  const pools = await Promise.all(selected.map(async deployment => {
    const loaded = await loadExpectedPrivateBalanceManifest({
      url: deployment.manifestUrl,
      expectedHash: deployment.manifestSha256,
      fetchImpl: input.fetchImpl,
    });
    const expectedPassphrase = deployment.network === 'mainnet'
      ? 'Public Global Stellar Network ; September 2015'
      : 'Test SDF Network ; September 2015';
    if (loaded.manifest.networkPassphrase !== expectedPassphrase) {
      throw new Error(`Private Balance deployment ${deployment.id} network does not match its manifest.`);
    }
    return { deployment, loaded };
  }));
  return pools.flatMap(({ deployment, loaded }) => deployment.assets.map(asset => ({
    id: `${deployment.id}:${privateBalanceAssetKey(asset)}`,
    poolDeploymentId: deployment.id,
    network: deployment.network,
    asset,
    manifestUrl: deployment.manifestUrl,
    manifestSha256: deployment.manifestSha256,
    manifest: loaded.manifest,
    manifestHash: loaded.manifestHash,
  })));
}

export { EXPECTED_PRIVATE_BALANCE_CATALOGUE_SHA256 } from './private-balance-expected-catalogue';
