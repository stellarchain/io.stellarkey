// Shared by the loader and build-time service-worker/budget generation. These
// are public, hash-pinned proving files, never wallet or transaction records.
export const PRIVATE_ARTIFACT_CACHE_PREFIX = 'stellarkey-private-artifacts-v2-';
export const LEGACY_ARTIFACT_CACHE_PREFIX = 'stellarkey-private-artifacts-';
export const LEGACY_EXPANDED_ARTIFACT_CACHE = 'stellarkey-private-balance-artifacts-v1';

export function privateArtifactEntries(manifest, basePath = '/protocol/private-balance/v1') {
  const artifacts = manifest?.artifacts;
  const transport = artifacts?.zkeyTransport;
  if (transport !== undefined && transport.encoding !== 'points-compressed') {
    throw new Error('Unsupported Private Balance artifact transport.');
  }
  const entries = [
    [`${basePath}/circuit.wasm`, artifacts?.wasmSha256],
    [transport ? `${basePath}/circuit.zkey.pc` : `${basePath}/circuit.zkey`,
      transport ? transport.sha256 : artifacts?.zkeySha256],
    [`${basePath}/verification-key.json`, artifacts?.vkJsonSha256],
  ];
  for (const [, hash] of entries) {
    if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) {
      throw new Error('Private Balance manifest contains an invalid artifact hash.');
    }
  }
  return entries;
}

export function privateArtifactRevisionSource(manifest, entries) {
  return `${String(manifest.artifactVersion ?? '')}\0${JSON.stringify(entries)}`;
}
