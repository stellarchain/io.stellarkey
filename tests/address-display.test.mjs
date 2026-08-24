import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { formatTrezorAddress } from "../src/lib/address-display.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

test("Trezor-style addresses use consistent four-character verification groups", () => {
  const value = `G${"A".repeat(54)}Z`;

  assert.equal(formatTrezorAddress(value), "GAAA AAAA … AAAA AAAZ");
  assert.equal(
    formatTrezorAddress(value, { full: true }),
    "GAAA AAAA AAAA AAAA AAAA AAAA AAAA AAAA AAAA AAAA AAAA AAAA AAAA AAAZ",
  );
  assert.equal(formatTrezorAddress(""), "");
});

test("screens use the shared Trezor-style address presentation", () => {
  const files = [
    "src/components/AddAssetModal.tsx",
    "src/components/BatchSendModal.tsx",
    "src/components/Dashboard.tsx",
    "src/components/RenameAccountModal.tsx",
    "src/components/SettingsPage.tsx",
    "src/components/SwapPage.tsx",
  ];
  const combined = files.map(read).join("\n");
  const send = read("src/components/SendModal.tsx");
  const trezor = read("src/components/TrezorModal.tsx");
  const addAccount = read("src/components/AddAccountModal.tsx");
  const addressBook = read("src/components/AddressBookPage.tsx");
  const multisig = read("src/components/MultiSigStudioModal.tsx");
  const settings = read("src/components/SettingsPage.tsx");

  assert.doesNotMatch(combined, /shortenAddr/);
  for (const file of files) {
    assert.match(read(file), /formatTrezorAddress/);
  }
  assert.doesNotMatch(send, /addr\.slice\(0,/);
  assert.match(send, /formatTrezorAddress\(addr\)/);
  assert.match(trezor, /<HashValue[\s\S]*?full[\s\S]*?value=\{connectedInfo\.publicKey\}/);
  assert.match(addAccount, /<HashValue[\s\S]*?full[\s\S]*?value=\{hardwareKey\}/);
  assert.doesNotMatch(`${addressBook}\n${multisig}`, /head=\{6\}|tail=\{6\}/);
  assert.match(settings, /<HashValue[\s\S]*?full[\s\S]*?value=\{airReview\.source\}/);
  assert.match(
    settings,
    /line\.kind === "address"\s*\?\s*\(\s*<HashValue[\s\S]*?full[\s\S]*?value=\{line\.value\}/,
  );
});
