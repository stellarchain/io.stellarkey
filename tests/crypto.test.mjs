import assert from "node:assert/strict";
import { createCipheriv, hkdfSync, pbkdf2Sync } from "node:crypto";
import test from "node:test";
import {
  decryptBytes,
  decryptBytesWithKey,
  decryptString,
  decryptStringWithKey,
  deriveContextKeyBytes,
  encryptBytes,
  encryptBytesWithKey,
  encryptString,
  encryptStringWithKey,
} from "../src/lib/crypto.ts";

const password = "synthetic encryption test password";
const message = "Synthetic UTF-8 fixture: £ · 日本語 · 🚀";
const encoded = new TextEncoder().encode(message);

test("password string and byte APIs share their UTF-8 payload format", async () => {
  const stringPayload = await encryptString(message, password);
  assert.deepEqual(await decryptBytes(stringPayload, password), encoded);
  const bytePayload = await encryptBytes(encoded, password);
  assert.equal(await decryptString(bytePayload, password), message);
  assert.equal(Buffer.from(stringPayload.salt, "base64").length, 16);
  assert.equal(Buffer.from(stringPayload.iv, "base64").length, 12);
  assert.equal(Buffer.from(stringPayload.ciphertext, "base64").length, encoded.length + 16);
  assert.notEqual(stringPayload.iv, bytePayload.iv);
  assert.notEqual(stringPayload.salt, bytePayload.salt);
});

test("password decryption accepts the existing PBKDF2/AES-GCM encoding and rejects tampering", async () => {
  const salt = Buffer.alloc(16, 1);
  const iv = Buffer.alloc(12, 2);
  const key = pbkdf2Sync(password, salt, 600_000, 32, "sha256");
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(encoded), cipher.final(), cipher.getAuthTag()]);
  const payload = {
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
  assert.equal(await decryptString(payload, password), message);
  await assert.rejects(decryptString(payload, "wrong password"), { name: "OperationError" });
  ciphertext[0] ^= 1;
  await assert.rejects(decryptBytes({ ...payload, ciphertext: ciphertext.toString("base64") }, password), { name: "OperationError" });
});

test("byte APIs preserve view offsets and do not encrypt surrounding bytes", async () => {
  const source = Uint8Array.of(99, 0, 255, 128, 99);
  const view = source.subarray(1, 4);
  assert.deepEqual(await decryptBytes(await encryptBytes(view, password), password), view);
  assert.deepEqual(source, Uint8Array.of(99, 0, 255, 128, 99));
  assert.deepEqual(await decryptBytes(await encryptBytes(new Uint8Array(), password), password), new Uint8Array());
});

test("raw-key encryption authenticates additional data and respects key/plaintext views", async () => {
  const keyStorage = new Uint8Array(34).fill(3);
  const key = keyStorage.subarray(1, 33);
  const source = Uint8Array.of(99, 0, 255, 128, 99);
  const plaintext = source.subarray(1, 4);
  const aad = Uint8Array.of(99, 4, 5, 99).subarray(1, 3);
  const payload = await encryptBytesWithKey(plaintext, key, aad);
  assert.deepEqual(await decryptBytesWithKey(payload, key, aad), plaintext);
  await assert.rejects(decryptBytesWithKey(payload, key, Uint8Array.of(4, 6)), { name: "OperationError" });
  await assert.rejects(decryptBytesWithKey(payload, key), { name: "OperationError" });
  await assert.rejects(encryptBytesWithKey(plaintext, new Uint8Array(31)), /Vault master key must be 32 bytes/);
  await assert.rejects(decryptBytesWithKey(payload, new Uint8Array(33), aad), /Vault master key must be 32 bytes/);
  assert.equal(await decryptStringWithKey(await encryptStringWithKey(message, key), key), message);
  assert.deepEqual(keyStorage, new Uint8Array(34).fill(3));
});

test("context derivation preserves the HKDF salt and separates contexts", async () => {
  const key = new Uint8Array(32).fill(7);
  const expected = new Uint8Array(hkdfSync("sha256", key, "wallet-vault-context-v1", "synthetic-context", 32));
  const actual = await deriveContextKeyBytes(key, "synthetic-context");
  assert.deepEqual(actual, expected);
  assert.notDeepEqual(await deriveContextKeyBytes(key, "another-context"), actual);
});
