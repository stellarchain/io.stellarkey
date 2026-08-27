import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

async function domain() {
  try {
    return await import("../src/lib/merchant/runtime.ts");
  } catch (error) {
    assert.fail(`The merchant runtime domain is missing: ${error instanceof Error ? error.message : error}`);
  }
}

function charge({ id, network = "mainnet", status = "awaiting", expiresAt }) {
  return {
    id,
    orderId: `order_${id}`,
    reference: id.toUpperCase(),
    network,
    destination: "GAVLAAAWTBEO5XJELA3TID4XVHELGTFYRMMFRU2MQ25C5VVCBI476ZVG",
    amountMinor: 100,
    currency: "GBP",
    quotes: [],
    status,
    createdAt: expiresAt - 60_000,
    expiresAt,
    payment: null,
  };
}

test("runtime state separates queued and expired work on the active network", async () => {
  const { merchantRuntimeState } = await domain();
  const now = 2_000_000;
  const state = merchantRuntimeState({
    online: false,
    foreground: false,
    vaultPhase: "locked",
    watchError: "Horizon timed out",
    network: "mainnet",
    now,
    charges: [
      charge({ id: "queued", expiresAt: now + 30_000 }),
      charge({ id: "expired", expiresAt: now - 1 }),
      charge({ id: "paid", status: "paid", expiresAt: now + 30_000 }),
      charge({ id: "testnet", network: "testnet", expiresAt: now + 30_000 }),
    ],
  });
  assert.equal(state.connection, "offline");
  assert.equal(state.queuedChargeCount, 1);
  assert.equal(state.expiredChargeCount, 1);
  assert.equal(state.vaultLocked, true);
  assert.equal(state.monitoring, "paused");
});

test("watcher errors only describe an outage while the browser is online", async () => {
  const { merchantRuntimeState } = await domain();
  const base = {
    vaultPhase: "unlocked",
    foreground: true,
    network: "mainnet",
    now: 1,
    charges: [],
  };
  assert.equal(
    merchantRuntimeState({ ...base, online: true, watchError: "Unavailable" }).connection,
    "watch_error",
  );
  assert.equal(
    merchantRuntimeState({ ...base, online: true, watchError: null }).connection,
    "online",
  );
  assert.equal(
    merchantRuntimeState({ ...base, online: true, watchError: null }).monitoring,
    "foreground",
  );
});

test("browser capabilities never claim unsupported native hardware", async () => {
  const { BROWSER_PERIPHERALS } = await domain();
  const systemPrint = BROWSER_PERIPHERALS.find((item) => item.id === "system-print");
  const scanner = BROWSER_PERIPHERALS.find((item) => item.id === "keyboard-scanner");
  const escpos = BROWSER_PERIPHERALS.find((item) => item.id === "escpos-printer");
  const drawer = BROWSER_PERIPHERALS.find((item) => item.kind === "drawer");
  const externalDisplay = BROWSER_PERIPHERALS.find((item) => item.id === "external-display");
  assert.equal(systemPrint?.connected, true);
  assert.match(systemPrint?.detail ?? "", /AirPrint|print dialog/i);
  assert.equal(scanner?.connected, true);
  assert.equal(escpos?.unavailable, true);
  assert.equal(drawer?.unavailable, true);
  assert.equal(externalDisplay?.unavailable, true);
});

test("keyboard scanner matching is active-only, trimmed, and case-insensitive", async () => {
  const { findScannedCatalogueItem } = await domain();
  const catalogue = [
    { id: "active", name: "Coffee", sku: "BEAN-01", active: true },
    { id: "inactive", name: "Old coffee", sku: "OLD-01", active: false },
  ];
  assert.equal(findScannedCatalogueItem(catalogue, " bean-01 ")?.id, "active");
  assert.equal(findScannedCatalogueItem(catalogue, "OLD-01"), null);
  assert.equal(findScannedCatalogueItem(catalogue, "missing"), null);
});

test("production merchant surfaces use live runtime state and no specimen route", () => {
  const hook = source("src/hooks/useMerchant.tsx");
  const page = source("src/components/merchant/MerchantPage.tsx");
  const settings = source("src/components/SettingsPage.tsx");
  const merchantSettings = source("src/components/merchant/MerchantSettings.tsx");
  assert.match(hook, /navigator\.onLine/);
  assert.match(hook, /setTillTextSize/);
  assert.match(page, /OfflineBanner/);
  assert.match(page, /HorizonOutageNotice/);
  assert.match(page, /ForegroundMonitoringStatus/);
  assert.match(hook, /visibilitychange/);
  assert.match(hook, /document\.visibilityState === "visible"/);
  assert.match(hook, /releaseWatcherLease/);
  assert.match(page, /phase === "locked"/);
  assert.doesNotMatch(settings, /OfflineStatesGallery|"states"/);
  assert.doesNotMatch(merchantSettings, /MOCK_PERIPHERALS|MOCK_STAFF|MOCK_TERMINAL|States & offline/);
});

test("merchant context value stays stable across unrelated wallet provider renders", () => {
  const hook = source("src/hooks/useMerchant.tsx");
  assert.match(hook, /const value = useMemo<MerchantContextValue>/);
  assert.match(hook, /const shellValue = useMemo<MerchantShellContextValue>/);
  assert.match(hook, /const settingsValue = useMemo<MerchantSettingsContextValue>/);
  assert.match(source("src/components/Dashboard.tsx"), /useMerchantShell/);
  assert.match(source("src/components/SettingsPage.tsx"), /useMerchantSettings/);
});

test("persisted merchant record identifiers use Web Crypto randomness", () => {
  const hook = source("src/hooks/useMerchant.tsx");
  const charge = source("src/lib/merchant/charge.ts");
  assert.match(hook, /randomHex/);
  assert.match(charge, /randomHex/);
  assert.doesNotMatch(hook, /Math\.random/);
  assert.doesNotMatch(charge, /Math\.random/);
});

test("merchant PIN disclosures match the encrypted unlocked-storage boundary", () => {
  const setup = source("src/components/merchant/SetupWizard.tsx");
  const staff = source("src/components/merchant/StaffTerminalsPage.tsx");
  for (const disclosure of [setup, staff]) {
    assert.match(disclosure, /encrypted merchant storage/i);
    assert.doesNotMatch(disclosure, /checked while the vault is locked|outside the vault/i);
  }
});

test("customer display exit verifies a real staff PIN and does not show an amountless payment QR", () => {
  const display = source("src/components/merchant/CustomerDisplay.tsx");
  const hook = source("src/hooks/useMerchant.tsx");
  assert.match(display, /unlockCustomerDisplay/);
  assert.match(hook, /verifyMerchantPin/);
  assert.doesNotMatch(display, /Any four digits|buildSep7PayUri|QRCode/);
  assert.match(display, /Same-device display/);
});

test("printing, scanner input, and supported preferences execute real browser paths", () => {
  const peripherals = source("src/components/merchant/PeripheralsPage.tsx");
  const terminal = source("src/components/merchant/PosTerminal.tsx");
  assert.match(peripherals, /window\.print\(\)/);
  assert.match(peripherals, /setTillTextSize/);
  assert.doesNotMatch(peripherals, /MOCK_PERIPHERALS|Would flip|would add it/);
  assert.match(terminal, /event\.key === "Enter"/);
  assert.match(terminal, /findScannedCatalogueItem/);
});
