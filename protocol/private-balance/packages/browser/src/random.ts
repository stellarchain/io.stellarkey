import { isCanonicalField } from './field.js';

function nativeCrypto(): Crypto {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) {
    throw new Error('Native cryptographic randomness is unavailable');
  }
  return cryptoApi;
}

export function randomBytes32(): Uint8Array {
  return nativeCrypto().getRandomValues(new Uint8Array(32));
}

export function sampleNonzeroField(): Uint8Array {
  for (;;) {
    const candidate = randomBytes32();
    candidate[0] &= 0x3f;
    if (candidate.some(byte => byte !== 0) && isCanonicalField(candidate)) {
      return candidate;
    }
    candidate.fill(0);
  }
}
