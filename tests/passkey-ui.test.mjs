import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const lockScreen = readFileSync(new URL("../src/components/LockScreen.tsx", import.meta.url), "utf8");
const settings = readFileSync(new URL("../src/components/SettingsPage.tsx", import.meta.url), "utf8");
const walletHook = readFileSync(new URL("../src/hooks/useWallet.tsx", import.meta.url), "utf8");
const vault = readFileSync(new URL("../src/lib/vault.ts", import.meta.url), "utf8");

test("passkey unlock is optional and password unlock remains visible", () => {
  assert.match(lockScreen, /Unlock with Face ID \/ Touch ID/);
  assert.match(lockScreen, /type="password"/);
  assert.match(lockScreen, /unlockWithPasskey/);
  assert.match(walletHook, /unlockWithPasskey/);
});

test("Settings can enable and remove the device-local passkey wrapper", () => {
  assert.match(settings, /enablePasskeyUnlock/);
  assert.match(settings, /removePasskeyUnlock/);
  assert.match(settings, /Requires HTTPS/);
  assert.match(settings, /Your password and encrypted backup remain the recovery path/);
  assert.match(settings, /Required before removing device unlock/);
  assert.match(vault, /masterKeyForPassword\(vault, password\)/);
});

test("wallet replacement clears passkey authority tied to the previous vault", () => {
  assert.match(vault, /PASSKEY_RECORD_KEY/);
  assert.match(vault, /writes\.set\(PASSKEY_RECORD_KEY, null\)/);
});
