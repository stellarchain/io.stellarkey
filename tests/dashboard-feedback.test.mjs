import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

test("the sidebar offers private, user-activated feedback beside the calculator", () => {
  const dashboard = read("src/components/Dashboard.tsx");
  const calculator = dashboard.indexOf('aria-label="Calculator"');
  const feedback = dashboard.indexOf('aria-label="Send feedback"');

  assert.notEqual(calculator, -1, "the calculator action must remain available");
  assert.notEqual(feedback, -1, "the feedback action needs an accessible name");
  assert.ok(feedback > calculator, "feedback must follow the calculator in the sidebar controls");
  assert.ok(feedback - calculator < 1_000, "feedback must remain directly beside the calculator");

  const feedbackControl = dashboard.slice(feedback, feedback + 700);
  assert.match(feedbackControl, /decodeContactAddress\("support"\)/);
  assert.match(feedbackControl, /encodeURIComponent\("StellarKey feedback"\)/);
  assert.doesNotMatch(feedbackControl, /account|publicKey|secret|balance|transaction/i);
});

test("the shared icon set includes a dedicated feedback glyph", () => {
  assert.match(read("src/components/icons.tsx"), /export function IconMessageCircle/);
});

test("the controls above Lock Wallet share accessible hover and focus tooltips", () => {
  const dashboard = read("src/components/Dashboard.tsx");
  const footerStart = dashboard.indexOf("{/* Footer Controls */}");
  const lockWallet = dashboard.indexOf(">Lock Wallet<", footerStart);
  const controls = dashboard.slice(footerStart, lockWallet);

  for (const label of [
    "Refresh network data",
    "Calculator",
    "Send feedback",
  ]) {
    assert.match(controls, new RegExp(`<Tooltip label="${label}"`));
  }
  assert.match(controls, /<Tooltip label={privacyMode \? "Show balances" : "Hide balances"}>/);

  assert.doesNotMatch(controls, /title="(?:Hide|Show|Refresh|Live Currency|Send feedback)/);
});

test("the shared tooltip links its trigger and supports pointer plus keyboard discovery", () => {
  const ui = read("src/components/ui.tsx");

  assert.match(ui, /export function Tooltip/);
  assert.match(ui, /aria-describedby/);
  assert.match(ui, /role="tooltip"/);
  assert.match(ui, /onPointerEnter/);
  assert.match(ui, /onFocusCapture/);
  assert.match(ui, /position: "fixed"/);
  assert.match(ui, /createPortal/);
});

test("collapsed wallet and merchant sidebar controls use right-side tooltips", () => {
  const dashboard = read("src/components/Dashboard.tsx");

  for (const label of [
    "Expand Sidebar",
    "Point of Sale (⌘6)",
    "Catalogue",
    "Invoices",
    "Customers",
    "Insights",
    "Home (⌘1)",
    "Activity (⌘2)",
    "DEX Swap (⌘3)",
    "Contacts (⌘4)",
    "Add Account",
    "Lock Wallet",
  ]) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(
      dashboard,
      new RegExp(`<Tooltip label=(?:"${escaped}"|\\{sidebarCollapsed \\? "${escaped}" : null\\}) side="right">`),
    );
  }

  assert.match(dashboard, /<Tooltip[\s\S]{0,240}Switch to Wallet[\s\S]{0,240}side="right"/);
  assert.match(dashboard, /<Tooltip[\s\S]{0,240}Merchant settings[\s\S]{0,240}side="right"/);
  assert.match(dashboard, /<Tooltip[\s\S]{0,240}acct\.label[\s\S]{0,240}side="right"/);
  assert.ok(
    dashboard.includes('<Tooltip label={`Network: ${network}`} side="right">'),
    "the collapsed network control needs its current-network tooltip",
  );
});
