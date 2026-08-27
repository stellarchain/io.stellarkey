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

test("leaf wallet consumers avoid the compatibility-wide subscription", () => {
  assert.doesNotMatch(source("src/components/FiatValue.tsx"), /\buseWallet\(\)/);
  assert.doesNotMatch(source("src/components/CurrencyConverterModal.tsx"), /\buseWallet\(\)/);
  assert.doesNotMatch(source("src/components/TxDetailModal.tsx"), /\buseWallet\(\)/);
  assert.doesNotMatch(source("src/components/AddressBookPage.tsx"), /\buseWallet\(\)/);
  assert.doesNotMatch(source("src/components/SendModal.tsx"), /\buseWallet\(\)/);
  assert.doesNotMatch(source("src/components/BatchSendModal.tsx"), /\buseWallet\(\)/);
  assert.doesNotMatch(source("src/components/SwapPage.tsx"), /\buseWallet\(\)/);
});
