import { type PrivateBalanceManifest, validateManifest } from './private-balance-manifest';
import { expandPointCompressedZkeyTransport } from './private-balance-zkey-transport';
import {
  PRIVATE_ARTIFACT_CACHE_PREFIX, LEGACY_ARTIFACT_CACHE_PREFIX,
  LEGACY_EXPANDED_ARTIFACT_CACHE, privateArtifactEntries, privateArtifactRevisionSource,
} from './private-balance-artifact-policy.mjs';

export interface LoadedCircuitArtifacts {
  wasmBuffer: ArrayBuffer;
  zkeyBuffer: ArrayBuffer;
  verificationKey: Record<string, unknown>;
}

const MAX_VERIFICATION_KEY_BYTES = 1024 * 1024;

/**
 * Content-addressed artifact store: entries are keyed by their expected
 * SHA-256, and every read is re-verified against that hash before use, so a
 * poisoned cache entry can never reach the prover.
 */
export interface CircuitArtifactCache {
  read(sha256: string): Promise<ArrayBuffer | null>;
  write(sha256: string, buffer: ArrayBuffer): Promise<void>;
  complete?(): Promise<void>;
}

async function defaultArtifactCache(
  manifest: PrivateBalanceManifest, basePath: string,
): Promise<CircuitArtifactCache | null> {
  if (typeof caches === 'undefined') return null;
  try {
    const storage = caches;
    const entries = privateArtifactEntries(manifest, basePath);
    const revisionBytes = new TextEncoder().encode(privateArtifactRevisionSource(manifest, entries));
    const revision = (await computeSha256(revisionBytes.buffer)).slice(0, 20);
    const name = `${PRIVATE_ARTIFACT_CACHE_PREFIX}${revision}`;
    const cache = await storage.open(name);
    const urls = new Map<string, string>(entries.map(([url, hash]) =>
      [hash, contentAddressedArtifactUrl(url, hash)]));
    const limits = new Map([
      [manifest.artifacts.wasmSha256, manifest.artifacts.wasmByteLength],
      [manifest.artifacts.zkeyTransport?.sha256 ?? manifest.artifacts.zkeySha256,
        manifest.artifacts.zkeyTransport?.byteLength ?? manifest.artifacts.zkeyByteLength],
      [manifest.artifacts.vkJsonSha256, MAX_VERIFICATION_KEY_BYTES],
    ]);
    const written = new Set<string>();
    return {
      async read(sha256) {
        const url = urls.get(sha256);
        if (!url) return null;
        // Reuse the exact hash-keyed transport from an earlier worker/cache.
        // The caller verifies it before copying it into the current revision.
        const names = [name, ...(await storage.keys()).filter(candidate =>
          candidate !== name && (candidate.startsWith(LEGACY_ARTIFACT_CACHE_PREFIX) ||
            candidate === LEGACY_EXPANDED_ARTIFACT_CACHE)).reverse()];
        for (const candidate of names) {
          const source = candidate === name ? cache : await storage.open(candidate);
          const key = candidate === LEGACY_EXPANDED_ARTIFACT_CACHE
            ? `/private-balance-artifact/sha256/${sha256}` : url;
          const response = await source.match(key);
          if (response?.ok) return readArtifactResponse(response, url, limits.get(sha256)!);
        }
        return null;
      },
      async write(sha256, buffer) {
        const url = urls.get(sha256);
        if (!url) throw new Error('Unexpected artifact cache key.');
        await cache.put(url, new Response(buffer.slice(0), {
          headers: { 'content-type': 'application/octet-stream', 'content-length': String(buffer.byteLength) },
        }));
        written.add(sha256);
      },
      async complete() {
        // Never discard the old offline set after an incomplete or quota-failed
        // replacement. Only these disposable public-artifact namespaces qualify.
        if (written.size !== urls.size) return;
        const names = await storage.keys();
        // A retired or superseded load has no authority over newer revisions.
        if (names.filter(candidate => candidate.startsWith(PRIVATE_ARTIFACT_CACHE_PREFIX)).at(-1) !== name) return;
        const previous = names.filter(candidate =>
          candidate.startsWith(PRIVATE_ARTIFACT_CACHE_PREFIX) && candidate !== name).at(-1);
        await Promise.all(names.filter(candidate =>
          candidate === LEGACY_EXPANDED_ARTIFACT_CACHE ||
          (candidate.startsWith(LEGACY_ARTIFACT_CACHE_PREFIX) && candidate !== name && candidate !== previous)
        ).map(candidate => storage.delete(candidate)));
      },
    };
  } catch {
    return null; // Storage permissions must not block verified downloads.
  }
}

async function persistVerifiedArtifact(cache: CircuitArtifactCache | null, hash: string, buffer: ArrayBuffer) {
  try { await cache?.write(hash, buffer); } catch {
    // Cache writes are best-effort; the verified buffer is already in hand.
  }
}

async function loadCachedOrFetchArtifact(
  cache: CircuitArtifactCache | null,
  url: string,
  expectedSha256: string,
  expectedByteLength?: number,
  maximumByteLength = expectedByteLength ?? MAX_VERIFICATION_KEY_BYTES,
  persist = true,
): Promise<ArrayBuffer> {
  if (cache) {
    try {
      const cached = await cache.read(expectedSha256);
      if (cached && cached.byteLength <= maximumByteLength &&
          (expectedByteLength === undefined || cached.byteLength === expectedByteLength)) {
        const hash = await computeSha256(cached);
        if (hash.toLowerCase() === expectedSha256.toLowerCase()) {
          if (persist) await persistVerifiedArtifact(cache, expectedSha256, cached);
          return cached;
        }
      }
    } catch {
      // A defective cache never blocks the verified network path.
    }
  }
  const buffer = await fetchAndVerifyArtifact(
    url,
    expectedSha256,
    expectedByteLength,
    maximumByteLength,
  );
  if (persist) await persistVerifiedArtifact(cache, expectedSha256, buffer);
  return buffer;
}

async function loadCachedOrFetchPointCompressedArtifact(
  cache: CircuitArtifactCache | null,
  url: string,
  transportSha256: string,
  transportByteLength: number,
  expectedSha256: string,
  expectedByteLength: number,
): Promise<ArrayBuffer> {
  const transport = await loadCachedOrFetchArtifact(
    cache,
    url,
    transportSha256,
    transportByteLength,
    transportByteLength,
    false,
  );
  const buffer = await expandPointCompressedZkeyTransport(transport, expectedByteLength);
  const hash = await computeSha256(buffer);
  if (hash.toLowerCase() !== expectedSha256.toLowerCase()) {
    throw new Error(
      `Artifact hash mismatch after point expansion for ${url}: expected ${expectedSha256}, got ${hash}`,
    );
  }
  // Persist only the compressed transport, and only after its expansion also
  // matches the canonical proving-key hash. Expansion is transient prover input.
  await persistVerifiedArtifact(cache, transportSha256, transport);
  return buffer;
}

function contentAddressedArtifactUrl(url: string, expectedSha256: string): string {
  const separator = url.includes('?') ? '&' : '?';
  const query = new URLSearchParams({ sha256: expectedSha256.toLowerCase() });
  return `${url}${separator}${query.toString()}`;
}

export async function computeSha256(buffer: ArrayBuffer): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  } else {
    const { createHash } = await import('node:crypto');
    return createHash('sha256').update(new Uint8Array(buffer)).digest('hex');
  }
}

export async function fetchAndVerifyArtifact(
  url: string,
  expectedSha256: string,
  expectedByteLength?: number,
  maximumByteLength = expectedByteLength ?? MAX_VERIFICATION_KEY_BYTES,
): Promise<ArrayBuffer> {
  const res = await fetch(url, { cache: 'reload' });
  if (!res.ok) {
    throw new Error(`Failed to fetch artifact from ${url}: HTTP ${res.status}`);
  }

  const buffer = await readArtifactResponse(res, url, maximumByteLength);
  if (expectedByteLength !== undefined && buffer.byteLength !== expectedByteLength) {
    throw new Error(`Artifact size mismatch for ${url}: expected ${expectedByteLength}, got ${buffer.byteLength}`);
  }
  const hash = await computeSha256(buffer);
  if (hash.toLowerCase() !== expectedSha256.toLowerCase()) {
    throw new Error(`Artifact hash mismatch for ${url}: expected ${expectedSha256}, got ${hash}`);
  }
  return buffer;
}

async function readArtifactResponse(res: Response, url: string, maximumByteLength: number): Promise<ArrayBuffer> {
  const declaredLength = res.headers.get('content-length');
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > maximumByteLength) {
      throw new Error(`Artifact size exceeds the ${maximumByteLength}-byte limit for ${url}`);
    }
  }

  let buffer: ArrayBuffer;
  if (!res.body) {
    buffer = await res.arrayBuffer();
    if (buffer.byteLength > maximumByteLength) {
      throw new Error(`Artifact size exceeds the ${maximumByteLength}-byte limit for ${url}`);
    }
  } else {
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumByteLength) {
        await reader.cancel();
        throw new Error(`Artifact size exceeds the ${maximumByteLength}-byte limit for ${url}`);
      }
      chunks.push(value);
    }
    const combined = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    buffer = combined.buffer;
  }

  return buffer;
}

function parseVerificationKey(buffer: ArrayBuffer, expectedPublicInputs: number): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer));
  } catch {
    throw new Error('Private Balance verification key is not valid UTF-8 JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Private Balance verification key must be an object.');
  }
  const key = parsed as Record<string, unknown>;
  if (
    key.protocol !== 'groth16' ||
    key.curve !== 'bn128' ||
    key.nPublic !== expectedPublicInputs ||
    !Array.isArray(key.vk_alpha_1) ||
    !Array.isArray(key.vk_beta_2) ||
    !Array.isArray(key.vk_gamma_2) ||
    !Array.isArray(key.vk_delta_2) ||
    !Array.isArray(key.IC) ||
    key.IC.length !== expectedPublicInputs + 1
  ) {
    throw new Error('Private Balance verification key schema does not match protocol V1.');
  }
  return key;
}

let inFlightLoad: { key: string; promise: Promise<LoadedCircuitArtifacts> } | null = null;

export async function loadCircuitArtifacts(
  manifest: PrivateBalanceManifest,
  basePath: string = '/protocol/private-balance/v1',
  cache?: CircuitArtifactCache | null,
): Promise<LoadedCircuitArtifacts> {
  const parsed = validateManifest(manifest);
  const key = [
    basePath,
    parsed.artifacts.wasmSha256,
    parsed.artifacts.zkeySha256,
    parsed.artifacts.zkeyTransport?.sha256 ?? 'raw',
    parsed.artifacts.vkJsonSha256,
  ].join('|');
  if (inFlightLoad?.key === key) return inFlightLoad.promise;

  const promise = (async () => {
    const artifactCache = cache === undefined ? await defaultArtifactCache(parsed, basePath) : cache;
    const wasmUrl = contentAddressedArtifactUrl(
      `${basePath}/circuit.wasm`,
      parsed.artifacts.wasmSha256,
    );
    const useTransport = parsed.artifacts.zkeyTransport !== undefined;
    const zkeyUrl = contentAddressedArtifactUrl(
      `${basePath}/circuit.zkey${useTransport ? '.pc' : ''}`,
      useTransport
        ? parsed.artifacts.zkeyTransport!.sha256
        : parsed.artifacts.zkeySha256,
    );
    const verificationKeyUrl = contentAddressedArtifactUrl(
      `${basePath}/verification-key.json`,
      parsed.artifacts.vkJsonSha256,
    );

    const [wasmBuffer, zkeyBuffer, verificationKeyBuffer] = await Promise.all([
      loadCachedOrFetchArtifact(
        artifactCache,
        wasmUrl,
        parsed.artifacts.wasmSha256,
        parsed.artifacts.wasmByteLength,
      ),
      useTransport
        ? loadCachedOrFetchPointCompressedArtifact(
            artifactCache,
            zkeyUrl,
            parsed.artifacts.zkeyTransport!.sha256,
            parsed.artifacts.zkeyTransport!.byteLength,
            parsed.artifacts.zkeySha256,
            parsed.artifacts.zkeyByteLength,
          )
        : loadCachedOrFetchArtifact(
            artifactCache,
            zkeyUrl,
            parsed.artifacts.zkeySha256,
            parsed.artifacts.zkeyByteLength,
          ),
      loadCachedOrFetchArtifact(
        artifactCache,
        verificationKeyUrl,
        parsed.artifacts.vkJsonSha256,
        undefined,
        MAX_VERIFICATION_KEY_BYTES,
      ),
    ]);

    const verificationKey = parseVerificationKey(verificationKeyBuffer, parsed.constants.publicInputs);
    try { await artifactCache?.complete?.(); } catch {
      // Cleanup is best-effort and must never invalidate verified artifacts.
    }
    return {
      wasmBuffer,
      zkeyBuffer,
      verificationKey,
    };
  })();
  inFlightLoad = { key, promise };
  try {
    return await promise;
  } finally {
    if (inFlightLoad?.promise === promise) inFlightLoad = null;
  }
}

/**
 * Fire-and-forget warm-up of the content-addressed artifact cache. All
 * buffers are dropped after verification; only the cache entries remain.
 */
export function prefetchCircuitArtifacts(
  manifest: PrivateBalanceManifest,
  basePath?: string,
  cache?: CircuitArtifactCache | null,
): void {
  void loadCircuitArtifacts(manifest, basePath, cache).catch(() => {
    // Prefetch is opportunistic; the action flow retries with full errors.
  });
}
