import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";

import {
  createMerchantPinCredential,
  isMerchantPinCredential,
  verifyMerchantPin,
} from "../src/lib/merchant/pin.ts";

test("merchant PIN credentials are salted, versioned, and verifiable", async () => {
  const first = await createMerchantPinCredential("4826", webcrypto);
  const second = await createMerchantPinCredential("4826", webcrypto);

  assert.match(first, /^pbkdf2-sha256\$v1\$600000\$/);
  assert.notEqual(first, second);
  assert.equal(isMerchantPinCredential(first), true);
  assert.equal(await verifyMerchantPin("4826", first, webcrypto), true);
  assert.equal(await verifyMerchantPin("4827", first, webcrypto), false);
});

test("PIN creation rejects values outside the explicit 4-to-6 digit policy", async () => {
  await assert.rejects(() => createMerchantPinCredential("123", webcrypto), /4 to 6 digits/i);
  await assert.rejects(() => createMerchantPinCredential("1234567", webcrypto), /4 to 6 digits/i);
  await assert.rejects(() => createMerchantPinCredential("12a4", webcrypto), /4 to 6 digits/i);
});

test("malformed or downgraded credentials fail closed", async () => {
  const malformed = [
    "",
    "plain-text-pin",
    "pbkdf2-sha1$v1$600000$c2FsdA==$ZGlnZXN0",
    "pbkdf2-sha256$v2$600000$c2FsdA==$ZGlnZXN0",
    "pbkdf2-sha256$v1$10$c2FsdA==$ZGlnZXN0",
    "pbkdf2-sha256$v1$600000$***$***",
  ];

  for (const credential of malformed) {
    assert.equal(isMerchantPinCredential(credential), false);
    assert.equal(await verifyMerchantPin("4826", credential, webcrypto), false);
  }
});

test("PIN storage explains when secure Web Crypto is unavailable", async () => {
  await assert.rejects(
    () => createMerchantPinCredential("4826", null),
    /HTTPS or localhost/i,
  );
});
