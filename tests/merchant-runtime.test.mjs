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
  assert.doesNotMatch(page, /ForegroundMonitoringStatus/);
  assert.match(hook, /visibilitychange/);
  assert.match(hook, /document\.visibilityState === "visible"/);
  assert.match(hook, /releaseWatcherLease/);
  assert.match(page, /phase === "locked"/);
  assert.doesNotMatch(settings, /OfflineStatesGallery|"states"/);
  assert.doesNotMatch(merchantSettings, /MOCK_PERIPHERALS|MOCK_STAFF|MOCK_TERMINAL|States & offline/);
});

test("screen awake protection is scoped to an active checkout", () => {
  const page = source("src/components/merchant/MerchantPage.tsx");
  const checkout = source("src/components/merchant/ChargeSheet.tsx");
  const offlineStates = source("src/components/merchant/OfflineStates.tsx");

  assert.doesNotMatch(page, /useWakeLock/);
  assert.doesNotMatch(page, /ForegroundMonitoringStatus/);
  assert.match(checkout, /const wakeLock = useWakeLock\(requestAvailable\)/);
  assert.match(checkout, /Watching for payment/);
  assert.match(
    checkout,
    /wakeLock\.state === "error" \|\| wakeLock\.state === "released"/,
  );
  assert.match(checkout, /wakeLock\.retry/);
  assert.doesNotMatch(offlineStates, /Foreground monitoring active/);
  assert.doesNotMatch(offlineStates, /Screen awake protection is on/);
  assert.doesNotMatch(checkout, /dispatchEvent\(new Event\("pointerdown"\)\)/);
});

test("the privacy shield portals above secret-bearing dialogs", () => {
  const dashboard = source("src/components/Dashboard.tsx");
  assert.match(dashboard, /createPortal/);
  assert.match(dashboard, /data-privacy-shield/);
  assert.match(dashboard, /z-\[2147483647\]/);
});

test("merchant blockers offer direct recovery actions", () => {
  const dashboard = source("src/components/Dashboard.tsx");
  const page = source("src/components/merchant/MerchantPage.tsx");
  const till = source("src/components/merchant/PosTerminal.tsx");

  assert.match(
    dashboard,
    /<MerchantPage[\s\S]*?onOpenStaff=\{\(\) => openSettings\("staff"\)\}/,
  );
  assert.match(page, /onOpenStaff: \(\) => void;/);
  assert.match(
    page,
    /chargeBlockedReason\?\.startsWith\("Choose an active staff member"\)/,
  );
  assert.match(page, />\s*Choose staff\s*<\/button>/);
  assert.match(page, /<PosTerminal onOpenShift=\{\(\) => setShiftShowing\(true\)\} \/>/);
  assert.match(till, /onOpenShift: \(\) => void;/);
  assert.match(till, /\{!activeShift && \([\s\S]*?>\s*Open Shift\s*<\/button>[\s\S]*?\)\}/);
  assert.match(till, /min-h-11/);
});

test("merchant context value stays stable across unrelated wallet provider renders", () => {
  const hook = source("src/hooks/useMerchant.tsx");
  const runtime = source("src/hooks/useMerchantRuntime.tsx");
  assert.match(hook, /const value = useMemo<MerchantContextValue>/);
  assert.match(hook, /const shellValue = useMemo<MerchantShellContextValue>/);
  assert.match(hook, /const settingsValue = useMemo<MerchantSettingsContextValue>/);
  assert.match(runtime, /useMerchantShell/);
  assert.match(runtime, /useMerchantSettings/);
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
  const setup = source("src/components/merchant/SetupWizardBody.tsx");
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

test("tracked wallet broadcasts retain revocable signing-boundary checks", () => {
  const wallet = source("src/hooks/useWallet.tsx");
  const api = source("src/lib/api.ts");

  assert.match(wallet, /authorizeBeforeSigning/);
  assert.match(api, /beforeSign/);

  const trackedBroadcast = wallet.split("const runTrackedBroadcast = useCallback")[1]
    ?.split("const retryPendingTransaction")[0] ?? "";
  assert.match(trackedBroadcast, /createSessionRevocationGuard\(\)/);
  assert.ok(
    trackedBroadcast.indexOf("journal?.onPrepared") < trackedBroadcast.indexOf("assertSessionCurrent"),
    "session authority must be checked after durable preparation",
  );
  assert.match(trackedBroadcast, /beforeSubmit\?\.\(\)/);
});

test("merchant pricing is refreshed and expires before it can quote Mainnet sales", () => {
  const hook = source("src/hooks/useMerchant.tsx");
  assert.match(hook, /fetchAssetPriceSamples/);
  assert.match(hook, /setInterval\(refreshPrices, MERCHANT_PRICE_REFRESH_MS\)/);
  assert.match(hook, /quoteCurrencyPerUnit\([\s\S]{0,200}xlmPriceSample, fiatRateSamples/);
  assert.doesNotMatch(hook, /setAssetPricesObservedAt/);
  const quoteInputs = hook.split("const quoteInputs = useCallback")[1]?.split("/* ---------------- invoices")[0] ?? "";
  assert.match(quoteInputs, /rateFor\(asset\)/);
  const merchantPage = source("src/components/merchant/MerchantPage.tsx");
  assert.match(merchantPage, /retryMarketPrices/);
  assert.match(merchantPage, /Retry Prices/);
  assert.match(hook, /Promise\.all\(\[refreshPrices\(\), refreshMarketData\(\)\]\)/);
});

test("retained record export entrypoints use the shared current-authority boundary", () => {
  const hook = source("src/hooks/useMerchant.tsx");
  const archive = hook.split("const exportEncryptedArchive = useCallback")[1]
    ?.split("const resetRecoveryData")[0] ?? "";
  assert.ok((archive.match(/requireExportingStaff/g) ?? []).length >= 2);
  assert.match(hook, /const exportInvoiceRecord = useCallback/);
  assert.match(hook, /requireExportingStaff/);
  assert.match(source("src/components/merchant/InvoiceDetailModal.tsx"), /exportInvoiceRecord\(invoice\.id\)/);
});

test("terminal identity cannot change during an open shift", () => {
  const hook = source("src/hooks/useMerchant.tsx");
  const settings = hook.split("const updateSettings = useCallback")[1]
    ?.split("const upsertItem")[0] ?? "";
  assert.match(settings, /activeShiftForTerminal/);
  assert.match(settings, /Close the current shift before renaming this terminal/i);
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
