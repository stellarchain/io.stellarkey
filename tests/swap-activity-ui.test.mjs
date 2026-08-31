import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

test("swap activity renders one bank-style debit and credit pair", () => {
  const dashboard = read("src/components/Dashboard.tsx");
  const detail = read("src/components/TxDetailModal.tsx");

  assert.match(dashboard, /function ActivityAmountDisplay\(/);
  assert.match(dashboard, /activityAmountLines\(item\)/);
  assert.match(dashboard, /lines\.map\(\(line\)/);
  assert.match(dashboard, /line\.direction === "out"\s*\?\s*"text-\[#FF453A\]"\s*:\s*"text-\[#30D158\]"/);
  assert.match(dashboard, /activityFilter === "swap" && !a\.swap/);
  assert.match(dashboard, /neutral\s*\?\s*\(\s*<IconSwap size=\{\d+\}/);
  assert.match(detail, /const amountLines = activityAmountLines\(item\)/);
  assert.match(detail, /amountLines\.map\(\(line\)/);
  assert.doesNotMatch(detail, /item\.swap[\s\S]*?direction:\s*"neutral"/);
});

test("activity asset filter keeps asset codes visible beside long issuers", () => {
  const dashboard = read("src/components/Dashboard.tsx");
  const filterStart = dashboard.indexOf("{/* Asset Code Filter */}");
  const filterEnd = dashboard.indexOf("{filteredActivity.length > 0", filterStart);
  const assetFilter = dashboard.slice(filterStart, filterEnd);

  assert.ok(filterStart >= 0 && filterEnd > filterStart, "activity asset filter must exist");
  assert.match(assetFilter, /<Select[\s\S]*?preserveOptionLabels/);
  assert.match(assetFilter, /panelMinWidth=\{240\}/);
});
