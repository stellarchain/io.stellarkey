import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  assertInitialJavaScriptBudget,
  INITIAL_JS_GZIP_BUDGET,
  INITIAL_JS_RAW_BUDGET,
  measureInitialJavaScript,
} from "../scripts/check-bundle-budget.mjs";

test("the static entry route stays inside an explicit JavaScript budget", () => {
  const measurement = measureInitialJavaScript();
  assert.ok(measurement.chunkCount > 0);
  assert.doesNotThrow(() => assertInitialJavaScriptBudget(measurement));
  assert.ok(measurement.rawBytes <= INITIAL_JS_RAW_BUDGET);
  assert.ok(measurement.gzipBytes <= INITIAL_JS_GZIP_BUDGET);
});

test("release scripts and lazy boundaries keep optional domains out of startup", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const page = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
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
