import {
  decryptBytesWithKey,
  encryptBytesWithKey,
  randomBytes,
  type RawKeyEncryptedPayload,
} from "./crypto";

export const PASSKEY_RECORD_KEY = "wallet.passkey-prf.v1";

export interface PasskeyRecord {
  version: 1;
  credentialId: string;
  prfSalt: string;
  wrappedMasterKey: RawKeyEncryptedPayload;
  createdAt: string;
}

interface CredentialLike {
  type?: string;
  rawId?: BufferSource;
  getClientExtensionResults?: () => unknown;
}

interface CredentialClient {
  create(options: CredentialCreationOptions): Promise<Credential | null>;
  get(options: CredentialRequestOptions): Promise<Credential | null>;
}

export interface PasskeyStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface PasskeyDependencies {
  credentials: CredentialClient;
  secureContext: boolean;
  storage: PasskeyStorage;
}

export class PasskeyCancelledError extends Error {
  constructor(message = "Passkey request was cancelled.") {
    super(message);
    this.name = "PasskeyCancelledError";
  }
}

export class PasskeyUnsupportedError extends Error {
  constructor(message = "This authenticator does not support the WebAuthn PRF extension.") {
    super(message);
    this.name = "PasskeyUnsupportedError";
  }
}

function browserDependencies(): PasskeyDependencies {
  if (
    typeof window === "undefined" ||
    typeof navigator === "undefined" ||
    !navigator.credentials
  ) {
    throw new PasskeyUnsupportedError("Passkeys are unavailable in this browser.");
  }
  return {
    credentials: navigator.credentials,
    secureContext: window.isSecureContext,
    storage: window.localStorage,
  };
}

function browserStorage(): PasskeyStorage {
  if (typeof window === "undefined") {
    throw new PasskeyUnsupportedError("Browser storage is unavailable.");
  }
  return window.localStorage;
}

export function isPasskeyPrfEnvironmentAvailable({
  secureContext,
  credentials,
}: {
  secureContext: boolean;
  credentials: Partial<CredentialClient> | null;
}): boolean {
  return Boolean(
    secureContext &&
    credentials &&
    typeof credentials.create === "function" &&
    typeof credentials.get === "function",
  );
}

export function canOfferPasskeyUnlock(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof PublicKeyCredential !== "undefined" &&
    isPasskeyPrfEnvironmentAvailable({
      secureContext: window.isSecureContext,
      credentials: navigator.credentials,
    })
  );
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Passkey record is malformed.");
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesFromBufferSource(value: unknown): Uint8Array | null {
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  }
  return null;
}

function copyToArrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(value.byteLength);
  new Uint8Array(copy).set(value);
  return copy;
}

function readCredential(value: Credential | null): Required<Pick<CredentialLike, "rawId" | "getClientExtensionResults">> {
  const candidate = value as CredentialLike | null;
  if (
    !candidate ||
    candidate.type !== "public-key" ||
    !bytesFromBufferSource(candidate.rawId) ||
    typeof candidate.getClientExtensionResults !== "function"
  ) {
    throw new Error("The browser did not return a valid public-key credential.");
  }
  return {
    rawId: candidate.rawId as BufferSource,
    // Native PublicKeyCredential methods require their original receiver in
    // Safari/WebKit. Returning an unbound method causes an "Illegal invocation".
    getClientExtensionResults: candidate.getClientExtensionResults.bind(candidate),
  };
}

function readPrfResult(credential: ReturnType<typeof readCredential>): Uint8Array | null {
  const extensions = credential.getClientExtensionResults() as {
    prf?: { results?: { first?: unknown } };
  };
  const output = bytesFromBufferSource(extensions?.prf?.results?.first);
  if (!output) return null;
  if (output.byteLength !== 32) {
    output.fill(0);
    throw new PasskeyUnsupportedError("The authenticator did not return a valid 32-byte PRF output.");
  }
  return output;
}

function registrationSupportsPrf(credential: ReturnType<typeof readCredential>): boolean {
  const extensions = credential.getClientExtensionResults() as { prf?: { enabled?: unknown } };
  return extensions?.prf?.enabled === true;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

function normalizeCeremonyError(error: unknown): never {
  if (
    error &&
    typeof error === "object" &&
    "name" in error &&
    (error.name === "NotAllowedError" || error.name === "AbortError")
  ) {
    throw new PasskeyCancelledError();
  }
  throw error;
}

async function evaluatePrf(
  credentialId: Uint8Array,
  salt: Uint8Array,
  dependencies: PasskeyDependencies,
): Promise<Uint8Array> {
  let response: Credential | null;
  try {
    response = await dependencies.credentials.get({
      publicKey: {
        challenge: copyToArrayBuffer(randomBytes(32)),
        allowCredentials: [{ type: "public-key", id: copyToArrayBuffer(credentialId) }],
        userVerification: "required",
        timeout: 60_000,
        extensions: {
          prf: { eval: { first: salt } },
        } as AuthenticationExtensionsClientInputs,
      },
    });
  } catch (error) {
    normalizeCeremonyError(error);
  }
  if (!response) throw new PasskeyCancelledError();
  const credential = readCredential(response);
  const responseId = bytesFromBufferSource(credential.rawId);
  if (!responseId || !equalBytes(responseId, credentialId)) {
    throw new Error("The browser returned a different passkey.");
  }
  const output = readPrfResult(credential);
  if (!output) throw new PasskeyUnsupportedError();
  return output;
}

function isWrappedMasterKey(value: unknown): value is RawKeyEncryptedPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<RawKeyEncryptedPayload>;
  return Boolean(candidate.iv && candidate.ciphertext && !("salt" in candidate));
}

export function loadPasskeyRecord(
  storage: PasskeyStorage = browserStorage(),
): PasskeyRecord | null {
  try {
    const raw = storage.getItem(PASSKEY_RECORD_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PasskeyRecord>;
    if (
      value.version !== 1 ||
      typeof value.credentialId !== "string" ||
      fromBase64Url(value.credentialId).byteLength === 0 ||
      typeof value.prfSalt !== "string" ||
      fromBase64Url(value.prfSalt).byteLength !== 32 ||
      !isWrappedMasterKey(value.wrappedMasterKey) ||
      typeof value.createdAt !== "string" ||
      !Number.isFinite(Date.parse(value.createdAt))
    ) return null;
    return value as PasskeyRecord;
  } catch {
    return null;
  }
}

function persistPasskeyRecord(record: PasskeyRecord, storage: PasskeyStorage): void {
  const previous = storage.getItem(PASSKEY_RECORD_KEY);
  const serialized = JSON.stringify(record);
  try {
    storage.setItem(PASSKEY_RECORD_KEY, serialized);
    const verified = loadPasskeyRecord(storage);
    if (!verified || JSON.stringify(verified) !== serialized) {
      throw new Error("Browser storage did not retain the passkey record.");
    }
  } catch (error) {
    if (previous === null) storage.removeItem(PASSKEY_RECORD_KEY);
    else storage.setItem(PASSKEY_RECORD_KEY, previous);
    throw error;
  }
}

export async function registerPasskeyMasterKey(
  masterKey: Uint8Array,
  dependencies: PasskeyDependencies = browserDependencies(),
): Promise<PasskeyRecord> {
  if (!isPasskeyPrfEnvironmentAvailable(dependencies)) {
    throw new PasskeyUnsupportedError("Passkeys require HTTPS and a compatible browser.");
  }
  if (masterKey.byteLength !== 32) throw new Error("Vault master key must be 32 bytes.");
  const salt = randomBytes(32);
  let response: Credential | null;
  try {
    response = await dependencies.credentials.create({
      publicKey: {
        challenge: copyToArrayBuffer(randomBytes(32)),
        rp: { name: "Wallet" },
        user: {
          id: copyToArrayBuffer(randomBytes(32)),
          name: "local-wallet",
          displayName: "Wallet unlock",
        },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          residentKey: "required",
          requireResidentKey: true,
          userVerification: "required",
        },
        timeout: 60_000,
        attestation: "none",
        extensions: {
          prf: { eval: { first: salt } },
        } as AuthenticationExtensionsClientInputs,
      },
    });
  } catch (error) {
    salt.fill(0);
    normalizeCeremonyError(error);
  }
  if (!response) {
    salt.fill(0);
    throw new PasskeyCancelledError();
  }
  const credential = readCredential(response);
  if (!registrationSupportsPrf(credential)) {
    salt.fill(0);
    throw new PasskeyUnsupportedError();
  }
  const credentialId = bytesFromBufferSource(credential.rawId) as Uint8Array;
  let prfOutput = readPrfResult(credential);
  try {
    prfOutput ??= await evaluatePrf(credentialId, salt, dependencies);
    const record: PasskeyRecord = {
      version: 1,
      credentialId: toBase64Url(credentialId),
      prfSalt: toBase64Url(salt),
      wrappedMasterKey: await encryptBytesWithKey(masterKey, prfOutput),
      createdAt: new Date().toISOString(),
    };
    persistPasskeyRecord(record, dependencies.storage);
    return record;
  } finally {
    salt.fill(0);
    prfOutput?.fill(0);
    credentialId.fill(0);
  }
}

export async function unwrapPasskeyMasterKey(
  record: PasskeyRecord | null | undefined = undefined,
  dependencies: PasskeyDependencies = browserDependencies(),
): Promise<Uint8Array> {
  const storedRecord = record ?? loadPasskeyRecord(dependencies.storage);
  if (!storedRecord) throw new Error("Passkey unlock is not configured.");
  if (!isPasskeyPrfEnvironmentAvailable(dependencies)) {
    throw new PasskeyUnsupportedError("Passkeys require HTTPS and a compatible browser.");
  }
  const credentialId = fromBase64Url(storedRecord.credentialId);
  const salt = fromBase64Url(storedRecord.prfSalt);
  let prfOutput: Uint8Array | null = null;
  try {
    prfOutput = await evaluatePrf(credentialId, salt, dependencies);
    const masterKey = await decryptBytesWithKey(storedRecord.wrappedMasterKey, prfOutput);
    if (masterKey.byteLength !== 32) {
      masterKey.fill(0);
      throw new Error("Passkey did not unwrap a valid vault master key.");
    }
    return masterKey;
  } catch (error) {
    if (error instanceof PasskeyCancelledError || error instanceof PasskeyUnsupportedError) throw error;
    throw new Error("This passkey could not unlock the local vault.");
  } finally {
    credentialId.fill(0);
    salt.fill(0);
    prfOutput?.fill(0);
  }
}

export function removePasskeyRecord(
  storage: PasskeyStorage = browserStorage(),
): void {
  storage.removeItem(PASSKEY_RECORD_KEY);
}
