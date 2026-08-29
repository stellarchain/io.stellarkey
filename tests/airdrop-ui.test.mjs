import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

test("pending balances open a selective review instead of claiming everything", () => {
  const dashboard = read("src/components/Dashboard.tsx");
  assert.equal(existsSync(path.join(root, "src/components/ClaimableBalancesModal.tsx")), true);
  const modal = read("src/components/ClaimableBalancesModal.tsx");

  assert.doesNotMatch(dashboard, />\s*Claim All\s*</);
  assert.match(dashboard, />\s*Review\s*</);
  assert.match(dashboard, /<ClaimableBalancesModal/);
  assert.match(modal, /type="checkbox"/);
  assert.match(modal, /Select all available/);
  assert.match(modal, /Claim selected/);
  assert.match(modal, /claimAirdrops\(selectedIds\)/);
  assert.match(modal, /networkFeeXlm\(recommendedBaseFeeStroops, selectedIds\.length\)/);
});

test("claim review explains decline semantics and blocks missing trustlines", () => {
  assert.equal(existsSync(path.join(root, "src/components/ClaimableBalancesModal.tsx")), true);
  const modal = read("src/components/ClaimableBalancesModal.tsx");

  assert.match(modal, /Stellar has no recipient-side decline operation/);
  assert.match(modal, /Unselected balances remain unclaimed\s+on the public ledger/);
  assert.match(modal, /Trustline required/);
  assert.match(modal, /hasClaimTrustline/);
  assert.match(modal, /onAddAsset/);
});

test("an immediately confirmed claim is finalized without entering tracked pending state", () => {
  const modal = read("src/components/ClaimableBalancesModal.tsx");

  assert.match(
    modal,
    /if \(result\.status === "confirmed"\)[\s\S]*?onClose\(\);[\s\S]*?} else \{\s*setPendingSubmission\(result\);/,
  );
  assert.doesNotMatch(
    modal,
    /setPendingSubmission\(result\);\s*if \(result\.status === "confirmed"\)/,
  );
});
