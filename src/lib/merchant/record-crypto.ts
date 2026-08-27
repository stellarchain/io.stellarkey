import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";

const te = new TextEncoder();
const td = new TextDecoder();
const RECORD_KIND = "polaris-merchant-record";
const RECORD_VERSION = 1;
const ARCHIVE_KIND = "polaris-merchant-record-archive";
const ARCHIVE_VERSION = 1;

export interface EncryptedMerchantRecordEnvelope {
  kind: typeof RECORD_KIND;
  version: typeof RECORD_VERSION;
  revision: number;
  writerId: string | null;
  updatedAt: number;
  crypto: {
    algorithm: "XChaCha20-Poly1305";
    nonce: string;
    ciphertext: string;
  };
}

export interface EncryptedMerchantRecordArchive {
  kind: typeof ARCHIVE_KIND;
  version: typeof ARCHIVE_VERSION;
  revision: number;
  writerId: string | null;
  updatedAt: number;
  records: Record<string, string>;
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

function authenticatedMetadata(
  storageKey: string,
  envelope: Pick<EncryptedMerchantRecordEnvelope, "revision" | "writerId" | "updatedAt">,
): Uint8Array {
  return te.encode(
    `${RECORD_KIND}|${RECORD_VERSION}|${storageKey}|${envelope.revision}|${envelope.writerId ?? ""}|${envelope.updatedAt}`,
  );
}

export function isEncryptedMerchantRecordEnvelope(
  value: unknown,
): value is EncryptedMerchantRecordEnvelope {
  if (!value || typeof value !== "object") return false;
  const envelope = value as Partial<EncryptedMerchantRecordEnvelope>;
  const crypto = envelope.crypto;
  return (
    envelope.kind === RECORD_KIND &&
    envelope.version === RECORD_VERSION &&
    Number.isSafeInteger(envelope.revision) &&
    (envelope.revision as number) >= 0 &&
    (envelope.writerId === null || typeof envelope.writerId === "string") &&
    typeof envelope.updatedAt === "number" &&
    Number.isFinite(envelope.updatedAt) &&
    Boolean(crypto) &&
    crypto?.algorithm === "XChaCha20-Poly1305" &&
    typeof crypto.nonce === "string" &&
    crypto.nonce.length > 0 &&
    typeof crypto.ciphertext === "string" &&
    crypto.ciphertext.length > 0
  );
}

export function encryptMerchantRecord(
  value: unknown,
  key: Uint8Array,
  storageKey: string,
  metadata: Pick<EncryptedMerchantRecordEnvelope, "revision" | "writerId" | "updatedAt">,
  randomNonce: () => Uint8Array = () => crypto.getRandomValues(new Uint8Array(24)),
): EncryptedMerchantRecordEnvelope {
  assertKey(key);
  const nonce = randomNonce();
  if (nonce.length !== 24) throw new Error("Merchant encryption requires a 24-byte nonce.");
  const envelope: EncryptedMerchantRecordEnvelope = {
    kind: RECORD_KIND,
    version: RECORD_VERSION,
    ...metadata,
    crypto: {
      algorithm: "XChaCha20-Poly1305",
      nonce: toB64(nonce),
      ciphertext: "",
    },
  };
  const cipher = xchacha20poly1305(
    key,
    nonce,
    authenticatedMetadata(storageKey, envelope),
  );
  envelope.crypto.ciphertext = toB64(cipher.encrypt(te.encode(JSON.stringify(value))));
  return envelope;
}

export function decryptMerchantRecord(
  envelope: EncryptedMerchantRecordEnvelope,
  key: Uint8Array,
  storageKey: string,
): unknown {
  assertKey(key);
  try {
    const cipher = xchacha20poly1305(
      key,
      fromB64(envelope.crypto.nonce),
      authenticatedMetadata(storageKey, envelope),
    );
    return JSON.parse(td.decode(cipher.decrypt(fromB64(envelope.crypto.ciphertext)))) as unknown;
  } catch {
    throw new Error("Merchant record could not be decrypted or authenticated.");
  }
}

export function isEncryptedMerchantRecordArchive(
  value: unknown,
): value is EncryptedMerchantRecordArchive {
  if (!value || typeof value !== "object") return false;
  const archive = value as Partial<EncryptedMerchantRecordArchive>;
  if (
    archive.kind !== ARCHIVE_KIND ||
    archive.version !== ARCHIVE_VERSION ||
    !Number.isSafeInteger(archive.revision) ||
    (archive.revision as number) < 0 ||
    (archive.writerId !== null && typeof archive.writerId !== "string") ||
    typeof archive.updatedAt !== "number" ||
    !Number.isFinite(archive.updatedAt) ||
    !archive.records ||
    typeof archive.records !== "object" ||
    Array.isArray(archive.records)
  ) {
    return false;
  }
  return Object.entries(archive.records).every(([storageKey, raw]) => {
    if (!storageKey || typeof raw !== "string") return false;
    try {
      return isEncryptedMerchantRecordEnvelope(JSON.parse(raw));
    } catch {
      return false;
    }
  });
}
