import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const wizard = readFileSync(
  new URL("../src/components/BackupWizardModalBody.tsx", import.meta.url),
  "utf8",
);
const paperWallet = readFileSync(
  new URL("../src/components/PaperWalletModal.tsx", import.meta.url),
  "utf8",
);
const onboarding = readFileSync(
  new URL("../src/components/Onboarding.tsx", import.meta.url),
  "utf8",
);
const ui = readFileSync(new URL("../src/components/ui.tsx", import.meta.url), "utf8");

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

test("paper wallets bind recovery material to the selected account type", () => {
  const verify = wizard.split("async function handleVerify")[1]
    ?.split("function download")[0] ?? "";
  const certificate = wizard.split("<PaperWalletModal")[1] ?? "";

  assert.match(wizard, /activeAccount\.index !== undefined/);
  assert.match(verify, /revealSecret\(activeAccount\.id, password\)/);
  assert.doesNotMatch(verify, /method === "paper" && hasPhrase/);
  assert.match(certificate, /kind=\{paperMaterial\.kind\}/);
  assert.doesNotMatch(certificate, /kind=\{hasPhrase \? "mnemonic" : "secret"\}/);
  assert.match(wizard, /Imported accounts need\s+separate backups/i);
});

test("secret copy controls warn and clear only after an explicit user action", () => {
  assert.equal(wizard.match(/<CopyButton value=\{revealed\} label="Copy" sensitive \/>/g)?.length, 2);
  assert.match(onboarding, /<CopyButton value=\{revealed \?\? ""\} label="Copy" sensitive \/>/);
  assert.match(ui, /Clear copied secret from clipboard/);
  assert.match(ui, /navigator\.clipboard\.writeText\(""\)/);
  assert.match(ui, /Clipboard managers may retain copied recovery material/);
});
