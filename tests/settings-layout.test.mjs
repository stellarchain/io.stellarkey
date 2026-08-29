import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

function contrastRatio(foreground, background) {
  const luminance = (hex) => {
    const channels = hex.match(/[0-9a-f]{2}/gi).map((channel) => Number.parseInt(channel, 16) / 255);
    const [red, green, blue] = channels.map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    );
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
}

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
  assert.match(
    merchantSheets,
    /Issued requests keep their original receiving account and remain monitored until\s+resolved\./,
  );
  assert.match(merchantSettings, /title="Turn off Merchant Mode\?"/);
  assert.match(
    merchantSettings,
    /title="Turn off Merchant Mode\?"[\s\S]*onClick=\{\(\) => void handleTurnOff\(\)\}/,
  );

  const controls = read("src/components/merchant/MerchantSettingsControls.tsx");
  const dangerColor = controls.match(/danger \? "text-\[\#([0-9A-Fa-f]{6})\]"/)?.[1];
  assert.ok(dangerColor, "merchant settings must define an explicit destructive text color");
  assert.ok(
    contrastRatio(dangerColor, "252527") >= 4.8,
    `destructive settings text needs contrast headroom, received #${dangerColor}`,
  );
});

test("tax records use a summary-first iOS hub with focused task sheets", () => {
  const taxRecords = read("src/components/merchant/TaxRecordsPage.tsx");
  const hubStart = taxRecords.indexOf('data-tax-records-hub="true"');
  const sheetsStart = taxRecords.indexOf('data-tax-records-sheets="true"');

  assert.notEqual(hubStart, -1);
  assert.notEqual(sheetsStart, -1);
  assert.ok(hubStart < sheetsStart);

  const hub = taxRecords.slice(hubStart, sheetsStart);

  assert.match(hub, /className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2"/);
  assert.doesNotMatch(hub, /<(?:Select|input)\b/);

  for (const label of [
    "Reporting period",
    "Tax rates",
    "Export report",
    "Encrypted archive",
    "Retention",
    "Export history",
    "About tax records",
  ]) {
    assert.match(hub, new RegExp(`label="${label}"`));
  }

  assert.match(taxRecords, /type TaxRecordsSheet\s*=/);
  assert.match(taxRecords, /const \[activeSheet, setActiveSheet\]/);
  assert.match(taxRecords, /activeSheet === "period"/);
  assert.match(taxRecords, /activeSheet === "export"/);
  assert.match(taxRecords, /activeSheet === "retention"/);
  assert.match(taxRecords, /<Modal[\s\S]*open=\{activeSheet !== null\}/);
  assert.match(
    taxRecords,
    /<Button\s+className="w-full min-w-0 !px-3"[^>]*>[\s\S]*?<span className="min-w-0 whitespace-normal text-center leading-tight">\s*Download encrypted archive\s*<\/span>/,
  );
});
