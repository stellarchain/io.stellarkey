import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("production is deployable as immutable static files without an application server", () => {
  assert.equal(existsSync(new URL("../scripts/generate-static-headers.mjs", import.meta.url)), true);
  assert.equal(existsSync(new URL("../scripts/static-server.mjs", import.meta.url)), true);
  assert.equal(existsSync(new URL("../public/_headers", import.meta.url)), true);

  const headers = read("public/_headers");
  assert.match(headers, /Content-Security-Policy:/);
  assert.match(headers, /Referrer-Policy: strict-origin-when-cross-origin/);
  assert.match(headers, /Cross-Origin-Opener-Policy: same-origin-allow-popups/);
  assert.match(headers, /\/sw\.js[\s\S]*Cache-Control: no-cache, no-store, must-revalidate/);
  assert.doesNotMatch(headers, /nonce-|unsafe-eval/);
  assert.doesNotMatch(headers, /upgrade-insecure-requests/);
});
