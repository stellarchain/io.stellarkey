import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
test("tax records exposes the standalone encrypted operational archive", () => {
  const repository = readFileSync(new URL("../src/lib/merchant/repository.ts", import.meta.url), "utf8");
  const page = readFileSync(new URL("../src/components/merchant/TaxRecordsPage.tsx", import.meta.url), "utf8");
  assert.match(repository, /exportEncryptedArchive/);
  assert.match(page, /Encrypted archive/);
  assert.match(page, /exportEncryptedArchive/);
  assert.match(page, /vault-specific merchant key/i);
  assert.match(page, /does not restore a wallet on its own/i);
  assert.doesNotMatch(page, /password-derived key/i);
});
