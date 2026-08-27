import { requireWebCrypto } from "./web-crypto";

const KDF_ITERATIONS = 600_000;

const te = new TextEncoder();
const td = new TextDecoder();

export interface EncryptedPayload {
  salt: string;
  iv: string;
  ciphertext: string;
}

export interface RawKeyEncryptedPayload {
  iv: string;
  ciphertext: string;
}

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomBytes(n: number): Uint8Array {
  return requireWebCrypto().getRandomValues(new Uint8Array(n));
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const provider = requireWebCrypto();
  const material = await provider.subtle.importKey(
    "raw",
    te.encode(password) as unknown as ArrayBuffer,
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return provider.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as unknown as ArrayBuffer,
      iterations: KDF_ITERATIONS,
      hash: "SHA-256",
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function deriveEncryptionKeyBytes(
  password: string,
  context: string,
): Promise<Uint8Array> {
  const provider = requireWebCrypto();
  const material = await provider.subtle.importKey(
    "raw",
    te.encode(password) as unknown as ArrayBuffer,
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await provider.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: te.encode(`polaris:${context}:v1`) as unknown as ArrayBuffer,
      iterations: KDF_ITERATIONS,
      hash: "SHA-256",
    },
    material,
    256,
  );
  return new Uint8Array(bits);
}

export async function encryptString(
  plaintext: string,
  password: string,
): Promise<EncryptedPayload> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(password, salt);
  const ct = await requireWebCrypto().subtle.encrypt(
    { name: "AES-GCM", iv: iv as unknown as ArrayBuffer },
    key,
    te.encode(plaintext) as unknown as ArrayBuffer,
  );
  return { salt: toB64(salt), iv: toB64(iv), ciphertext: toB64(new Uint8Array(ct)) };
}

export async function encryptBytes(
  plaintext: Uint8Array,
  password: string,
): Promise<EncryptedPayload> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(password, salt);
  const ciphertext = await requireWebCrypto().subtle.encrypt(
    { name: "AES-GCM", iv: iv as unknown as ArrayBuffer },
    key,
    plaintext as unknown as ArrayBuffer,
  );
  return { salt: toB64(salt), iv: toB64(iv), ciphertext: toB64(new Uint8Array(ciphertext)) };
}

export async function decryptString(
  payload: EncryptedPayload,
  password: string,
): Promise<string> {
  const key = await deriveKey(password, fromB64(payload.salt));
  const pt = await requireWebCrypto().subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(payload.iv) as unknown as ArrayBuffer },
    key,
    fromB64(payload.ciphertext) as unknown as ArrayBuffer,
  );
  return td.decode(pt);
}

export async function decryptBytes(
  payload: EncryptedPayload,
  password: string,
): Promise<Uint8Array> {
  const key = await deriveKey(password, fromB64(payload.salt));
  const plaintext = await requireWebCrypto().subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(payload.iv) as unknown as ArrayBuffer },
    key,
    fromB64(payload.ciphertext) as unknown as ArrayBuffer,
  );
  return new Uint8Array(plaintext);
}

async function importRawAesKey(keyBytes: Uint8Array, usages: KeyUsage[]): Promise<CryptoKey> {
  if (keyBytes.byteLength !== 32) throw new Error("Vault master key must be 32 bytes.");
  return requireWebCrypto().subtle.importKey(
    "raw",
    keyBytes as unknown as ArrayBuffer,
    { name: "AES-GCM" },
    false,
    usages,
  );
}

export async function encryptStringWithKey(
  plaintext: string,
  keyBytes: Uint8Array,
): Promise<RawKeyEncryptedPayload> {
  return encryptBytesWithKey(te.encode(plaintext), keyBytes);
}

export async function encryptBytesWithKey(
  plaintext: Uint8Array,
  keyBytes: Uint8Array,
): Promise<RawKeyEncryptedPayload> {
  const iv = randomBytes(12);
  const key = await importRawAesKey(keyBytes, ["encrypt"]);
  const ciphertext = await requireWebCrypto().subtle.encrypt(
    { name: "AES-GCM", iv: iv as unknown as ArrayBuffer },
    key,
    plaintext as unknown as ArrayBuffer,
  );
  return { iv: toB64(iv), ciphertext: toB64(new Uint8Array(ciphertext)) };
}

export async function decryptStringWithKey(
  payload: RawKeyEncryptedPayload,
  keyBytes: Uint8Array,
): Promise<string> {
  return td.decode(await decryptBytesWithKey(payload, keyBytes));
}

export async function decryptBytesWithKey(
  payload: RawKeyEncryptedPayload,
  keyBytes: Uint8Array,
): Promise<Uint8Array> {
  const key = await importRawAesKey(keyBytes, ["decrypt"]);
  const plaintext = await requireWebCrypto().subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(payload.iv) as unknown as ArrayBuffer },
    key,
    fromB64(payload.ciphertext) as unknown as ArrayBuffer,
  );
  return new Uint8Array(plaintext);
}

export async function deriveContextKeyBytes(
  keyBytes: Uint8Array,
  context: string,
): Promise<Uint8Array> {
  const provider = requireWebCrypto();
  const material = await provider.subtle.importKey(
    "raw",
    keyBytes as unknown as ArrayBuffer,
    "HKDF",
    false,
    ["deriveBits"],
  );
  const bits = await provider.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: te.encode("wallet-vault-context-v1") as unknown as ArrayBuffer,
      info: te.encode(context) as unknown as ArrayBuffer,
    },
    material,
    256,
  );
  return new Uint8Array(bits);
}

export function randomHex(bytes = 8): string {
  return Array.from(randomBytes(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
