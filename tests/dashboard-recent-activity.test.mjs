import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dashboard = readFileSync(path.join(root, "src/components/Dashboard.tsx"), "utf8");

test("home recent activity uses the Activity page ledger row", () => {
  assert.match(dashboard, /function ActivityLedgerRow/);
  assert.equal(
    dashboard.match(/<ActivityLedgerRow/g)?.length,
    2,
    "Home and Activity must render one shared row component",
  );
  assert.match(dashboard, /mergedActivity\.slice\(0, 5\)\.map/);
  assert.match(
    dashboard,
    /className={`row-hover flex min-w-0 w-full overflow-hidden items-center gap-3\.5 px-4 py-3\.5 text-left/,
  );
  assert.match(dashboard, /className="flex h-9 w-9 items-center justify-center rounded-full"/);
});

test("recent activity follows the Your Assets section-header pattern", () => {
  const start = dashboard.indexOf("data-dashboard-recent-activity");
  const end = dashboard.indexOf('view === "activity"', start);
  const section = dashboard.slice(start, end);

  assert.notEqual(start, -1, "Home needs a named recent-activity section");
  assert.match(section, /<h2[^>]*>\s*Recent Activity\s*<\/h2>/);
  assert.match(section, /onClick=\{\(\) => switchTab\("activity"\)\}/);
  assert.match(section, />\s*View All\s*<\/button>/);
  assert.ok(
    section.indexOf("Recent Activity") < section.indexOf('className="list-group"'),
    "the section header must sit above the list surface",
  );
  assert.doesNotMatch(section, /className="panel/);
});

test("activity rows bound and deduplicate long Stellar identifiers", () => {
  const start = dashboard.indexOf("function ActivityLedgerRow");
  const end = dashboard.indexOf("function ActivityAmountDisplay", start);
  const row = dashboard.slice(start, end);

  assert.notEqual(start, -1, "the shared activity row must exist");
  assert.match(
    row,
    /row-hover flex min-w-0 w-full overflow-hidden/,
    "operation metadata must not widen the activity surface",
  );
  assert.match(row, /activityIdentifierLabel\(item, matchedContact, compact\)/);
  assert.match(row, /title=\{identifier\.fullLabel/);
  assert.doesNotMatch(
    row,
    /presentedAsset\.issuerDisplay/,
    "the trustline issuer must not be rendered twice",
  );
  assert.match(row, /className="block truncate text-\[12px\]/);
});

test("activity amounts stay inside a bounded trailing column", () => {
  const start = dashboard.indexOf("function ActivityAmountDisplay");
  const end = dashboard.indexOf("function Chevron", start);
  const amount = dashboard.slice(start, end);

  assert.notEqual(start, -1, "the shared amount display must exist");
  assert.match(amount, /max-w-\[42%\][^"\n]*overflow-hidden/);
  assert.match(amount, /mono block truncate/);
});

test("home rows use tighter exact values while the full Activity page stays unchanged", () => {
  const homeStart = dashboard.indexOf("data-dashboard-recent-activity");
  const activityStart = dashboard.indexOf('view === "activity"', homeStart);
  const home = dashboard.slice(homeStart, activityStart);
  const activity = dashboard.slice(activityStart, dashboard.indexOf("view ===", activityStart + 20));
  const rowStart = dashboard.indexOf("function ActivityLedgerRow");
  const amountStart = dashboard.indexOf("function ActivityAmountDisplay", rowStart);
  const row = dashboard.slice(rowStart, amountStart);
  const amount = dashboard.slice(amountStart, dashboard.indexOf("function Chevron", amountStart));

  assert.match(home, /<ActivityLedgerRow[\s\S]*?\n\s+compact\n/);
  assert.doesNotMatch(activity, /<ActivityLedgerRow[\s\S]*?\n\s+compact\n/);
  assert.match(row, /activityIdentifierLabel\(item, matchedContact, compact\)/);
  assert.match(row, /<ActivityAmountDisplay[\s\S]*?compact=\{compact\}/);
  assert.match(amount, /compact \? "text-\[13px\]" : "text-\[15px\]"/);
  assert.match(amount, /privacyMode \? "••••••" : line\.display/);
  assert.doesNotMatch(amount, /fmtCompactAmount/);
  assert.match(amount, /title=\{compact && !privacyMode/);
});
