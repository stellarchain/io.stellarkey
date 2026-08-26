import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { emptyStore } from "../src/lib/merchant/defaults.ts";

const NOW = 1_780_000_000_000;

async function orderDomain() {
  try {
    return await import("../src/lib/merchant/orders.ts");
  } catch (error) {
    assert.fail(`The persisted order domain is missing: ${error instanceof Error ? error.message : error}`);
  }
}

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function line(overrides = {}) {
  return {
    id: "line-1",
    itemId: null,
    name: "Counter sale",
    quantity: 1,
    unitPriceMinor: 1000,
    modifiers: [],
    taxRateId: "standard",
    note: null,
    adjustmentMinor: 0,
    ...overrides,
  };
}

function orderInput(overrides = {}) {
  return {
    id: "order-1001",
    network: "testnet",
    lines: [line()],
    discountMinor: 0,
    tipMinor: 0,
    staffId: "staff-owner",
    staffName: "Ari",
    now: NOW,
    ...overrides,
  };
}

function staff(overrides = {}) {
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

test("cash settlement records the received amount and exact change", async () => {
  const { buildOrder, cashTender, settleNewOrder } = await orderDomain();
  const store = {
    ...emptyStore(),
    settings: {
      ...emptyStore().settings,
      profile: { ...emptyStore().settings.profile, name: "North Star" },
      terminalName: "Front till",
    },
  };
  const order = buildOrder(store, orderInput());
  const tender = cashTender(order.totals.totalMinor, 1500);
  const committed = settleNewOrder(store, order, [tender], [], NOW + 1);

  assert.equal(committed.order.status, "paid");
  assert.equal(committed.order.paidAt, NOW + 1);
  assert.deepEqual(committed.order.tender, [
    {
      kind: "cash",
      amountMinor: 1000,
      receivedMinor: 1500,
      changeMinor: 500,
    },
  ]);
  assert.equal(committed.store.orders[0].id, order.id);
  assert.equal(committed.store.nextOrderNumber, 1002);
});

test("external card settlement retains the other terminal's reference", async () => {
  const { buildOrder, cardTender, settleNewOrder } = await orderDomain();
  const store = emptyStore();
  const order = buildOrder(store, orderInput());
  const committed = settleNewOrder(
    store,
    order,
    [cardTender(order.totals.totalMinor, "  POS-004913  ")],
    [],
    NOW + 2,
  );

  assert.deepEqual(committed.order.tender, [
    {
      kind: "card",
      amountMinor: order.totals.totalMinor,
      externalReference: "POS-004913",
    },
  ]);
});

test("immediate settlement rejects under- and over-covered tenders", async () => {
  const { buildOrder, cardTender, cashTender, settleNewOrder } = await orderDomain();
  const store = emptyStore();
  const order = buildOrder(store, orderInput());

  assert.throws(
    () => settleNewOrder(store, order, [cashTender(900, 900)], [], NOW + 3),
    /cover the order total exactly/i,
  );
  assert.throws(
    () => settleNewOrder(store, order, [cardTender(1100)], [], NOW + 3),
    /cover the order total exactly/i,
  );
  assert.equal(store.orders.length, 0);
});

test("stock decrements once when an order first settles", async () => {
  const { applyStockForOrder, buildOrder, cashTender, settleNewOrder } = await orderDomain();
  const base = emptyStore();
  const tracked = {
    ...base.catalogue[0],
    id: "tracked-coffee",
    trackStock: true,
    stockOnHand: 5,
  };
  const store = { ...base, catalogue: [tracked] };
  const order = buildOrder(
    store,
    orderInput({
      lines: [line({ itemId: tracked.id, quantity: 2, unitPriceMinor: tracked.priceMinor })],
    }),
  );
  const first = settleNewOrder(
    store,
    order,
    [cashTender(order.totals.totalMinor, order.totals.totalMinor)],
    [],
    NOW + 4,
  );
  const replay = applyStockForOrder(first.store, order.id, NOW + 5);

  assert.equal(first.store.catalogue[0].stockOnHand, 3);
  assert.equal(replay.catalogue[0].stockOnHand, 3);
  assert.equal(replay.orders[0].stockAppliedAt, NOW + 4);
});

test("a split preserves its external leg and settles only the exact crypto remainder", async () => {
  const {
    awaitNewOrder,
    buildOrder,
    cardTender,
    completeCryptoTender,
  } = await orderDomain();
  const store = emptyStore();
  const order = buildOrder(store, orderInput());
  const waiting = awaitNewOrder(
    store,
    order,
    [cardTender(400, "CARD-77")],
    [],
  );

  assert.equal(waiting.order.status, "awaiting");
  assert.equal(waiting.order.paidAt, null);
  assert.equal(waiting.order.stockAppliedAt, null);
  assert.deepEqual(waiting.order.tender, [
    { kind: "card", amountMinor: 400, externalReference: "CARD-77" },
  ]);

  const settled = completeCryptoTender(waiting.store, {
    orderId: order.id,
    chargeId: "charge-remainder",
    amountMinor: 600,
    payerAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    now: NOW + 6,
  });
  assert.equal(settled.order.status, "paid");
  assert.deepEqual(settled.order.tender, [
    { kind: "card", amountMinor: 400, externalReference: "CARD-77" },
    { kind: "crypto", amountMinor: 600, chargeId: "charge-remainder" },
  ]);
  assert.equal(settled.order.payerAddress, "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");
});

test("settlement binds every adjustment to the immutable order and staff IDs", async () => {
  const { buildOrder, cashTender, settleNewOrder } = await orderDomain();
  const store = emptyStore();
  const order = buildOrder(
    store,
    orderInput({ lines: [line({ adjustmentMinor: 200 })] }),
  );
  const draft = {
    id: "adjustment-1",
    kind: "discount",
    lineId: "line-1",
    lineName: "Counter sale",
    amountMinor: 200,
    reasonCode: "Loyalty reward",
    staffId: "staff-owner",
    staffName: "Ari",
    at: NOW,
  };
  const committed = settleNewOrder(
    store,
    order,
    [cashTender(order.totals.totalMinor, order.totals.totalMinor)],
    [draft],
    NOW + 7,
  );

  assert.deepEqual(committed.store.adjustments[0], {
    ...draft,
    orderId: order.id,
    orderNumber: order.number,
  });
  assert.equal(committed.order.totals.discountMinor, 200);
});

test("a line comp retains the item but removes only that line from the payable total", async () => {
  const { applyTicketAdjustment } = await orderDomain();
  const store = emptyStore();
  const ticket = {
    lines: [line(), line({ id: "line-2", name: "Second line" })],
    discountMinor: 0,
    tipMinor: 0,
  };
  const result = applyTicketAdjustment(store, ticket, {
    id: "adjustment-comp",
    kind: "comp",
    lineId: "line-1",
    amountMinor: 0,
    reasonCode: "Quality complaint",
    actor: staff(),
    now: NOW + 8,
  });

  assert.equal(result.ticket.lines.length, 2);
  assert.equal(result.ticket.lines[0].adjustmentMinor, 1000);
  assert.equal(result.totals.totalMinor, 1000);
  assert.deepEqual(result.adjustment, {
    id: "adjustment-comp",
    kind: "comp",
    lineId: "line-1",
    lineName: "Counter sale",
    amountMinor: 1000,
    reasonCode: "Quality complaint",
    staffId: "staff-owner",
    staffName: "Ari",
    at: NOW + 8,
  });
});

test("a whole-ticket void persists an audit order without moving stock", async () => {
  const {
    applyTicketAdjustment,
    buildOrder,
    voidNewOrder,
  } = await orderDomain();
  const base = emptyStore();
  const tracked = {
    ...base.catalogue[0],
    id: "voided-item",
    trackStock: true,
    stockOnHand: 4,
  };
  const store = { ...base, catalogue: [tracked] };
  const ticket = {
    lines: [line({ itemId: tracked.id, unitPriceMinor: tracked.priceMinor })],
    discountMinor: 0,
    tipMinor: 0,
  };
  const order = buildOrder(store, orderInput(ticket));
  const adjusted = applyTicketAdjustment(store, ticket, {
    id: "adjustment-void",
    kind: "void",
    lineId: null,
    amountMinor: 0,
    reasonCode: "Customer changed mind",
    actor: staff(),
    now: NOW + 9,
  });
  const committed = voidNewOrder(store, order, [adjusted.adjustment]);

  assert.equal(committed.order.status, "voided");
  assert.equal(committed.order.stockAppliedAt, null);
  assert.equal(committed.store.catalogue[0].stockOnHand, 4);
  assert.equal(committed.store.adjustments[0].orderId, order.id);
});

test("the till, tender, adjustment, and receipt surfaces use persisted actions instead of previews", () => {
  const hook = source("src/hooks/useMerchant.tsx");
  const till = source("src/components/merchant/PosTerminal.tsx");
  const tender = source("src/components/merchant/CashTenderSheet.tsx");
  const adjustment = source("src/components/merchant/AdjustmentSheet.tsx");
  const receipt = source("src/components/merchant/ReceiptSheet.tsx");

  for (const production of [till, tender, adjustment, receipt]) {
    assert.doesNotMatch(production, /merchant\/mock|MOCK_|PREVIEW_ORDER|previewOrder|DESIGN MOCK/);
  }
  for (const action of [
    "settleCash",
    "settleCard",
    "startSplitCharge",
    "applyAdjustment",
    "voidLine",
    "compLine",
  ]) {
    assert.match(hook, new RegExp(`\\b${action}\\b`));
  }
  assert.doesNotMatch(till, /would be recorded|Mock notice/);
  assert.match(receipt, /peripherals/);
});
