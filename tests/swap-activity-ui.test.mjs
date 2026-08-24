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
  assert.ok((dashboard.match(/<ActivityAmountDisplay/g) ?? []).length >= 2);
  assert.match(dashboard, /activityAmountLines\(item\)/);
  assert.match(dashboard, /line\.direction === "out"\s*\?\s*"text-\[#FF453A\]"\s*:\s*"text-\[#30D158\]"/);
  assert.match(dashboard, /activityFilter === "swap" && !a\.swap/);
  assert.match(dashboard, /neutral\s*\?\s*\(\s*<IconSwap size=\{12\}/);
  assert.match(detail, /const amountLines = activityAmountLines\(item\)/);
  assert.match(detail, /amountLines\.map\(\(line\)/);
  assert.doesNotMatch(detail, /item\.swap[\s\S]*?direction:\s*"neutral"/);
});
