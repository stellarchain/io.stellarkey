import { type PrivateBalanceManifest, validateManifest } from './private-balance-manifest';
import { expandPointCompressedZkeyTransport } from './private-balance-zkey-transport';

export interface LoadedCircuitArtifacts {
  wasmBuffer: ArrayBuffer;
  zkeyBuffer: ArrayBuffer;
  verificationKey: Record<string, unknown>;
}

const MAX_VERIFICATION_KEY_BYTES = 1024 * 1024;
const ARTIFACT_CACHE_NAME = 'stellarkey-private-balance-artifacts-v1';

/**
 * Content-addressed artifact store: entries are keyed by their expected
 * SHA-256, and every read is re-verified against that hash before use, so a
 * poisoned cache entry can never reach the prover.
 */
export interface CircuitArtifactCache {
  read(sha256: string): Promise<ArrayBuffer | null>;
  write(sha256: string, buffer: ArrayBuffer): Promise<void>;
}

function cacheEntryUrl(sha256: string): string {
  return `/private-balance-artifact/sha256/${sha256.toLowerCase()}`;
}

function defaultArtifactCache(): CircuitArtifactCache | null {
  if (typeof caches === 'undefined') return null;
  return {
    async read(sha256) {
      const cache = await caches.open(ARTIFACT_CACHE_NAME);
      const response = await cache.match(cacheEntryUrl(sha256));
      return response ? response.arrayBuffer() : null;
    },
    async write(sha256, buffer) {
      const cache = await caches.open(ARTIFACT_CACHE_NAME);
      await cache.put(
        cacheEntryUrl(sha256),
        new Response(buffer.slice(0), {
          headers: { 'content-type': 'application/octet-stream' },
        }),
      );
    },
  };
}

async function loadCachedOrFetchArtifact(
  cache: CircuitArtifactCache | null,
  url: string,
  expectedSha256: string,
  expectedByteLength?: number,
  maximumByteLength?: number,
): Promise<ArrayBuffer> {
  if (cache) {
    try {
      const cached = await cache.read(expectedSha256);
      if (cached) {
        const hash = await computeSha256(cached);
        if (hash.toLowerCase() === expectedSha256.toLowerCase()) return cached;
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
  if (cache) {
    try {
      await cache.write(expectedSha256, buffer);
    } catch {
      // Cache writes are best-effort; the verified buffer is already in hand.
    }
  }
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
  if (cache) {
    try {
      const cached = await cache.read(expectedSha256);
      if (cached) {
        const hash = await computeSha256(cached);
        if (
          cached.byteLength === expectedByteLength &&
          hash.toLowerCase() === expectedSha256.toLowerCase()
        ) return cached;
      }
    } catch {
      // A defective cache never blocks the verified network path.
    }
  }
  const transport = await fetchAndVerifyArtifact(
    url,
    transportSha256,
    transportByteLength,
    transportByteLength,
  );
  const buffer = await expandPointCompressedZkeyTransport(transport, expectedByteLength);
  const hash = await computeSha256(buffer);
  if (hash.toLowerCase() !== expectedSha256.toLowerCase()) {
    throw new Error(
      `Artifact hash mismatch after point expansion for ${url}: expected ${expectedSha256}, got ${hash}`,
    );
  }
  if (cache) {
    try {
      await cache.write(expectedSha256, buffer);
    } catch {
      // Cache writes are best-effort; the verified buffer is already in hand.
    }
  }
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
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch artifact from ${url}: HTTP ${res.status}`);
  }

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

  if (expectedByteLength && buffer.byteLength !== expectedByteLength) {
    throw new Error(
      `Artifact size mismatch for ${url}: expected ${expectedByteLength}, got ${buffer.byteLength}`
    );
  }

  const hash = await computeSha256(buffer);
  if (hash.toLowerCase() !== expectedSha256.toLowerCase()) {
    throw new Error(
      `Artifact hash mismatch for ${url}: expected ${expectedSha256}, got ${hash}`
    );
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
  cache: CircuitArtifactCache | null = defaultArtifactCache(),
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
        cache,
        wasmUrl,
        parsed.artifacts.wasmSha256,
        parsed.artifacts.wasmByteLength,
      ),
      useTransport
        ? loadCachedOrFetchPointCompressedArtifact(
            cache,
            zkeyUrl,
            parsed.artifacts.zkeyTransport!.sha256,
            parsed.artifacts.zkeyTransport!.byteLength,
            parsed.artifacts.zkeySha256,
            parsed.artifacts.zkeyByteLength,
          )
        : loadCachedOrFetchArtifact(
            cache,
            zkeyUrl,
            parsed.artifacts.zkeySha256,
            parsed.artifacts.zkeyByteLength,
          ),
      loadCachedOrFetchArtifact(
        cache,
        verificationKeyUrl,
        parsed.artifacts.vkJsonSha256,
        undefined,
        MAX_VERIFICATION_KEY_BYTES,
      ),
    ]);

    return {
      wasmBuffer,
      zkeyBuffer,
      verificationKey: parseVerificationKey(
        verificationKeyBuffer,
        parsed.constants.publicInputs,
      ),
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
  cache: CircuitArtifactCache | null = defaultArtifactCache(),
): void {
  void loadCircuitArtifacts(manifest, basePath, cache).catch(() => {
    // Prefetch is opportunistic; the action flow retries with full errors.
  });
}
