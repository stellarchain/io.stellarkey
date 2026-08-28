import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("wallet state is partitioned by update cadence and responsibility", () => {
  const wallet = source("src/hooks/useWallet.tsx");
  for (const hook of [
    "useWalletIdentity",
    "useWalletLedger",
    "useWalletActivity",
    "useWalletSubmission",
    "useWalletMarket",
    "useWalletPreferences",
    "useWalletContacts",
    "useWalletTransactions",
    "useWalletPhase",
    "useWalletLifecycleActions",
  ]) {
    assert.match(wallet, new RegExp(`export function ${hook}\\(`));
  }
  assert.match(wallet, /const WalletIdentityContext = createContext/);
  assert.match(wallet, /const WalletLedgerContext = createContext/);
  assert.match(wallet, /const WalletMarketContext = createContext/);
  assert.match(wallet, /const WalletTransactionsContext = createContext/);
});

test("the merchant runtime subscribes only to the wallet domains it consumes", () => {
  const merchant = source("src/hooks/useMerchant.tsx");
  assert.doesNotMatch(merchant, /\buseWallet\(\)/);
  assert.match(merchant, /useWalletIdentity\(\)/);
  assert.match(merchant, /useWalletLedger\(\)/);
  assert.match(merchant, /useWalletMarket\(\)/);
  assert.match(merchant, /useWalletContacts\(\)/);
  assert.match(merchant, /useWalletSubmission\(\)/);
  assert.match(merchant, /useWalletTransactions\(\)/);
});

test("merchant screens never subscribe to the compatibility-wide wallet context", () => {
  const directory = new URL("../src/components/merchant/", import.meta.url);
  for (const name of readdirSync(directory).filter((entry) => entry.endsWith(".tsx"))) {
    assert.doesNotMatch(source(`src/components/merchant/${name}`), /\buseWallet\(\)/, name);
  }
});

test("merchant state is partitioned into stable business domains", () => {
  const merchant = source("src/hooks/useMerchant.tsx");
  for (const context of [
    "MerchantStatusContext",
    "MerchantConfigurationContext",
    "MerchantStaffContext",
    "MerchantTillContext",
    "MerchantRecordsContext",
    "MerchantReportingContext",
  ]) {
    assert.match(merchant, new RegExp(`const ${context} = createContext`));
  }
  for (const hook of [
    "useMerchantStatus",
    "useMerchantConfiguration",
    "useMerchantStaff",
    "useMerchantTill",
    "useMerchantRecords",
    "useMerchantReporting",
  ]) {
    assert.match(merchant, new RegExp(`export function ${hook}\\(`));
  }
});

test("merchant screens avoid the compatibility-wide subscription", () => {
  const directory = new URL("../src/components/merchant/", import.meta.url);
  for (const name of readdirSync(directory).filter((entry) => entry.endsWith(".tsx"))) {
    assert.doesNotMatch(source(`src/components/merchant/${name}`), /\buseMerchant\s*\(/, name);
  }
});

test("merchant domain subscriptions exclude unrelated high-frequency state", () => {
  const merchant = source("src/hooks/useMerchant.tsx");
  const configuration = merchant.match(
    /const configurationValue = useMemo<MerchantConfigurationValue>\(([\s\S]*?)\n  \);/,
  )?.[1];
  const reporting = merchant.match(
    /const reportingValue = useMemo<MerchantReportingValue>\(([\s\S]*?)\n  \);/,
  )?.[1];
  const till = merchant.match(
    /const tillValue = useMemo<MerchantTillValue>\(([\s\S]*?)\n  \);/,
  )?.[1];
  assert.ok(configuration, "configuration context value is memoized");
  assert.ok(reporting, "reporting context value is memoized");
  assert.ok(till, "till context value is memoized");
  assert.doesNotMatch(configuration, /\breportingNow\b|\btoday\b|\bticket\b/);
  assert.doesNotMatch(reporting, /\bticket\b/);
  assert.doesNotMatch(till, /\breportingNow\b|\btoday\b/);
});

test("leaf wallet consumers avoid the compatibility-wide subscription", () => {
  assert.doesNotMatch(source("src/components/FiatValue.tsx"), /\buseWallet\(\)/);
  assert.doesNotMatch(source("src/components/CurrencyConverterModal.tsx"), /\buseWallet\(\)/);
  assert.doesNotMatch(source("src/components/TxDetailModal.tsx"), /\buseWallet\(\)/);
  assert.doesNotMatch(source("src/components/AddressBookPage.tsx"), /\buseWallet\(\)/);
  assert.doesNotMatch(source("src/components/SendModal.tsx"), /\buseWallet\(\)/);
  assert.doesNotMatch(source("src/components/BatchSendModal.tsx"), /\buseWallet\(\)/);
  assert.doesNotMatch(source("src/components/SwapPage.tsx"), /\buseWallet\(\)/);
});
