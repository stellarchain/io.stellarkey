import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { emptyStore } from "../src/lib/merchant/defaults.ts";
import { resetMerchantRecoveryStore } from "../src/lib/merchant/recovery.ts";

const ISSUE = {
  kind: "corrupt",
  message: "Merchant records could not be authenticated.",
  raw: "encrypted-recovery-bytes",
};

function ownerStore() {
  const owner = {
    id: "owner-1",
    name: "Owner",
    role: "owner",
    permissions: {
      takePayment: true,
      applyDiscount: true,
      comp: true,
      void: true,
      refundCeilingMinor: null,
      openDrawer: true,
      seeReports: true,
      exportRecords: true,
    },
    pinDigest: null,
    pinSetAt: null,
    active: true,
  };
  return {
    store: { ...emptyStore(), staff: [owner], activeStaffId: owner.id },
    owner,
  };
}

test("merchant break-glass reset uses wallet authorization when the store is unreadable", async () => {
  const events = [];
  let issue = ISSUE;
  await resetMerchantRecoveryStore({
    getStorageIssue: () => issue,
    getStore: () => emptyStore(),
    getActorId: () => null,
    authorizeWalletOwner: async () => events.push("wallet-authorized"),
    clearRepository: async () => events.push("repository-cleared"),
  });

  assert.deepEqual(events, ["wallet-authorized", "repository-cleared"]);
  assert.equal(issue.raw, "encrypted-recovery-bytes");
});

test("healthy-store reset still requires the current active owner", async () => {
  let authorized = false;
  await assert.rejects(
    resetMerchantRecoveryStore({
      getStorageIssue: () => null,
      getStore: () => emptyStore(),
      getActorId: () => null,
      authorizeWalletOwner: async () => { authorized = true; },
      clearRepository: async () => assert.fail("must not erase without merchant authority"),
    }),
    /active owner/i,
  );
  assert.equal(authorized, false);

  const { store, owner } = ownerStore();
  const events = [];
  await resetMerchantRecoveryStore({
    getStorageIssue: () => null,
    getStore: () => store,
    getActorId: () => owner.id,
    authorizeWalletOwner: async () => events.push("wallet-authorized"),
    clearRepository: async () => events.push("repository-cleared"),
  });
  assert.deepEqual(events, ["wallet-authorized", "repository-cleared"]);
});

test("recovery reset propagates erase failure and never consumes the raw export", async () => {
  let issue = ISSUE;
  await assert.rejects(
    resetMerchantRecoveryStore({
      getStorageIssue: () => issue,
      getStore: () => emptyStore(),
      getActorId: () => null,
      authorizeWalletOwner: async () => undefined,
      clearRepository: async () => { throw new Error("IndexedDB erase failed"); },
    }),
    /erase failed/i,
  );
  assert.equal(issue.raw, "encrypted-recovery-bytes");
});

test("the recovery screen awaits reset and presents failures", () => {
  const page = readFileSync(
    new URL("../src/components/merchant/MerchantPage.tsx", import.meta.url),
    "utf8",
  );
  assert.match(page, /await resetRecoveryData\(\)/);
  assert.match(page, /storageError/);
  assert.match(page, /loading=\{recoveryResetBusy\}/);
});
