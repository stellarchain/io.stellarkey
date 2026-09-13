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
  const multisig = read("src/components/MultiSigStudioModalBody.tsx");
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
    /className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2"/,
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
    "Business Details",
    "Payment Setup",
    "Accepted Assets",
    "Tax",
    "Tax Rates",
    "Tips",
    "Settlement Rules",
    "This Device",
  ]) {
    assert.match(settingsRoot, new RegExp(`label="${label}"`));
  }

  for (const label of ["Tax Records", "Staff & Terminals", "Peripherals"]) {
    assert.match(settingsRoot, new RegExp(`label="${label}"`));
  }

  assert.match(completeSettings, /type MerchantSettingsSheet\s*=/);
  assert.match(merchantSettings, /const \[activeSheet, setActiveSheet\]/);
  assert.match(merchantSheets, /activeSheet === "rates"/);
  assert.match(merchantSheets, /title="Tax Rates"/);
  assert.match(merchantSheets, /sheet="rates"[\s\S]*settings\.taxRates\.map/);
  assert.match(
    merchantSheets,
    /Changing this account requires your wallet password\. Existing unpaid requests stop\s+accepting automatic settlement until they are replaced or the original account is\s+restored\./,
  );
  assert.match(merchantSettings, /title="Turn Off Merchant Mode\?"/);
  assert.match(
    merchantSettings,
    /title="Turn Off Merchant Mode\?"[\s\S]*onClick=\{\(\) => void handleTurnOff\(\)\}/,
  );

  const controls = read("src/components/merchant/MerchantSettingsControls.tsx");
  const dangerColor = controls.match(/danger \? "text-\[\#([0-9A-Fa-f]{6})\]"/)?.[1];
  assert.ok(dangerColor, "merchant settings must define an explicit destructive text color");
  assert.ok(
    contrastRatio(dangerColor, "252527") >= 4.8,
    `destructive settings text needs contrast headroom, received #${dangerColor}`,
  );
  assert.match(controls, /onCommit: \(next: string\) => string \| Promise<string>/);
  assert.match(controls, /await onCommit\(draft\)/);
  assert.match(controls, /catch[\s\S]*setDraft\(value\)/);
  assert.match(merchantSheets, /async function saveSettings/);
  assert.doesNotMatch(merchantSheets, /\n\s+updateSettings\(/);
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
    "Reporting Period",
    "Tax Rates",
    "Export Report",
    "Encrypted Archive",
    "Retention",
    "Export History",
    "About Tax Records",
  ]) {
    assert.match(hub, new RegExp(`label="${label}"`));
  }

  assert.match(taxRecords, /type TaxRecordsSheet\s*=/);
  assert.match(taxRecords, /const \[activeSheet, setActiveSheet\]/);
  // The sheet renders from the retained value so its content survives the exit animation.
  assert.match(taxRecords, /const shownSheet = useRetainedForExit\(activeSheet\)/);
  assert.match(taxRecords, /shownSheet === "period"/);
  assert.match(taxRecords, /shownSheet === "export"/);
  assert.match(taxRecords, /shownSheet === "retention"/);
  assert.match(taxRecords, /<Modal[\s\S]*open=\{activeSheet !== null\}/);
  assert.match(
    taxRecords,
    /<Button\s+className="w-full min-w-0 !px-3"[^>]*>[\s\S]*?<span className="min-w-0 whitespace-normal text-center leading-tight">\s*Download encrypted archive\s*<\/span>/,
  );
  const retentionSave = taxRecords.slice(
    taxRecords.indexOf('ariaLabel="How long records are kept on this device"'),
    taxRecords.indexOf("Export before the window closes"),
  );
  assert.match(retentionSave, /onChange=\{async \(next\)/);
  assert.ok(retentionSave.indexOf("await updateSettings") < retentionSave.indexOf("toast("));
  assert.match(retentionSave, /catch \(error\)/);
});
