import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertJourneyJavaScriptBudgets,
  assertInitialJavaScriptBudget,
  assertLandingJavaScriptBudget,
  INITIAL_JS_GZIP_BUDGET,
  INITIAL_JS_RAW_BUDGET,
  JOURNEY_BUDGETS,
  LANDING_JS_GZIP_BUDGET,
  LANDING_JS_RAW_BUDGET,
  measureJourneyJavaScript,
  measureInitialJavaScript,
  measureLandingJavaScript,
} from "../scripts/check-bundle-budget.mjs";

test("the static entry route stays inside an explicit JavaScript budget", () => {
  const measurement = measureInitialJavaScript();
  assert.ok(measurement.chunkCount > 0);
  assert.doesNotThrow(() => assertInitialJavaScriptBudget(measurement));
  assert.ok(measurement.rawBytes <= INITIAL_JS_RAW_BUDGET);
  assert.ok(measurement.gzipBytes <= INITIAL_JS_GZIP_BUDGET);
});

test("the public landing page stays inside its own JavaScript budget", () => {
  const measurement = measureLandingJavaScript();
  assert.ok(measurement.chunkCount > 0);
  assert.doesNotThrow(() => assertLandingJavaScriptBudget(measurement));
  assert.ok(measurement.rawBytes <= LANDING_JS_RAW_BUDGET);
  assert.ok(measurement.gzipBytes <= LANDING_JS_GZIP_BUDGET);
});

test("release scripts and lazy boundaries keep optional domains out of startup", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const page = readFileSync(new URL("../src/app/app/page.tsx", import.meta.url), "utf8");
  const walletApp = readFileSync(new URL("../src/components/WalletApp.tsx", import.meta.url), "utf8");
  const onboarding = readFileSync(new URL("../src/components/Onboarding.tsx", import.meta.url), "utf8");
  const walletHook = readFileSync(new URL("../src/hooks/useWallet.tsx", import.meta.url), "utf8");

  assert.match(pkg.scripts["check:bundle"], /check-bundle-budget/);
  assert.doesNotMatch(page, /MerchantProvider/);
  assert.match(walletApp, /dynamic\(.*UnlockedWalletShell/s);
  assert.match(walletApp, /useWalletPhase/);
  assert.match(onboarding, /useWalletLifecycleActions/);
  assert.match(walletHook, /WalletLifecycleActionsContext/);
  assert.match(walletHook, /loadWalletApi\(\)/);
  assert.match(walletHook, /loadSwapApi\(\)/);
  assert.match(walletHook, /loadMultisigApi\(\)/);
  assert.doesNotMatch(onboarding, /import \{[^}]*connectTrezorDevice[^}]*\} from "@\/lib\/hardware"/s);
});

test("the production graph budgets initial, unlocked, merchant, and hardware journeys", () => {
  const measurements = measureJourneyJavaScript();
  assert.deepEqual(Object.keys(measurements), ["initial", "unlocked", "merchant", "hardware"]);
  for (const [journey, measurement] of Object.entries(measurements)) {
    assert.ok(measurement.chunkCount > 0, `${journey} must resolve at least one chunk`);
    assert.ok(measurement.rawBytes <= JOURNEY_BUDGETS[journey].rawBytes);
    assert.ok(measurement.gzipBytes <= JOURNEY_BUDGETS[journey].gzipBytes);
  }
  const unlockedSource = measurements.unlocked.sources
    .map((source) => readFileSync(new URL(`../out/${source}`, import.meta.url), "utf8"))
    .join("\n");
  const merchantSource = measurements.merchant.sources
    .map((source) => readFileSync(new URL(`../out/${source}`, import.meta.url), "utf8"))
    .join("\n");
  // The thin unlocked boundary must name the async export, but the provider's
  // storage-conflict implementation belongs only to the merchant journey.
  assert.doesNotMatch(unlockedSource, /writer_unavailable/);
  assert.match(merchantSource, /writer_unavailable/);
  assert.doesNotThrow(() => assertJourneyJavaScriptBudgets(measurements));
});

test("an oversized dynamic merchant chunk fails its named journey budget", async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), "stellarkey-bundle-budget-"));
  const output = path.join(fixture, "out");
  const chunks = path.join(output, "_next", "static", "chunks");
  const buildPage = path.join(fixture, ".next", "server", "app", "app", "page");
  try {
    await mkdir(chunks, { recursive: true });
    await mkdir(buildPage, { recursive: true });
    await writeFile(
      path.join(output, "app.html"),
      '<script src="/_next/static/chunks/initial.js"></script>',
    );
    await writeFile(
      path.join(chunks, "initial.js"),
      [
        '901,e=>{e.v(t=>Promise.all(["static/chunks/unlocked.js"].map(t=>e.l(t))).then(()=>t(1)))}',
        '902,e=>{e.v(t=>Promise.all(["static/chunks/merchant.js"].map(t=>e.l(t))).then(()=>t(2)))}',
        '903,e=>{e.v(t=>Promise.all(["static/chunks/hardware.js"].map(t=>e.l(t))).then(()=>t(3)))}',
        '904,e=>{e.v(t=>Promise.all(["static/chunks/trezor.js"].map(t=>e.l(t))).then(()=>t(4)))}',
        'let{connectTrezorDevice:x}=await e.A(903)',
      ].join(";"),
    );
    await writeFile(
      path.join(chunks, "unlocked.js"),
      "const open=()=>e.A(902).then(e=>e.MerchantPage);export const UnlockedWalletShell=1;",
    );
    await writeFile(
      path.join(chunks, "merchant.js"),
      "m".repeat(JOURNEY_BUDGETS.merchant.rawBytes + 1),
    );
    await writeFile(path.join(chunks, "hardware.js"), "e.A(904)");
    await writeFile(path.join(chunks, "trezor.js"), "trezor");
    await writeFile(
      path.join(buildPage, "react-loadable-manifest.json"),
      JSON.stringify({ 901: { id: 901, files: ["static/chunks/unlocked.js"] } }),
    );

    const measurements = measureJourneyJavaScript(output, path.join(fixture, ".next"));
    assert.deepEqual(
      measurements.hardware.sources.map((source) => path.basename(source)).sort(),
      ["hardware.js", "trezor.js"],
    );
    assert.throws(
      () => assertJourneyJavaScriptBudgets(measurements),
      /Merchant JavaScript budget failed.*raw bytes/i,
    );
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
