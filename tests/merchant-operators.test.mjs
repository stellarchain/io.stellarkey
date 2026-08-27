import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { emptyStore } from "../src/lib/merchant/defaults.ts";
import * as operatorRules from "../src/lib/merchant/operators.ts";
import {
  activateOperator,
  endOperatorShift,
  lockOperator,
  shouldLockOperatorAfterSale,
} from "../src/lib/merchant/operators.ts";

function member(id, name = id) {
  return {
    id,
    name,
    role: "server",
    permissions: {
      takePayment: true,
      applyDiscount: false,
      comp: false,
      void: false,
      refundCeilingMinor: 0,
      openDrawer: false,
      seeReports: false,
      exportRecords: false,
    },
    pinDigest: "pin-digest-v1",
    pinSetAt: null,
    active: true,
  };
}

function order(id, status, staffId = "staff-ari") {
  return {
    id,
    status,
    staffId,
  };
}

test("activating an operator adds them to the on-shift roster without duplicating staff", () => {
  const ari = member("staff-ari", "Ari");
  const store = { ...emptyStore(), staff: [ari], onShiftStaffIds: [ari.id] };

  const next = activateOperator(store, ari.id);

  assert.equal(next.activeStaffId, ari.id);
  assert.deepEqual(next.onShiftStaffIds, [ari.id]);
  assert.notEqual(next, store);
});

test("locking clears the current operator but keeps everyone on shift", () => {
  const store = {
    ...emptyStore(),
    staff: [member("staff-ari"), member("staff-bea")],
    activeStaffId: "staff-ari",
    onShiftStaffIds: ["staff-ari", "staff-bea"],
  };

  const next = lockOperator(store);

  assert.equal(next.activeStaffId, null);
  assert.deepEqual(next.onShiftStaffIds, ["staff-ari", "staff-bea"]);
});

test("ending an operator session removes them and locks the till when they were current", () => {
  const store = {
    ...emptyStore(),
    staff: [member("staff-ari"), member("staff-bea")],
    activeStaffId: "staff-ari",
    onShiftStaffIds: ["staff-ari", "staff-bea"],
  };

  const next = endOperatorShift(store, "staff-ari");

  assert.equal(next.activeStaffId, null);
  assert.deepEqual(next.onShiftStaffIds, ["staff-bea"]);
});

test("only after-sale mode locks a completed till sale", () => {
  assert.equal(
    shouldLockOperatorAfterSale({ ...emptyStore().settings, operatorLockMode: "after_sale" }),
    true,
  );
  assert.equal(
    shouldLockOperatorAfterSale({ ...emptyStore().settings, operatorLockMode: "after_timeout" }),
    false,
  );
});

test("operator timeout is active only for timeout mode", () => {
  assert.equal(typeof operatorRules.operatorTimeoutMs, "function");
  assert.equal(
    operatorRules.operatorTimeoutMs({
      ...emptyStore().settings,
      operatorLockMode: "after_timeout",
      operatorLockTimeoutMinutes: 15,
    }),
    15 * 60 * 1000,
  );
  assert.equal(
    operatorRules.operatorTimeoutMs({
      ...emptyStore().settings,
      operatorLockMode: "after_sale",
    }),
    null,
  );
});

test("the after-sale policy locks atomically while timeout mode keeps the operator", () => {
  assert.equal(typeof operatorRules.applyOperatorSalePolicy, "function");
  const active = {
    ...emptyStore(),
    activeStaffId: "staff-ari",
    onShiftStaffIds: ["staff-ari"],
  };

  assert.equal(
    operatorRules.applyOperatorSalePolicy({
      ...active,
      settings: { ...active.settings, operatorLockMode: "after_sale" },
    }).activeStaffId,
    null,
  );
  assert.equal(
    operatorRules.applyOperatorSalePolicy({
      ...active,
      settings: { ...active.settings, operatorLockMode: "after_timeout" },
    }).activeStaffId,
    "staff-ari",
  );
});

test("a verified switch is applied to the latest store without losing intervening changes", () => {
  assert.equal(typeof operatorRules.activateVerifiedOperator, "function");
  const ari = member("staff-ari", "Ari");
  const latest = {
    ...emptyStore(),
    revision: 7,
    staff: [ari],
    settings: { ...emptyStore().settings, shopName: "Updated while PIN was open" },
    orders: [order("order-new", "paid")],
  };

  const next = operatorRules.activateVerifiedOperator(latest, ari.id, ari.pinDigest);

  assert.equal(next.activeStaffId, ari.id);
  assert.deepEqual(next.onShiftStaffIds, [ari.id]);
  assert.equal(next.revision, 7);
  assert.equal(next.settings.shopName, "Updated while PIN was open");
  assert.deepEqual(next.orders, latest.orders);
});

test("a verified switch is rejected if the PIN changed while verification was pending", () => {
  const ari = member("staff-ari", "Ari");
  const latest = {
    ...emptyStore(),
    staff: [{ ...ari, pinDigest: "pin-digest-v2" }],
  };

  assert.throws(
    () => operatorRules.activateVerifiedOperator(latest, ari.id, ari.pinDigest),
    /PIN changed.*Try again/i,
  );
});

test("automatic reconciliation locks only when the current operator's sale becomes paid", () => {
  assert.equal(typeof operatorRules.applyCompletedSalePolicy, "function");
  const before = {
    ...emptyStore(),
    staff: [member("staff-ari"), member("staff-bea")],
    activeStaffId: "staff-ari",
    onShiftStaffIds: ["staff-ari", "staff-bea"],
    settings: { ...emptyStore().settings, operatorLockMode: "after_sale" },
    orders: [order("order-ari", "awaiting", "staff-ari")],
  };
  const paid = {
    ...before,
    orders: [order("order-ari", "paid", "staff-ari")],
  };

  assert.equal(
    operatorRules.applyCompletedSalePolicy(before, paid, "staff-ari").activeStaffId,
    null,
  );
  assert.equal(
    operatorRules.applyCompletedSalePolicy(before, paid, "staff-bea").activeStaffId,
    "staff-ari",
  );
});

test("creating an awaiting crypto charge does not count as a completed sale", () => {
  const before = {
    ...emptyStore(),
    activeStaffId: "staff-ari",
    onShiftStaffIds: ["staff-ari"],
    settings: { ...emptyStore().settings, operatorLockMode: "after_sale" },
    orders: [],
  };
  const awaiting = {
    ...before,
    orders: [order("order-ari", "awaiting", "staff-ari")],
  };

  assert.equal(
    operatorRules.applyCompletedSalePolicy(before, awaiting, "staff-ari").activeStaffId,
    "staff-ari",
  );
});

test("merchant context exposes roster controls and enforces local operator locking", () => {
  const hook = readFileSync(
    new URL("../src/hooks/useMerchant.tsx", import.meta.url),
    "utf8",
  );

  assert.match(hook, /onShiftStaff: StaffMember\[\]/);
  assert.match(hook, /lockStaffSession: \(\) => Promise<void>/);
  assert.match(hook, /endStaffSession: \(memberId: string\) => Promise<void>/);
  assert.match(hook, /activateVerifiedOperator\(latest, member\.id, expectedPinDigest\)/);
  assert.match(hook, /operatorTimeoutMs\(settings\)/);
  assert.match(hook, /addEventListener\("pointerdown", resetTimer/);
  assert.match(hook, /addEventListener\("keydown", resetTimer/);
  assert.match(hook, /addEventListener\("visibilitychange", onVisibilityChange/);
  assert.match(hook, /applyOperatorSalePolicy\(committed\.store\)/);
  assert.doesNotMatch(hook, /applyOperatorSalePolicy\(\{\s*\.\.\.awaiting\.store,/);
  assert.match(hook, /const settlementStaffId = staffSessionIdRef\.current/);
  assert.match(hook, /applyCompletedSalePolicy\([\s\S]*withCustomers,[\s\S]*settlementStaffId/);
  assert.match(hook, /installLoadedStore[\s\S]*updateStaffSessionId\(null\)/);
});

test("operator lock choices expose selection state and mobile-size targets", () => {
  const ui = readFileSync(new URL("../src/components/ui.tsx", import.meta.url), "utf8");
  const staffPage = readFileSync(
    new URL("../src/components/merchant/StaffTerminalsPage.tsx", import.meta.url),
    "utf8",
  );

  assert.match(ui, /ariaLabel\?: string/);
  assert.match(ui, /role="group"/);
  assert.match(ui, /aria-pressed=\{active\}/);
  assert.match(ui, /min-h-11/);
  assert.match(ui, /!panelRef\.current\.contains\(document\.activeElement\)/);
  assert.match(staffPage, /ariaLabel="Operator lock timing"/);
  assert.match(staffPage, /ariaLabel="Operator inactivity timeout"/);
  assert.match(staffPage, /autoFocus=\{index === 0\}/);
});
