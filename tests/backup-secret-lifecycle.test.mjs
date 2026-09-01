import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const wizard = readFileSync(
  new URL("../src/components/BackupWizardModal.tsx", import.meta.url),
  "utf8",
);
const paperWallet = readFileSync(
  new URL("../src/components/PaperWalletModal.tsx", import.meta.url),
  "utf8",
);

test("backup reveal clears authentication state immediately", () => {
  assert.match(wizard, /setRevealed\(material\);\s*setPassword\(""\);/);
  assert.match(
    wizard,
    /step === "secure"[\s\S]*setRevealed\(null\);[\s\S]*setPassword\(""\);[\s\S]*setStep\("password"\)/,
  );
});

test("encrypted paper-wallet export requires a fresh scoped password", () => {
  assert.doesNotMatch(paperWallet, /password:\s*string/);
  assert.match(paperWallet, /const \[exportPassword, setExportPassword\]/);
  assert.match(paperWallet, /setExportPassword\(""\)/);
  assert.doesNotMatch(wizard, /password=\{password\}/);
});
