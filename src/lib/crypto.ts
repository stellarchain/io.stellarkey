const KDF_ITERATIONS = 600_000;

const te = new TextEncoder();
const td = new TextDecoder();

export interface EncryptedPayload {
  salt: string;
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

function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    te.encode(password) as unknown as ArrayBuffer,
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
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

export async function encryptString(
  plaintext: string,
  password: string,
): Promise<EncryptedPayload> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(password, salt);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as unknown as ArrayBuffer },
    key,
    te.encode(plaintext) as unknown as ArrayBuffer,
  );
  return { salt: toB64(salt), iv: toB64(iv), ciphertext: toB64(new Uint8Array(ct)) };
}

export async function decryptString(
  payload: EncryptedPayload,
  password: string,
): Promise<string> {
  const key = await deriveKey(password, fromB64(payload.salt));
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(payload.iv) as unknown as ArrayBuffer },
    key,
    fromB64(payload.ciphertext) as unknown as ArrayBuffer,
  );
  return td.decode(pt);
}

export function randomHex(bytes = 8): string {
  return Array.from(randomBytes(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
