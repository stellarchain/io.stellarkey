import {
  decryptBytes,
  decryptBytesWithKey,
  decryptStringWithKey,
  deriveContextKeyBytes,
  encryptBytes,
  encryptBytesWithKey,
  encryptStringWithKey,
  randomBytes,
  type EncryptedPayload,
  type RawKeyEncryptedPayload,
} from "./crypto";

const MASTER_KEY_BYTES = 32;

export function createVaultMasterKey(): Uint8Array {
  return randomBytes(MASTER_KEY_BYTES);
}

export function zeroKey(key: Uint8Array | null): void {
  key?.fill(0);
}

export async function wrapVaultMasterKey(
  masterKey: Uint8Array,
  password: string,
): Promise<EncryptedPayload> {
  if (masterKey.byteLength !== MASTER_KEY_BYTES) throw new Error("Invalid vault master key.");
  return encryptBytes(masterKey, password);
}

export async function unwrapVaultMasterKey(
  wrapped: EncryptedPayload,
  password: string,
): Promise<Uint8Array> {
  const masterKey = await decryptBytes(wrapped, password);
  if (masterKey.byteLength !== MASTER_KEY_BYTES) {
    zeroKey(masterKey);
    throw new Error("Invalid vault master key.");
  }
  return masterKey;
}

export function encryptVaultString(
  plaintext: string,
  masterKey: Uint8Array,
): Promise<RawKeyEncryptedPayload> {
  return encryptStringWithKey(plaintext, masterKey);
}

export function decryptVaultString(
  payload: RawKeyEncryptedPayload,
  masterKey: Uint8Array,
): Promise<string> {
  return decryptStringWithKey(payload, masterKey);
}

export function encryptVaultBytes(
  plaintext: Uint8Array,
  masterKey: Uint8Array,
): Promise<RawKeyEncryptedPayload> {
  return encryptBytesWithKey(plaintext, masterKey);
}

export function decryptVaultBytes(
  payload: RawKeyEncryptedPayload,
  masterKey: Uint8Array,
): Promise<Uint8Array> {
  return decryptBytesWithKey(payload, masterKey);
}

export function deriveVaultContextKey(
  masterKey: Uint8Array,
  context: string,
): Promise<Uint8Array> {
  return deriveContextKeyBytes(masterKey, context);
}
