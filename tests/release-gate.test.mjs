import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the release browser matrix includes Chromium plus WebKit phone and tablet", () => {
  const config = read("playwright.config.ts");
  assert.match(config, /desktop-chromium/);
  assert.match(config, /iphone-webkit/);
  assert.match(config, /ipad-webkit/);
  assert.match(config, /devices\["iPhone/);
  assert.match(config, /devices\["iPad/);
});

test("iPhone WebKit gates payment catch-up after a mobile reload", () => {
  const config = read("playwright.config.ts");
  assert.match(config, /iphone-webkit[\s\S]*testMatch:[^\n]*merchant-webkit/);
  assert.match(config, /iPhone 16[^\n]*serviceWorkers: "block"/);
  assert.equal(existsSync(new URL("../e2e/merchant-webkit.spec.ts", import.meta.url)), true);
  const smoke = read("e2e/merchant-webkit.spec.ts");
  assert.match(smoke, /page\.reload/);
  assert.match(smoke, /incoming\.push/);
  assert.match(smoke, /Paid in full/);
});

test("CI pins third-party actions and verifies the complete static release", () => {
  const ci = read(".github/workflows/ci.yml");
  assert.match(ci, /actions\/checkout@[0-9a-f]{40}/);
  assert.match(ci, /actions\/setup-node@[0-9a-f]{40}/);
  assert.match(ci, /corepack install[\s\S]*corepack npm ci/);
  assert.match(ci, /playwright install --with-deps chromium webkit/);
  assert.match(ci, /npm run check:bundle/);
  assert.match(ci, /test -f out\/index\.html/);
  assert.doesNotMatch(ci, /uses:\s+[^\n]+@v\d+/);
});

test("the toolchain and dependency lifecycle approvals are explicit", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.match(pkg.packageManager, /^npm@\d+\.\d+\.\d+$/);
  assert.match(pkg.engines.node, /22\.22\.2/);
  assert.match(pkg.scripts["release:verify"], /check:bundle.*playwright test/);
  assert.ok(Object.keys(pkg.allowScripts).length > 0);
  assert.equal(Object.values(pkg.allowScripts).every((approved) => approved === true), true);
  assert.equal(Object.keys(pkg.allowScripts).every((key) => /@\d/.test(key)), true);
});

test("manual browser, hardware, and backend-free boundaries have a release checklist", () => {
  assert.equal(existsSync(new URL("../docs/release-checklist.md", import.meta.url)), true);
  const checklist = read("docs/release-checklist.md");
  assert.match(checklist, /real iPhone/i);
  assert.match(checklist, /Trezor/);
  assert.match(checklist, /foreground-only/i);
  assert.match(checklist, /pinch zoom remains disabled/i);
  assert.match(checklist, /backup envelope version 2/i);
  assert.match(checklist, /legacy plaintext version 1[^\n]*not supported/i);
});

test("settings do not navigate into unimplemented product surfaces", () => {
  const settings = read("src/components/SettingsPage.tsx");
  assert.doesNotMatch(settings, /Wallet Standard dApp sessions are not implemented/);
  assert.doesNotMatch(settings, /Soroban invocation and RPC simulation are not wired/);
  assert.doesNotMatch(settings, /setSub\("dapps"\)|setSub\("soroban"\)/);
});

test("unreachable deleted-vault and legacy biometric contracts are gone", () => {
  const vault = read("src/lib/vault.ts");
  const wallet = read("src/hooks/useWallet.tsx");
  assert.doesNotMatch(vault, /TRASH_KEY|BIOMETRICS_KEY|hasDeletedVault|restoreDeletedVault/);
  assert.doesNotMatch(wallet, /hasDeletedWalletBackup|restoreDeletedWallet/);
});
