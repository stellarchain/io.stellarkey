const ALGORITHM = "PBKDF2";
const HASH = "SHA-256";
const CREDENTIAL_PREFIX = "pbkdf2-sha256$v1";
const ITERATIONS = 600_000;
const SALT_BYTES = 16;
const DIGEST_BYTES = 32;

export interface MerchantCryptoProvider {
  subtle: SubtleCrypto;
  getRandomValues<T extends ArrayBufferView>(array: T): T;
}

interface ParsedCredential {
  iterations: number;
  salt: Uint8Array<ArrayBuffer>;
  digest: Uint8Array<ArrayBuffer>;
}

function validPin(pin: string): boolean {
  return /^\d{4,6}$/.test(pin);
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) return null;
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    // Reject alternate/non-canonical encodings so the stored contract is stable.
    return toBase64(bytes) === value ? bytes : null;
  } catch {
    return null;
  }
}

function parseCredential(value: string): ParsedCredential | null {
  const [algorithm, version, iterationsText, saltText, digestText, ...rest] = value.split("$");
  if (rest.length > 0 || `${algorithm}$${version}` !== CREDENTIAL_PREFIX) return null;
  const iterations = Number(iterationsText);
  if (iterations !== ITERATIONS) return null;
  const salt = fromBase64(saltText ?? "");
  const digest = fromBase64(digestText ?? "");
  if (salt?.length !== SALT_BYTES || digest?.length !== DIGEST_BYTES) return null;
  return { iterations, salt, digest };
}

async function derivePin(
  pin: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
  cryptoProvider: MerchantCryptoProvider,
): Promise<Uint8Array<ArrayBuffer>> {
  const encodedPin = new Uint8Array(new TextEncoder().encode(pin));
  const material = await cryptoProvider.subtle.importKey(
    "raw",
    encodedPin,
    ALGORITHM,
    false,
    ["deriveBits"],
  );
  const bits = await cryptoProvider.subtle.deriveBits(
    { name: ALGORITHM, hash: HASH, salt, iterations },
    material,
    DIGEST_BYTES * 8,
  );
  return new Uint8Array(bits);
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

function secureCrypto(
  cryptoProvider: MerchantCryptoProvider | undefined,
): MerchantCryptoProvider {
  if (!cryptoProvider?.subtle || typeof cryptoProvider.getRandomValues !== "function") {
    throw new Error("Secure PIN storage requires HTTPS or localhost so Web Crypto is available.");
  }
  return cryptoProvider;
}

/** Create a one-way, versioned till credential. It never authorizes a signature. */
export async function createMerchantPinCredential(
  pin: string,
  cryptoProvider: MerchantCryptoProvider | undefined = globalThis.crypto,
): Promise<string> {
  if (!validPin(pin)) throw new Error("A merchant PIN must contain 4 to 6 digits.");
  const provider = secureCrypto(cryptoProvider);
  const salt = provider.getRandomValues(new Uint8Array(SALT_BYTES));
  const digest = await derivePin(pin, salt, ITERATIONS, provider);
  return `${CREDENTIAL_PREFIX}$${ITERATIONS}$${toBase64(salt)}$${toBase64(digest)}`;
}

export function isMerchantPinCredential(value: unknown): value is string {
  return typeof value === "string" && parseCredential(value) !== null;
}

/** Malformed credentials and invalid PIN shapes fail closed without crypto work. */
export async function verifyMerchantPin(
  pin: string,
  credential: string,
  cryptoProvider: MerchantCryptoProvider | undefined = globalThis.crypto,
): Promise<boolean> {
  if (!validPin(pin)) return false;
  const parsed = parseCredential(credential);
  if (!parsed || !cryptoProvider?.subtle) return false;
  const actual = await derivePin(pin, parsed.salt, parsed.iterations, cryptoProvider);
  return constantTimeEqual(actual, parsed.digest);
}

export const MERCHANT_PIN_ITERATIONS = ITERATIONS;
