import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { formatXlmFeeFiatValue } from "../src/lib/fee-equivalent.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

test("XLM fee equivalents preserve stroop precision in the selected local currency", () => {
  assert.equal(
    formatXlmFeeFiatValue("0.0000001", 0.25, "USD", { USD: 1 }),
    "$0.00000003",
  );
  assert.equal(
    formatXlmFeeFiatValue("0.00001", 0.25, "GBP", { GBP: 0.78 }),
    "£0.00000195",
  );
  assert.equal(
    formatXlmFeeFiatValue("0.0000777", 0.25, "EUR", { EUR: 0.92 }),
    "€0.00001787",
  );
  assert.equal(formatXlmFeeFiatValue("bad", 0.25, "USD", { USD: 1 }), null);
  assert.equal(
    formatXlmFeeFiatValue("922337203685.4775807", 0.25, "USD", { USD: 1 }),
    null,
  );
  assert.equal(formatXlmFeeFiatValue("0.00001", null, "USD", { USD: 1 }), null);
  assert.equal(
    formatXlmFeeFiatValue("0.00001", 0.25, "GBP", { USD: 1 }),
    "Rate unavailable",
  );
});

test("fee equivalent is granular, testnet-capable, and privacy-aware", () => {
  const component = read("src/components/XlmFeeFiatValue.tsx");
  const formatter = read("src/lib/fee-equivalent.ts");

  assert.match(component, /useWalletMarket\(\)/);
  assert.match(component, /useWalletPreferences\(\)/);
  assert.match(component, /if \(privacyMode\) return null/);
  assert.match(component, /Local rate unavailable/);
  assert.match(formatter, /fmtFiatMarketPrice/);
  assert.match(formatter, /amountToStroops/);
  assert.doesNotMatch(component, /fetchAssetPrices|getUnitPrice|useWallet\(\)/);
});

test("every numeric wallet fee surface includes its local-currency equivalent", () => {
  const inventory = [
    ["src/components/AddAssetModal.tsx", 1],
    ["src/components/AssetDetailModal.tsx", 1],
    ["src/components/BatchSendModal.tsx", 2],
    ["src/components/ClaimableBalancesModal.tsx", 1],
    ["src/components/MultiSigStudioModal.tsx", 1],
    ["src/components/NetworkStatsModal.tsx", 2],
    ["src/components/SendModal.tsx", 4],
    ["src/components/SettingsPage.tsx", 3],
    ["src/components/SwapPage.tsx", 3],
    ["src/features/private-balance/components/PrivateActionReview.tsx", 2],
    ["src/features/private-balance/components/StealthReceipts.tsx", 1],
    ["src/features/private-balance/components/PrivateActionError.tsx", 1],
  ];

  for (const [relativePath, minimumUses] of inventory) {
    const source = read(relativePath);
    const uses = source.match(/<XlmFeeFiatValue\b/g)?.length ?? 0;
    assert.ok(
      uses >= minimumUses,
      `${relativePath} should render at least ${minimumUses} local fee equivalent(s); found ${uses}`,
    );
  }
});
