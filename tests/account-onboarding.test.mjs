import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

test("the dashboard uses Add Account as its only account-onboarding entry", () => {
  const dashboard = read("src/components/Dashboard.tsx");
  const accountSidebar = dashboard.slice(
    dashboard.indexOf("Accounts ({accounts.length})"),
    dashboard.indexOf("{accounts.map", dashboard.indexOf("Accounts ({accounts.length})")),
  );

  assert.doesNotMatch(dashboard, /TrezorModal|trezorModalOpen|setTrezorModalOpen/);
  assert.doesNotMatch(dashboard, /Trezor Hardware Suite/);
  assert.doesNotMatch(accountSidebar, /IconTrezor|Trezor/);
  assert.match(accountSidebar, /\+ Add/);
  assert.match(
    dashboard,
    /id: "add-account", label: "Add account", run: \(\) => setAddAccountOpen\(true\)/,
  );
  assert.match(dashboard, /function AccountMenu\(\{[\s\S]*?onAddAccount/);
  assert.match(dashboard, /onAddAccount\(\)[\s\S]*?<span>Add Account<\/span>/);
  assert.equal(existsSync(path.join(root, "src/components/TrezorModal.tsx")), false);
});

test("Add Account retains secure hardware controls without a promotional device suite", () => {
  const addAccount = read("src/components/AddAccountModal.tsx");

  assert.match(addAccount, /warmTrezorConnect/);
  assert.match(
    addAccount,
    /useEffect\(\(\) => \{[\s\S]*?mode === "hardware"[\s\S]*?warmTrezorConnect\(\)/,
  );
  assert.match(addAccount, /\[0, 1, 2, 3, 4\]\.map/);
  assert.match(addAccount, /setConnectedInfo\(null\)/);
  assert.match(addAccount, /const \[connectedInfo, setConnectedInfo\]/);
  assert.match(
    addAccount,
    /<HashValue[\s\S]*?full[\s\S]*?value=\{connectedInfo\.publicKey\}/,
  );
  assert.match(addAccount, /Confirm this address on your device/);
  assert.match(addAccount, /Add Hardware Account/);
  assert.doesNotMatch(
    addAccount,
    /Trezor Hardware Suite|Hardware Security Architecture|institutional-grade|100% offline|Need help setting up your Trezor/,
  );
});

test("the login screen describes hardware support without claiming the vault is hardware-backed", () => {
  const lockScreen = read("src/components/LockScreen.tsx");

  assert.match(lockScreen, /Hardware wallets supported:/);
  assert.doesNotMatch(lockScreen, /Hardware Backed:/);
});
