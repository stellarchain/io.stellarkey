import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Playwright owns the production browser-test server and release command", () => {
  assert.equal(existsSync(new URL("../playwright.config.ts", import.meta.url)), true);
  const config = source("playwright.config.ts");
  const pkg = JSON.parse(source("package.json"));
  const ci = source(".github/workflows/ci.yml");

  assert.match(config, /webServer:/);
  assert.match(config, /npm run start/);
  assert.match(
    config,
    /reuseExistingServer:\s*false/,
    "browser tests must never reuse a server that may expose a stale release",
  );
  assert.match(pkg.scripts["test:e2e"], /playwright test/);
  assert.match(ci, /npm run build[\s\S]*playwright test/);
  assert.doesNotMatch(ci, /npm run test:e2e/);
  assert.doesNotMatch(ci, /test:e2e:merchant/);
});

test("wallet and merchant journeys run through Playwright fixtures", () => {
  assert.equal(existsSync(new URL("../e2e/fixtures.ts", import.meta.url)), true);
  assert.equal(existsSync(new URL("../e2e/wallet.spec.ts", import.meta.url)), true);
  assert.match(source("e2e/merchant.spec.ts"), /@playwright\/test/);
  assert.doesNotMatch(source("e2e/merchant.spec.ts"), /spawn\(|next\/dist\/bin\/next/);
  assert.match(source("e2e/wallet.spec.ts"), /corrupt|recovery/i);
  assert.match(source("e2e/wallet.spec.ts"), /Review Transfer/);
  assert.match(source("e2e/wallet.spec.ts"), /Review Swap/);
});
