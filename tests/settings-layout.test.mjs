import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

test("local-device signer badges sit below their addresses", () => {
  const multisig = read("src/components/MultiSigStudioModal.tsx");
  const separatedBadges = multisig.match(
    /className="mt-1 block w-fit rounded-md bg-\[#30D158\]\/15/g,
  );

  assert.equal(separatedBadges?.length ?? 0, 2);
  assert.doesNotMatch(
    multisig,
    /className="mt-0\.5 inline-block rounded-md bg-\[#30D158\]\/15/,
  );
});

test("merchant settings use an iOS-style summary hierarchy with focused edit sheets", () => {
  const merchantSettings = read("src/components/merchant/MerchantSettings.tsx");
  const merchantSheets = read("src/components/merchant/MerchantSettingsSheets.tsx");
  const completeSettings = `${merchantSettings}\n${merchantSheets}`;
  const rootStart = merchantSettings.indexOf('data-merchant-settings-root="true"');
  const sheetsStart = merchantSettings.indexOf('data-merchant-settings-sheets="true"');

  assert.notEqual(rootStart, -1);
  assert.notEqual(sheetsStart, -1);
  assert.ok(rootStart < sheetsStart);

  const settingsRoot = merchantSettings.slice(rootStart, sheetsStart);

  assert.match(
    settingsRoot,
    /className="grid grid-cols-1 items-start gap-6 md:grid-cols-2"/,
  );
  assert.equal(
    settingsRoot.match(/data-merchant-settings-column=/g)?.length ?? 0,
    2,
  );
  assert.doesNotMatch(
    settingsRoot,
    /<(?:TextRow|ChoiceRow|DraftInput|Select|SegmentedControl|Toggle)\b/,
  );

  for (const label of [
    "Business details",
    "Payment setup",
    "Accepted assets",
    "Tax",
    "Tax rates",
    "Tips",
    "Settlement rules",
    "This device",
  ]) {
    assert.match(settingsRoot, new RegExp(`label="${label}"`));
  }

  for (const label of ["Tax records", "Staff & terminals", "Peripherals"]) {
    assert.match(settingsRoot, new RegExp(`label="${label}"`));
  }

  assert.match(completeSettings, /type MerchantSettingsSheet\s*=/);
  assert.match(merchantSettings, /const \[activeSheet, setActiveSheet\]/);
  assert.match(merchantSheets, /activeSheet === "rates"/);
  assert.match(merchantSheets, /title="Tax rates"/);
  assert.match(merchantSheets, /sheet="rates"[\s\S]*settings\.taxRates\.map/);
  assert.match(merchantSettings, /title="Turn off Merchant Mode\?"/);
  assert.match(
    merchantSettings,
    /title="Turn off Merchant Mode\?"[\s\S]*onClick=\{\(\) => void handleTurnOff\(\)\}/,
  );
});
