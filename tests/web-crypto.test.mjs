import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { requireWebCrypto } from "../src/lib/web-crypto.ts";

test("wallet crypto explains the secure-context requirement before using subtle crypto", () => {
  assert.throws(
    () => requireWebCrypto(null),
    /HTTPS or localhost/i,
  );

  const hd = readFileSync(new URL("../src/lib/hd.ts", import.meta.url), "utf8");
  const crypto = readFileSync(new URL("../src/lib/crypto.ts", import.meta.url), "utf8");
  assert.match(hd, /requireWebCrypto/);
  assert.match(crypto, /requireWebCrypto/);
  assert.doesNotMatch(hd, /crypto\.subtle/);
  assert.doesNotMatch(crypto, /crypto\.subtle/);
});
