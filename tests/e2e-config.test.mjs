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
  assert.match(ci, /npm run build[\s\S]*npm exec -- playwright test/);
  assert.doesNotMatch(ci, /^\s*- run: playwright test$/m);
  assert.doesNotMatch(ci, /^\s*- run: npm run test:e2e\s*$/m);
  assert.doesNotMatch(ci, /test:e2e:merchant/);
  assert.match(
    ci,
    /npm exec -- playwright test[\s\S]*npm run test:e2e:private-ui/,
    "the production suite must remain server-owned and the dev-only private surface must run separately",
  );
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

test("the accessibility journey waits for asynchronous send readiness", () => {
  const accessibility = source("e2e/accessibility.spec.ts");

  assert.match(
    accessibility,
    /const reviewTransfer = send\.getByRole\("button", \{ name: "Review Transfer" \}\);\s*await expect\(reviewTransfer\)\.toBeEnabled\(\{ timeout: 30_000 \}\);\s*await reviewTransfer\.click\(\);/,
  );
});

test("the Private Payments catalogue-tamper browser gate cannot silently skip", () => {
  const security = source("e2e/private-manifest-security.spec.ts");
  const pkg = JSON.parse(source("package.json"));
  const ci = source(".github/workflows/ci.yml");
  const release = source(".github/workflows/release.yml");

  assert.doesNotMatch(security, /PRIVATE_BALANCE_E2E|privateBalanceE2eEnabled|test\.skip/);
  assert.doesNotMatch(security, /if\s*\(await .*isVisible/);
  assert.match(security, /\/protocol\/private-balance\/v1\/catalogue\.json/);
  assert.match(security, /catalogue\.deployments =/);
  assert.match(security, /manifestRequested/);
  assert.match(security, /expect\(await manifestRequested\)\.toBe\(false\)/);
  assert.match(security, /Open private XLM/);
  assert.match(pkg.scripts["test:e2e:private-ui"], /private-manifest-security\.spec\.ts/);
  assert.match(ci, /npm run test:e2e:private-ui/);
  assert.match(release, /npm run release:verify/);
});

test("accessibility coverage uses bounded wallet and merchant scenarios", () => {
  const accessibility = source("e2e/accessibility.spec.ts");

  assert.doesNotMatch(accessibility, /critical wallet and merchant screens remain operable/);
  for (const title of [
    "critical wallet screens remain operable and accessible",
    "critical wallet settings remain operable and accessible",
    "critical merchant screens remain operable and accessible",
    "critical merchant settings remain operable and accessible",
  ]) {
    assert.match(accessibility, new RegExp(`test\\("${title}"`));
  }
});
