import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { emptyStore } from "../src/lib/merchant/defaults.ts";

const NOW = 1_780_000_000_000;

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

async function shiftDomain() {
  try {
    return await import("../src/lib/merchant/shifts.ts");
  } catch (error) {
    assert.fail(`The persisted shift domain is missing: ${error instanceof Error ? error.message : error}`);
  }
}

function actor(overrides = {}) {
  return {
    id: "staff-owner",
    name: "Ari",
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
    ...overrides,
  };
}

function paidOrder(overrides = {}) {
  return {
    id: "order-1001",
    number: 1001,
    reference: "MC1001",
    network: "mainnet",
    status: "paid",
    lines: [],
    totals: {
      grossMinor: 1200,
      discountMinor: 100,
      tipMinor: 100,
      netMinor: 920,
      taxByRate: { standard: 180 },
      taxMinor: 180,
      totalMinor: 1200,
    },
    currency: "EUR",
    tender: [
      { kind: "cash", amountMinor: 500, receivedMinor: 500, changeMinor: 0 },
      { kind: "card", amountMinor: 300, externalReference: "CARD-1" },
      { kind: "crypto", amountMinor: 400, chargeId: "charge-1" },
    ],
    staffId: "staff-owner",
    staffName: "Ari",
    terminalName: "Front till",
    createdAt: NOW + 100,
    paidAt: NOW + 200,
    stockAppliedAt: NOW + 200,
    payerAddress: null,
    note: null,
    ...overrides,
  };
}

function openedStore() {
  const member = actor();
  const store = {
    ...emptyStore(),
    staff: [member],
    activeStaffId: member.id,
    settings: { ...emptyStore().settings, terminalName: "Front till" },
    terminal: { ...emptyStore().terminal, name: "Front till" },
  };
  return { member, store };
}

test("opening a shift persists its operator, terminal, network, float, and sequence", async () => {
  const { openShift } = await shiftDomain();
  const { member, store } = openedStore();
  const opened = openShift(store, {
    id: "shift-1",
    actor: member,
    terminalName: "Front till",
    network: "mainnet",
    floatMinor: 10_000,
    now: NOW,
  });

  assert.equal(opened.shift.number, 1);
  assert.equal(opened.shift.openedById, member.id);
  assert.equal(opened.shift.openedBy, member.name);
  assert.equal(opened.shift.terminalName, "Front till");
  assert.equal(opened.shift.network, "mainnet");
  assert.equal(opened.shift.floatMinor, 10_000);
  assert.equal(opened.store.nextShiftNumber, 2);
  assert.equal(opened.store.shifts[0].id, opened.shift.id);
});

test("one terminal cannot have two active shifts", async () => {
  const { openShift } = await shiftDomain();
  const { member, store } = openedStore();
  const first = openShift(store, {
    id: "shift-1",
    actor: member,
    terminalName: "Front till",
    network: "mainnet",
    floatMinor: 0,
    now: NOW,
  });

  assert.throws(
    () =>
      openShift(first.store, {
        id: "shift-2",
        actor: member,
        terminalName: "Front till",
        network: "mainnet",
        floatMinor: 0,
        now: NOW + 1,
      }),
    /already has an open shift/i,
  );

  assert.throws(
    () =>
      openShift(first.store, {
        id: "shift-after-rename",
        actor: member,
        terminalName: "Renamed front till",
        network: "mainnet",
        floatMinor: 0,
        now: NOW + 2,
      }),
    /already has an open shift/i,
    "renaming this one-device terminal must not orphan its active shift",
  );
});

test("a forged shift actor is rejected even when its permission object looks valid", async () => {
  const { openShift } = await shiftDomain();
  const { member, store } = openedStore();

  assert.throws(
    () =>
      openShift(store, {
        id: "shift-forged",
        actor: { ...member, id: "not-on-roster", name: "Mallory" },
        terminalName: "Front till",
        network: "mainnet",
        floatMinor: 0,
        now: NOW,
      }),
    /active staff member with drawer access/i,
  );
});

test("an X-report derives exact tender, refund, adjustment, tax, and staff totals", async () => {
  const { buildShiftReport, openShift } = await shiftDomain();
  const { member, store } = openedStore();
  const opened = openShift(store, {
    id: "shift-1",
    actor: member,
    terminalName: "Front till",
    network: "mainnet",
    floatMinor: 10_000,
    now: NOW,
  });
  const order = paidOrder();
  const current = {
    ...opened.store,
    orders: [order],
    refunds: [
      {
        id: "refund-1",
        orderId: order.id,
        kind: "order",
        sourcePaymentId: null,
        network: "mainnet",
        amountMinor: 200,
        asset: { code: "XLM", issuer: null },
        amount: "1.0000000",
        destination: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        reason: "customer_request",
        note: null,
        transactionHash: "a".repeat(64),
        submissionStatus: "confirmed",
        createdAt: NOW + 300,
      },
    ],
    adjustments: [
      {
        id: "adjustment-1",
        kind: "discount",
        lineId: null,
        lineName: null,
        amountMinor: 100,
        reasonCode: "Loyalty",
        staffId: member.id,
        staffName: member.name,
        at: NOW + 150,
        orderId: order.id,
        orderNumber: order.number,
      },
      {
        id: "adjustment-2",
        kind: "comp",
        lineId: null,
        lineName: null,
        amountMinor: 50,
        reasonCode: "Recovery",
        staffId: member.id,
        staffName: member.name,
        at: NOW + 160,
        orderId: order.id,
        orderNumber: order.number,
      },
      {
        id: "adjustment-3",
        kind: "void",
        lineId: null,
        lineName: null,
        amountMinor: 25,
        reasonCode: "Mistake",
        staffId: member.id,
        staffName: member.name,
        at: NOW + 170,
        orderId: order.id,
        orderNumber: order.number,
      },
    ],
  };

  const report = buildShiftReport(current, opened.shift.id, NOW + 1000);

  assert.equal(report.kind, "x");
  assert.equal(report.grossMinor, 1200);
  assert.equal(report.refundsMinor, 200);
  assert.equal(report.tipsMinor, 100);
  assert.equal(report.discountsMinor, 100);
  assert.equal(report.compsMinor, 50);
  assert.equal(report.voidsMinor, 25);
  assert.deepEqual(report.taxByRate, { standard: 180 });
  assert.deepEqual(report.tenderByKind, { cash: 500, card: 300, crypto: 400 });
  assert.equal(report.expectedCashMinor, 10_500);
  assert.equal(report.orderCount, 1);
  assert.deepEqual(report.staffTotals, [
    { staffId: member.id, staffName: member.name, orderCount: 1, takingsMinor: 1200, tipsMinor: 100 },
  ]);
  assert.deepEqual(report.adjustments.map((entry) => entry.id), [
    "adjustment-1",
    "adjustment-2",
    "adjustment-3",
  ]);
});

test("unresolved tender and approval flows block blind close", async () => {
  const { closeShift, openShift, unresolvedShiftFlows } = await shiftDomain();
  const { member, store } = openedStore();
  const opened = openShift(store, {
    id: "shift-1",
    actor: member,
    terminalName: "Front till",
    network: "mainnet",
    floatMinor: 0,
    now: NOW,
  });
  const pending = {
    ...opened.store,
    orders: [paidOrder({ id: "order-open", status: "awaiting", paidAt: null, tender: [] })],
    refundRequests: [
      {
        id: "request-1",
        orderId: "order-old",
        orderNumber: 999,
        amountMinor: 100,
        reason: "other",
        note: null,
        sourcePaymentId: null,
        requestedById: member.id,
        requestedBy: member.name,
        requestedAt: NOW + 300,
        status: "pending",
        reviewedById: null,
        reviewedAt: null,
        refundId: null,
      },
    ],
  };

  assert.deepEqual(
    unresolvedShiftFlows(pending, opened.shift.id).map((flow) => flow.kind).sort(),
    ["order", "refund_request"],
  );
  assert.throws(
    () => closeShift(pending, { shiftId: opened.shift.id, actor: member, countedMinor: 0, now: NOW + 1000 }),
    /cannot close.*unresolved/i,
  );
});

test("blind close persists variance and an immutable sequential Z-report", async () => {
  const { buildShiftReport, closeShift, openShift } = await shiftDomain();
  const { member, store } = openedStore();
  const opened = openShift(store, {
    id: "shift-1",
    actor: member,
    terminalName: "Front till",
    network: "mainnet",
    floatMinor: 10_000,
    now: NOW,
  });
  const trading = { ...opened.store, orders: [paidOrder()] };
  const closed = closeShift(trading, {
    shiftId: opened.shift.id,
    actor: member,
    countedMinor: 10_475,
    now: NOW + 1000,
  });

  assert.equal(closed.shift.closedAt, NOW + 1000);
  assert.equal(closed.shift.closedById, member.id);
  assert.deepEqual(closed.shift.cash, {
    countedMinor: 10_475,
    expectedMinor: 10_500,
    varianceMinor: -25,
  });
  assert.equal(closed.report.kind, "z");
  assert.equal(closed.report.sequence, 1);
  assert.equal(closed.report.cash?.varianceMinor, -25);

  const backdated = paidOrder({ id: "order-backdated", number: 1002 });
  const changed = { ...closed.store, orders: [...closed.store.orders, backdated] };
  assert.deepEqual(
    buildShiftReport(changed, opened.shift.id, NOW + 2000),
    closed.report,
    "a closed Z-report must be returned from its persisted snapshot, not recomputed",
  );
  assert.throws(
    () => closeShift(changed, { shiftId: opened.shift.id, actor: member, countedMinor: 10_475, now: NOW + 2000 }),
    /already closed/i,
  );
});

test("production shift surfaces use persisted actions and visibly lock an unopened till", () => {
  const sheet = source("src/components/merchant/ShiftSheet.tsx");
  const till = source("src/components/merchant/PosTerminal.tsx");
  const hook = source("src/hooks/useMerchant.tsx");
  const dashboard = source("src/components/Dashboard.tsx");

  assert.doesNotMatch(sheet, /merchant\/mock|MOCK_SHIFT|would (?:print|email|export)/);
  assert.match(sheet, /openShift\(floatMinor\)/);
  assert.match(sheet, /closeShift\(countedMinor\)/);
  assert.match(sheet, /Blob|mailto:|window\.print/);
  assert.match(till, /Till locked · no open shift/);
  assert.match(till, /paymentBlockedReason/);
  assert.match(hook, /activeShiftForTerminal/);
  assert.doesNotMatch(dashboard, /MOCK_SHIFT/);
});
