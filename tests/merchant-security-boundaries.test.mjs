import assert from "node:assert/strict";
import test from "node:test";

import { emptyStore } from "../src/lib/merchant/defaults.ts";
import { defaultPermissionsFor } from "../src/lib/merchant/permissions.ts";
import {
  authorizeMerchantWalletExit,
  merchantExitRequired,
  merchantPageAccess,
  voidAwaitingMerchantCharge,
} from "../src/lib/merchant/security-boundaries.ts";

function member(id, role, permissionOverrides = {}) {
  return {
    id,
    name: id,
    role,
    permissions: { ...defaultPermissionsFor(role), ...permissionOverrides },
    pinDigest: null,
    pinSetAt: null,
    active: true,
  };
}

function openShift(network = "testnet") {
  return {
    id: "shift-1",
    number: 1,
    openedAt: 1,
    closedAt: null,
    openedById: "owner",
    openedBy: "owner",
    closedById: null,
    closedBy: null,
    terminalName: "Front counter",
    network,
    floatMinor: 0,
    grossMinor: 0,
    refundsMinor: 0,
    tipsMinor: 0,
    discountsMinor: 0,
    compsMinor: 0,
    voidsMinor: 0,
    taxByRate: {},
    orderCount: 0,
    cash: null,
    openTabs: 0,
    zReport: null,
  };
}

function awaitingStore() {
  const owner = member("owner", "owner");
  return {
    ...emptyStore(),
    staff: [owner],
    activeStaffId: owner.id,
    shifts: [openShift()],
    orders: [{ id: "order-1", status: "awaiting" }],
    charges: [{ id: "charge-1", orderId: "order-1", status: "awaiting" }],
  };
}

test("merchant charge voiding revalidates the active operator, shift, permission, and status", () => {
  const original = awaitingStore();
  const voided = voidAwaitingMerchantCharge(original, {
    chargeId: "charge-1",
    actorId: "owner",
    network: "testnet",
  });

  assert.equal(voided.charges[0].status, "voided");
  assert.equal(voided.orders[0].status, "voided");
  assert.equal(original.charges[0].status, "awaiting");
  assert.throws(
    () => voidAwaitingMerchantCharge({ ...original, activeStaffId: null }, {
      chargeId: "charge-1",
      actorId: "owner",
      network: "testnet",
    }),
    /active staff|active operator|choose/i,
  );
  assert.throws(
    () => voidAwaitingMerchantCharge({
      ...original,
      staff: [member("owner", "owner", { void: false })],
    }, {
      chargeId: "charge-1",
      actorId: "owner",
      network: "testnet",
    }),
    /not allowed to void/i,
  );
  assert.throws(
    () => voidAwaitingMerchantCharge({ ...original, shifts: [] }, {
      chargeId: "charge-1",
      actorId: "owner",
      network: "testnet",
    }),
    /open a shift/i,
  );
  assert.throws(
    () => voidAwaitingMerchantCharge({
      ...original,
      charges: [{ ...original.charges[0], status: "paid" }],
    }, {
      chargeId: "charge-1",
      actorId: "owner",
      network: "testnet",
    }),
    /only an awaiting charge/i,
  );
});

test("merchant record access fails closed for locked, absent, and report-forbidden operators", () => {
  const owner = member("owner", "owner");
  const server = member("server", "server");

  assert.deepEqual(
    merchantPageAccess({ activeStaff: owner, vaultPhase: "unlocked" }),
    { hasActiveOperator: true, canSeeReports: true, canAccessRecords: true },
  );
  assert.equal(
    merchantPageAccess({ activeStaff: owner, vaultPhase: "locked" }).canAccessRecords,
    false,
  );
  assert.equal(
    merchantPageAccess({ activeStaff: null, vaultPhase: "unlocked" }).canAccessRecords,
    false,
  );
  assert.equal(
    merchantPageAccess({ activeStaff: server, vaultPhase: "unlocked" }).canAccessRecords,
    false,
  );
});

test("merchant wallet exit requires a current owner before and after wallet authorization", async () => {
  const owner = member("owner", "owner");
  let store = { ...emptyStore(), staff: [owner], activeStaffId: owner.id };
  const events = [];

  await authorizeMerchantWalletExit({
    getStore: () => store,
    getActorId: () => owner.id,
    authorizeWalletOwner: async () => events.push("wallet-authorized"),
  });
  assert.deepEqual(events, ["wallet-authorized"]);

  await assert.rejects(
    authorizeMerchantWalletExit({
      getStore: () => store,
      getActorId: () => owner.id,
      authorizeWalletOwner: async () => {
        store = { ...store, activeStaffId: null };
      },
    }),
    /active owner/i,
  );
});

test("every merchant-to-wallet navigation except settings crosses the exit gate", () => {
  assert.equal(merchantExitRequired({
    mode: "merchant",
    targetIsMerchantView: false,
    targetIsSettings: false,
  }), true);
  assert.equal(merchantExitRequired({
    mode: "merchant",
    targetIsMerchantView: true,
    targetIsSettings: false,
  }), false);
  assert.equal(merchantExitRequired({
    mode: "merchant",
    targetIsMerchantView: false,
    targetIsSettings: true,
  }), false);
  assert.equal(merchantExitRequired({
    mode: "wallet",
    targetIsMerchantView: false,
    targetIsSettings: false,
  }), false);
});
