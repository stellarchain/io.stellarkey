import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("tracked release text uses only the StellarKey namespace", () => {
  const oldNamespace = ["pola", "ris"].join("");
  const textExtensions = /\.(?:css|html|js|json|md|mjs|ts|tsx|txt|webmanifest|ya?ml)$/i;
  const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter((file) => file && textExtensions.test(file));
  const offenders = files.filter((file) =>
    readFileSync(new URL(`../${file}`, import.meta.url), "utf8")
      .toLowerCase()
      .includes(oldNamespace),
  );
  assert.deepEqual(offenders, []);
});

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

test("main and tagged releases require the pinned Private Payments Gate A", () => {
  const pinnedCiverCommit = "af7d4ed0325e6f7743d8a1ac0e415d0c69b8aae8";
  const workflows = [
    read(".github/workflows/ci.yml"),
    read(".github/workflows/release.yml"),
  ];

  for (const workflow of workflows) {
    assert.match(workflow, /private-gate-a:/);
    assert.match(workflow, /https:\/\/github\.com\/costa-group\/circom_civer\.git/);
    assert.match(workflow, new RegExp(pinnedCiverCommit));
    assert.match(workflow, /CIVER_CIRCOM:/);
    assert.match(workflow, /CIVER_SOURCE_COMMIT:/);
    assert.match(workflow, /npm run private:gate-a/);
    assert.doesNotMatch(
      workflow,
      /^ {4}env:\s*\n {6}CIVER_CIRCOM:\s*\$\{\{\s*runner\.temp\s*\}\}/m,
      "runner.temp is unavailable in a job-level env block",
    );
    assert.match(
      workflow,
      /^ {6}- run: npm run private:gate-a\s*\n {8}env:\s*\n {10}CIVER_CIRCOM:\s*\$\{\{\s*runner\.temp\s*\}\}\/circom_civer\/target\/release\/civer_circom$/m,
      "the analyzer path must be resolved from runner.temp at step scope",
    );
  }

  assert.match(workflows[1], /release:\s*\n\s*needs:\s*private-gate-a/);
});

test("CI verifies pull-request branches once and main after merge", () => {
  const ci = read(".github/workflows/ci.yml");

  assert.match(ci, /push:\s*\n\s*branches:\s*\["main"\]/);
  assert.match(ci, /pull_request:\s*\n\s*branches:\s*\["main"\]/);
  assert.match(ci, /concurrency:\s*\n\s*group:\s*ci-/);
  assert.match(ci, /cancel-in-progress:\s*true/);
});

test("clean CI runs generated bundle assertions only after the static build", () => {
  const ci = read(".github/workflows/ci.yml");
  const pkg = JSON.parse(read("package.json"));

  assert.equal(existsSync(new URL("../tests/bundle-budget.test.mjs", import.meta.url)), false);
  assert.equal(existsSync(new URL("../tests/bundle-budget.build.mjs", import.meta.url)), true);
  assert.match(pkg.scripts.test, /tests\/\*\.test\.mjs/);
  assert.match(pkg.scripts["test:bundle"], /tests\/bundle-budget\.build\.mjs/);
  assert.match(
    pkg.scripts["release:verify"],
    /npm test.*npm run build.*npm run test:bundle.*npm run check:bundle.*playwright test/,
  );
  assert.match(
    ci,
    /npm test[\s\S]*npm run build[\s\S]*npm run test:bundle[\s\S]*npm run check:bundle[\s\S]*npm exec -- playwright test/,
  );
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

test("browser verification is runner-owned instead of ad-hoc", () => {
  const scripts = readdirSync(new URL("../scripts/", import.meta.url), {
    withFileTypes: true,
  })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".mjs"))
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(scripts, [
    "assert-clean-release.mjs",
    "check-bundle-budget.mjs",
    "create-release-artifact.mjs",
    "generate-service-worker.mjs",
    "generate-static-headers.mjs",
    "render-app-icons.mjs",
    "static-server.mjs",
  ]);
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.devDependencies.playwright, undefined);
  assert.match(pkg.scripts["test:e2e"], /playwright test/);
});

test("obsolete promo and scaffold artifacts stay out of the release tree", () => {
  const retiredAgentPolicy = ["CLA", "UDE.md"].join("");
  for (const path of [
    ".playwright-mcp",
    retiredAgentPolicy,
    "scripts/promo",
    "docs/plans",
    "docs/private-payments-improvements.md",
    "docs/unified-private-assets-design.md",
    "docs/unified-private-assets-implementation.md",
    "protocol/private-balance/docs/plan.md",
    "protocol/private-balance/docs/plans",
    "public/file.svg",
    "public/globe.svg",
    "public/next.svg",
    "public/vercel.svg",
    "public/window.svg",
    "public/app-screen-verification.png",
    "public/icon-verification.png",
  ]) {
    assert.equal(existsSync(new URL(`../${path}`, import.meta.url)), false, path);
  }

  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.scripts["icons:render"], "node scripts/render-app-icons.mjs");

  const gitignore = read(".gitignore");
  assert.match(gitignore, /^\/\.playwright-mcp\/$/m);
  assert.match(gitignore, /^\/blob-report\/$/m);
  assert.match(gitignore, /^\*\.log$/m);
  assert.match(gitignore, /^\*\.trace$/m);
});

test("merchant persistence validates only the current production schema", () => {
  const storage = read("src/lib/merchant/storage.ts");
  const schema = read("src/lib/merchant/schema.ts");
  const types = read("src/lib/merchant/types.ts");
  const testingGuide = read("docs/testing.md");

  assert.doesNotMatch(
    `${storage}\n${schema}`,
    /legacy(?:-order|-staff|-export|:)|during migration|v1\/v2 read/i,
  );
  assert.match(storage, /return isCurrentMerchantStore\(value\) \? value : null/);
  assert.match(schema, /objectOf<Merchant\.MerchantStore>/);
  assert.doesNotMatch(types, /versioned for migration/i);
  assert.doesNotMatch(testingGuide, /storage, migrations, encryption/i);
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
