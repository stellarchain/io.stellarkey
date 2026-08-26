import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import type { MerchantStore } from "./types";

const te = new TextEncoder();
const td = new TextDecoder();
const ENVELOPE_KIND = "polaris-merchant-store";
const ENVELOPE_VERSION = 3;

export interface EncryptedMerchantEnvelope {
  kind: typeof ENVELOPE_KIND;
  version: typeof ENVELOPE_VERSION;
  revision: number;
  writerId: string | null;
  updatedAt: number;
  crypto: {
    algorithm: "XChaCha20-Poly1305";
    nonce: string;
    ciphertext: string;
  };
}

function toB64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromB64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function assertKey(key: Uint8Array): void {
  if (key.length !== 32) throw new Error("Merchant encryption requires a 32-byte session key.");
}

function metadata(envelope: Pick<EncryptedMerchantEnvelope, "revision" | "writerId" | "updatedAt">): Uint8Array {
  return te.encode(
    `${ENVELOPE_KIND}|${ENVELOPE_VERSION}|${envelope.revision}|${envelope.writerId ?? ""}|${envelope.updatedAt}`,
  );
}

export function isEncryptedMerchantEnvelope(value: unknown): value is EncryptedMerchantEnvelope {
  if (!value || typeof value !== "object") return false;
  const envelope = value as Partial<EncryptedMerchantEnvelope>;
  const crypto = envelope.crypto;
  return (
    envelope.kind === ENVELOPE_KIND &&
    envelope.version === ENVELOPE_VERSION &&
    Number.isSafeInteger(envelope.revision) &&
    (envelope.revision as number) >= 0 &&
    (envelope.writerId === null || typeof envelope.writerId === "string") &&
    typeof envelope.updatedAt === "number" &&
    Number.isFinite(envelope.updatedAt) &&
    Boolean(crypto) &&
    crypto?.algorithm === "XChaCha20-Poly1305" &&
    typeof crypto.nonce === "string" &&
    typeof crypto.ciphertext === "string"
  );
}

export function encryptMerchantStore(
  store: MerchantStore,
  key: Uint8Array,
  randomNonce: () => Uint8Array = () => crypto.getRandomValues(new Uint8Array(24)),
): EncryptedMerchantEnvelope {
  assertKey(key);
  const nonce = randomNonce();
  if (nonce.length !== 24) throw new Error("Merchant encryption requires a 24-byte nonce.");
  const envelope: EncryptedMerchantEnvelope = {
    kind: ENVELOPE_KIND,
    version: ENVELOPE_VERSION,
    revision: store.revision,
    writerId: store.writerId,
    updatedAt: store.updatedAt,
    crypto: {
      algorithm: "XChaCha20-Poly1305",
      nonce: toB64(nonce),
      ciphertext: "",
    },
  };
  const cipher = xchacha20poly1305(key, nonce, metadata(envelope));
  envelope.crypto.ciphertext = toB64(cipher.encrypt(te.encode(JSON.stringify(store))));
  return envelope;
}

export function decryptMerchantStore(
  envelope: EncryptedMerchantEnvelope,
  key: Uint8Array,
): MerchantStore {
  assertKey(key);
  try {
    const cipher = xchacha20poly1305(
      key,
      fromB64(envelope.crypto.nonce),
      metadata(envelope),
    );
    return JSON.parse(td.decode(cipher.decrypt(fromB64(envelope.crypto.ciphertext)))) as MerchantStore;
  } catch {
    throw new Error("Merchant data could not be decrypted or authenticated.");
  }
}
