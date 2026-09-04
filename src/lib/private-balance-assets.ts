import {
  loadExpectedPrivateBalanceManifest,
  type PrivateBalanceManifest,
  type PrivateBalanceManifestAsset,
} from './private-balance-manifest';
import { EXPECTED_PRIVATE_BALANCE_CATALOGUE_SHA256 } from './private-balance-expected-catalogue';
import { Asset } from '@stellar/stellar-sdk';
import type {
  PrivateAssetRegistryState,
  PrivateAssetRegistryStatus,
} from '@/features/private-balance/runtime/archive-client';

export type PrivateBalanceNetwork = 'testnet' | 'mainnet';
export interface PrivateBalanceAsset extends Omit<PrivateBalanceManifestAsset, 'kind'> {
  kind: PrivateBalanceManifestAsset['kind'] | 'contract';
  /** Authoritative current state read from the pool contract. */
  status: PrivateAssetRegistryStatus;
}

export interface PrivateBalanceTokenMetadata {
  name: string;
  symbol: string;
  decimals: number;
}

export interface PrivateBalanceCatalogueDeployment {
  id: string;
  network: PrivateBalanceNetwork;
  manifestUrl: string;
  manifestSha256: string;
}

export interface PrivateBalanceCatalogue {
  schemaVersion: 1;
  deployments: PrivateBalanceCatalogueDeployment[];
}

export interface LoadedPrivateBalanceDeployment {
  /** Selection identity for one asset in the shared pool. */
  id: string;
  /** Stable identity shared by every admitted asset in this pool. */
  poolDeploymentId: string;
  network: PrivateBalanceNetwork;
  asset: PrivateBalanceAsset;
  manifestUrl: string;
  manifestSha256: string;
  manifest: PrivateBalanceManifest;
  manifestHash: string;
  /** Current on-chain administrator, corroborated across both RPC views. */
  assetAdminAddress: string;
}

const HEX_32 = /^[0-9a-f]{64}$/;
const DEPLOYMENT_ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const MAX_CATALOGUE_BYTES = 64 * 1024;
const MAX_DEPLOYMENTS = 8;

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

function safeManifestUrl(value: unknown): string {
  const url = string(value, 'manifestUrl');
  if (!url.startsWith('/') || url.startsWith('//') || url.includes('\\')) {
    throw new Error('manifestUrl must be a same-origin absolute path.');
  }
  const parsed = new URL(url, 'https://stellarkey.local');
  if (
    parsed.origin !== 'https://stellarkey.local'
    || parsed.search
    || parsed.hash
    || !parsed.pathname.endsWith('.json')
  ) {
    throw new Error('manifestUrl must be a same-origin JSON path without query or fragment.');
  }
  return parsed.pathname;
}

export function privateBalanceAssetKey(
  asset: Pick<PrivateBalanceAsset, 'kind' | 'code' | 'issuer' | 'contractId'>,
): string {
  return asset.kind === 'native'
    ? 'native'
    : asset.kind === 'contract'
      ? `contract:${asset.contractId}`
      : `${asset.code}:${asset.issuer ?? ''}`;
}

export function privateBalanceAssetMatchesPublicBalance(
  asset: Pick<PrivateBalanceAsset, 'contractId'>,
  balance: { isNative: boolean; code: string; issuer: string | null },
  networkPassphrase: string,
): boolean {
  try {
    const publicAsset = balance.isNative
      ? Asset.native()
      : new Asset(balance.code, balance.issuer ?? undefined);
    return publicAsset.contractId(networkPassphrase) === asset.contractId;
  } catch {
    return false;
  }
}

function safeRuntimeTokenText(value: string, fallback: string, maximum: number): string {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maximum && !/[\u0000-\u001f\u007f]/u.test(trimmed)
    ? trimmed
    : fallback;
}

/**
 * Treats the append-only contract registry as admission authority. The signed
 * manifest can label its checkpointed prefix, but cannot add, delete, reorder,
 * or reactivate an entry.
 */
export function reconcilePrivateBalanceRegistry(input: {
  deployments: LoadedPrivateBalanceDeployment[];
  registry: PrivateAssetRegistryState;
  metadataByContract?: ReadonlyMap<string, PrivateBalanceTokenMetadata>;
}): LoadedPrivateBalanceDeployment[] {
  if (input.deployments.length === 0) return [];
  const template = input.deployments[0];
  if (input.deployments.some(candidate => (
    candidate.poolDeploymentId !== template.poolDeploymentId
    || candidate.manifestHash !== template.manifestHash
  ))) {
    throw new Error('Private asset registry reconciliation requires exactly one pool.');
  }
  if (input.registry.assets.length < template.manifest.registryCheckpoint.assetCount) {
    throw new Error('Private asset registry is older than its authenticated checkpoint.');
  }
  const curated = new Map(template.manifest.assets.map(asset => [asset.index, asset]));
  for (const asset of template.manifest.assets) {
    const live = input.registry.assets[asset.index];
    if (!live || live.index !== asset.index || live.contractId !== asset.contractId) {
      throw new Error(`Private asset registry changed immutable index ${asset.index}.`);
    }
  }
  return input.registry.assets.map(live => {
    const known = curated.get(live.index);
    const metadata = input.metadataByContract?.get(live.contractId);
    const fallbackCode = `A${live.index}`;
    const asset: PrivateBalanceAsset = known
      ? { ...known, status: live.status }
      : {
          index: live.index,
          kind: 'contract',
          code: safeRuntimeTokenText(metadata?.symbol ?? '', fallbackCode, 12).toUpperCase(),
          issuer: null,
          name: safeRuntimeTokenText(metadata?.name ?? '', `Contract asset ${live.index}`, 64),
          decimals: metadata?.decimals ?? 7,
          displayDecimals: Math.min(metadata?.decimals ?? 7, 7),
          contractId: live.contractId,
          status: live.status,
        };
    return {
      ...template,
      id: `${template.poolDeploymentId}:${live.index}`,
      asset,
      assetAdminAddress: input.registry.adminAddress,
    };
  });
}

export function validatePrivateBalanceCatalogue(raw: unknown): PrivateBalanceCatalogue {
  const value = object(raw, 'Private Balance catalogue');
  if (value.schemaVersion !== 1) throw new Error('Unsupported Private Balance catalogue schemaVersion.');
  if (!Array.isArray(value.deployments) || value.deployments.length > MAX_DEPLOYMENTS) {
    throw new Error('Private Balance catalogue deployments are invalid.');
  }
  const ids = new Set<string>();
  const networks = new Set<PrivateBalanceNetwork>();
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
    if (networks.has(network)) {
      throw new Error(`Private Balance catalogue contains more than one ${network} pool.`);
    }
    networks.add(network);
    const manifestSha256 = string(
      deployment.manifestSha256,
      `deployments[${index}].manifestSha256`,
    ).toLowerCase();
    if (!HEX_32.test(manifestSha256)) {
      throw new Error(`deployments[${index}].manifestSha256 is invalid.`);
    }
    if ('asset' in deployment || 'assets' in deployment || 'assetAdminAddress' in deployment) {
      throw new Error('The catalogue cannot claim asset admission authority.');
    }
    return {
      id,
      network,
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
  return pools.flatMap(({ deployment, loaded }) => loaded.manifest.assets.map(asset => ({
    id: `${deployment.id}:${asset.index}`,
    poolDeploymentId: deployment.id,
    network: deployment.network,
    asset: { ...asset, status: 'active' as const },
    manifestUrl: deployment.manifestUrl,
    manifestSha256: deployment.manifestSha256,
    manifest: loaded.manifest,
    manifestHash: loaded.manifestHash,
    assetAdminAddress: loaded.manifest.assetAdminAddress,
  })));
}

export { EXPECTED_PRIVATE_BALANCE_CATALOGUE_SHA256 } from './private-balance-expected-catalogue';
