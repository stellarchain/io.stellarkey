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
  assert.match(smoke, /Payment received\. Till locked\./);
  assert.match(smoke, /Unlock an authorized staff member to continue\./);
  assert.match(smoke, /Switch to Imported Account/);
});

test("manual release gates preserve the private Rust model evidence", () => {
  const evidence = JSON.parse(read("protocol/private-balance/results/model-100k.json"));
  const scripts = JSON.parse(read("package.json")).scripts;
  assert.equal(evidence.passed, true);
  assert.equal(evidence.dataset.randomizedActions, 100_000);
  assert.match(evidence.sourceCommit, /^[0-9a-f]{40}$/);
  assert.match(scripts["verify:private-model"], /one_hundred_thousand_seeded_actions_recover_exactly_and_detect_corruption -- --ignored --exact/);
});

test("the isolated Private Payments Gate A installs its internal browser package", () => {
  const circuits = JSON.parse(
    read("protocol/private-balance/circuits/package.json"),
  );
  const browser = JSON.parse(
    read("protocol/private-balance/packages/browser/package.json"),
  );
  const actionCircuitTest = read(
    "protocol/private-balance/circuits/test/action.circuit.test.mjs",
  );
  const circuitNpmConfigUrl = new URL(
    "../protocol/private-balance/circuits/.npmrc",
    import.meta.url,
  );
  assert.equal(existsSync(circuitNpmConfigUrl), true);
  const circuitNpmConfig = read("protocol/private-balance/circuits/.npmrc");
  const circuitLock = JSON.parse(
    read("protocol/private-balance/circuits/package-lock.json"),
  );

  assert.equal(
    circuits.dependencies["@stellarkey/private-balance"],
    "file:../packages/browser",
  );
  assert.deepEqual(browser.exports["./note"], {
    types: "./dist/note.d.ts",
    import: "./dist/note.js",
  });
  assert.match(
    actionCircuitTest,
    /from '@stellarkey\/private-balance\/note'/,
  );
  assert.doesNotMatch(
    actionCircuitTest,
    /from '@stellarkey\/private-balance';/,
  );
  assert.match(circuitNpmConfig, /^install-links=true$/m);
  assert.notEqual(
    circuitLock.packages["node_modules/@stellarkey/private-balance"]?.link,
    true,
  );
  assert.equal(
    circuitLock.packages["node_modules/@noble/hashes"]?.version,
    "2.4.0",
  );
});

test("clean release verification runs generated bundle assertions only after the static build", () => {
  const pkg = JSON.parse(read("package.json"));

  assert.equal(existsSync(new URL("../tests/bundle-budget.test.mjs", import.meta.url)), false);
  assert.equal(existsSync(new URL("../tests/bundle-budget.build.mjs", import.meta.url)), true);
  assert.match(pkg.scripts.test, /tests\/\*\.test\.mjs/);
  assert.match(pkg.scripts["test:bundle"], /tests\/bundle-budget\.build\.mjs/);
  assert.match(
    pkg.scripts["verify:application"],
    /npm test.*npm run build.*npm run test:bundle.*npm run check:bundle.*playwright test/,
  );
  assert.match(pkg.scripts["release:verify"], /^node scripts\/assert-clean-release\.mjs && npm run verify:application$/);
});

test("the toolchain and dependency lifecycle approvals are explicit", () => {
  const pkg = JSON.parse(read("package.json"));
  const npmConfig = read(".npmrc");
  assert.match(pkg.packageManager, /^npm@\d+\.\d+\.\d+$/);
  assert.match(pkg.engines.node, /22\.22\.2/);
  assert.match(pkg.scripts["verify:application"], /check:bundle.*playwright test/);
  assert.equal(pkg.allowScripts, undefined, "decorative allowScripts metadata must not imply enforcement");
  assert.match(npmConfig, /^ignore-scripts=true$/m);
});

test("private proving artifacts are provenance-checked in local and release gates", () => {
  const pkg = JSON.parse(read("package.json"));
  const circuits = JSON.parse(read("protocol/private-balance/circuits/package.json"));
  const generatedCheck = read("protocol/private-balance/scripts/check-generated.mjs");
  const setup = read("protocol/private-balance/circuits/scripts/setup-dev.mjs");
  const transcript = read("protocol/private-balance/circuits/scripts/powers-of-tau.mjs");
  const verify = read("protocol/private-balance/circuits/scripts/verify-proving-key.mjs");
  const manifestValidator = read("src/lib/private-balance-manifest.ts");

  assert.match(pkg.scripts["verify:application"], /private:check-generated/);
  assert.match(circuits.scripts["verify:zkey"], /verify-proving-key\.mjs/);
  assert.match(circuits.scripts["gate:a"], /verify:zkey/);
  assert.match(setup, /ensurePowersOfTau/);
  assert.match(transcript, /f807e065fde53f72f4bf4d57140fab85b26daa6cc95bdfec7cce93622b3a367c/);
  assert.match(verify, /zkey["',\s]+verify/);
  assert.match(manifestValidator, /parsed\.status !== 'development'/);
  assert.match(manifestValidator, /parsed\.release\.zkeyVerified !== true/);
  assert.match(manifestValidator, /parsed\.release\.ceremonyTranscriptRoot === '0'\.repeat\(64\)/);
  assert.match(manifestValidator, /parsed\.release\.auditReports\.length === 0/);
  assert.match(manifestValidator, /parsed\.release\.deploymentTransactions\.length === 0/);
  assert.match(generatedCheck, /protocol\/private-balance\/packages\/browser\/dist/);
  assert.equal(pkg.scripts["verify:private-artifacts"], "npm run private:check-reproducible");
  assert.match(pkg.scripts["verify:private-rust"], /cargo \+1\.97\.1 deny check/);
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
    "test-private-components.mjs",
  ]);
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.devDependencies.playwright, undefined);
  assert.match(pkg.scripts["test:e2e"], /playwright test/);
  const components = read('scripts/test-private-components.mjs');
  const componentConfig = read('playwright.private-components.config.ts');
  assert.match(components, /@playwright\/test\/cli\.js/);
  assert.match(components, /COPYFILE_EXCL/);
  assert.match(components, /PRIVATE_COMPONENT_FIXTURE_SHA256/);
  assert.match(components, /finally/);
  assert.match(componentConfig, /screenshot: 'off', trace: 'off', video: 'off'/);
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
  assert.match(checklist, /pinch zoom.*200%/i);
  assert.match(checklist, /backups use the current encrypted version 2 envelope/i);
  assert.match(checklist, /current encrypted version 2 envelope and current-format records/i);
  assert.match(checklist, /Unsupported formats must be rejected without migration or data deletion/i);
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
