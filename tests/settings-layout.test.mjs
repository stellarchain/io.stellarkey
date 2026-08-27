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

test("merchant settings use the wallet's responsive category grid", () => {
  const merchantSettings = read("src/components/merchant/MerchantSettings.tsx");

  assert.match(
    merchantSettings,
    /className="grid grid-cols-1 items-start gap-6 md:grid-cols-2"/,
  );
  assert.equal(
    merchantSettings.match(/data-merchant-settings-column=/g)?.length ?? 0,
    2,
  );
  assert.match(merchantSettings, /data-merchant-settings-column="payments"/);
  assert.match(merchantSettings, /data-merchant-settings-column="operations"/);
});
