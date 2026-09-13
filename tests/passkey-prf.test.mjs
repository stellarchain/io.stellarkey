import assert from "node:assert/strict";
import test from "node:test";

import {
  PASSKEY_RECORD_KEY,
  PasskeyCancelledError,
  isPasskeyPrfEnvironmentAvailable,
  loadPasskeyRecord,
  registerPasskeyMasterKey,
  removePasskeyRecord,
  unwrapPasskeyMasterKey,
} from "../src/lib/passkey-prf.ts";

class MemoryStorage {
  #items = new Map();
  getItem(key) { return this.#items.get(key) ?? null; }
  setItem(key, value) { this.#items.set(key, String(value)); }
  removeItem(key) { this.#items.delete(key); }
}

const credentialId = new Uint8Array([7, 8, 9, 10]);
const prfOutput = new Uint8Array(32).fill(23);

function credential(extensionResults, rawId = credentialId) {
  return {
    type: "public-key",
    rawId: rawId.buffer.slice(rawId.byteOffset, rawId.byteOffset + rawId.byteLength),
    getClientExtensionResults: () => extensionResults,
  };
}

function dependencies({ create, get, storage = new MemoryStorage() }) {
  return {
    credentials: { create, get },
    secureContext: true,
    storage,
  };
}

test("PRF capability requires a secure WebAuthn credential environment", () => {
  const credentials = { create() {}, get() {} };
  assert.equal(isPasskeyPrfEnvironmentAvailable({ secureContext: true, credentials }), true);
  assert.equal(isPasskeyPrfEnvironmentAvailable({ secureContext: false, credentials }), false);
  assert.equal(isPasskeyPrfEnvironmentAvailable({ secureContext: true, credentials: null }), false);
});

test("registration wraps the existing master key with a credential PRF output", async () => {
  const storage = new MemoryStorage();
  let createOptions;
  const deps = dependencies({
    storage,
    create: async (options) => {
      createOptions = options;
      return credential({ prf: { enabled: true, results: { first: prfOutput.buffer } } });
    },
    get: async () => credential({ prf: { results: { first: prfOutput } } }),
  });
  const masterKey = new Uint8Array(32).map((_, index) => index + 1);

  const record = await registerPasskeyMasterKey(masterKey, deps);

  assert.equal(createOptions.publicKey.userVerification, undefined);
  assert.equal(createOptions.publicKey.authenticatorSelection.userVerification, "required");
  assert.equal(createOptions.publicKey.authenticatorSelection.authenticatorAttachment, "platform");
  assert.equal(createOptions.publicKey.attestation, "none");
  assert.ok(createOptions.publicKey.extensions.prf.eval.first instanceof Uint8Array);
  assert.deepEqual(loadPasskeyRecord(storage), record);
  assert.equal(storage.getItem(PASSKEY_RECORD_KEY).includes(masterKey.join(",")), false);
  assert.deepEqual(await unwrapPasskeyMasterKey(record, deps), masterKey);
});

test("registration obtains PRF output with an assertion when creation cannot evaluate it", async () => {
  const storage = new MemoryStorage();
  let assertionOptions;
  const deps = dependencies({
    storage,
    create: async () => credential({ prf: { enabled: true } }),
    get: async (options) => {
      assertionOptions = {
        ...options,
        publicKey: {
          ...options.publicKey,
          allowCredentials: options.publicKey.allowCredentials.map((descriptor) => ({
            ...descriptor,
            id: descriptor.id.slice(0),
          })),
        },
      };
      return credential({ prf: { results: { first: prfOutput } } });
    },
  });

  await registerPasskeyMasterKey(new Uint8Array(32).fill(4), deps);

  assert.deepEqual(new Uint8Array(assertionOptions.publicKey.allowCredentials[0].id), credentialId);
  assert.equal(assertionOptions.publicKey.userVerification, "required");
});

test("missing, malformed, and mismatched PRF assertions fail closed", async () => {
  const storage = new MemoryStorage();
  await assert.rejects(
    () => registerPasskeyMasterKey(new Uint8Array(32), dependencies({
      storage,
      create: async () => credential({ prf: { enabled: false } }),
      get: async () => null,
    })),
    /does not support.*PRF/i,
  );
  assert.equal(storage.getItem(PASSKEY_RECORD_KEY), null);

  const goodDeps = dependencies({
    storage,
    create: async () => credential({ prf: { enabled: true, results: { first: prfOutput } } }),
    get: async () => credential({ prf: { results: { first: prfOutput } } }),
  });
  const record = await registerPasskeyMasterKey(new Uint8Array(32).fill(8), goodDeps);
  await assert.rejects(
    () => unwrapPasskeyMasterKey(record, dependencies({
      storage,
      create: async () => null,
      get: async () => credential({ prf: { results: { first: new Uint8Array(31) } } }),
    })),
    /32-byte PRF output/i,
  );
  await assert.rejects(
    () => unwrapPasskeyMasterKey(record, dependencies({
      storage,
      create: async () => null,
      get: async () => credential(
        { prf: { results: { first: prfOutput } } },
        new Uint8Array([1, 2, 3]),
      ),
    })),
    /could not unlock/i,
  );
});

test("user cancellation is distinct and never persists a partial registration", async () => {
  const storage = new MemoryStorage();
  const cancelled = Object.assign(new Error("cancelled"), { name: "NotAllowedError" });
  await assert.rejects(
    () => registerPasskeyMasterKey(new Uint8Array(32), dependencies({
      storage,
      create: async () => { throw cancelled; },
      get: async () => null,
    })),
    (error) => error instanceof PasskeyCancelledError,
  );
  assert.equal(loadPasskeyRecord(storage), null);
});

test("removal deletes only local passkey authority", async () => {
  const storage = new MemoryStorage();
  storage.setItem(PASSKEY_RECORD_KEY, "record");
  removePasskeyRecord(storage);
  assert.equal(storage.getItem(PASSKEY_RECORD_KEY), null);
});
