import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

async function bootstrapDomain() {
  try {
    return await import("../src/lib/merchant/bootstrap.ts");
  } catch (error) {
    assert.fail(
      `The merchant bootstrap domain is missing: ${error instanceof Error ? error.message : error}`,
    );
  }
}

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

test("merchant bootstrap stores only validated non-sensitive runtime flags", async () => {
  const {
    MERCHANT_BOOTSTRAP_STORAGE_KEY,
    readMerchantBootstrapState,
    writeMerchantBootstrapState,
  } = await bootstrapDomain();
  const storage = memoryStorage();

  assert.equal(readMerchantBootstrapState(storage), null);
  writeMerchantBootstrapState({ enabled: false, configured: true }, storage);
  assert.deepEqual(readMerchantBootstrapState(storage), {
    version: 1,
    enabled: false,
    configured: true,
  });
  assert.deepEqual(JSON.parse(storage.getItem(MERCHANT_BOOTSTRAP_STORAGE_KEY)), {
    version: 1,
    enabled: false,
    configured: true,
  });

  storage.setItem(MERCHANT_BOOTSTRAP_STORAGE_KEY, JSON.stringify({ version: 1, enabled: "yes" }));
  assert.equal(readMerchantBootstrapState(storage), null);
});

test("unavailable browser storage never blocks the wallet shell", async () => {
  const { readMerchantBootstrapState, writeMerchantBootstrapState } = await bootstrapDomain();
  const unavailableStorage = {
    getItem() { throw new DOMException("Storage is disabled", "SecurityError"); },
    setItem() { throw new DOMException("Storage is disabled", "SecurityError"); },
  };

  assert.equal(readMerchantBootstrapState(unavailableStorage), null);
  assert.equal(
    writeMerchantBootstrapState({ enabled: true, configured: true }, unavailableStorage),
    false,
  );
});

test("the unlocked wallet imports only a thin dynamic merchant boundary", () => {
  const shell = source("src/components/UnlockedWalletShell.tsx");
  const boundary = source("src/components/MerchantRuntimeBoundary.tsx");
  const dashboard = source("src/components/Dashboard.tsx");
  const settings = source("src/components/SettingsPage.tsx");
  const provider = source("src/hooks/useMerchant.tsx");

  assert.doesNotMatch(shell, /from "@\/hooks\/useMerchant"/);
  assert.match(shell, /MerchantRuntimeBoundary/);
  assert.match(boundary, /dynamic\([\s\S]*?import\("@\/hooks\/useMerchant"\)/);
  assert.match(dashboard, /from "@\/hooks\/useMerchantRuntime"/);
  assert.match(settings, /from "@\/hooks\/useMerchantRuntime"/);
  assert.match(provider, /writeMerchantBootstrapState/);
  assert.match(provider, /enableOnReady/);
});

test("merchant setup is mounted only after its runtime is requested", () => {
  const dashboard = source("src/components/Dashboard.tsx");
  assert.match(dashboard, /requestRuntime\("setup"\)/);
  assert.match(dashboard, /setupWizardOpen && \(/);
  assert.match(dashboard, /releaseRuntime/);
});
