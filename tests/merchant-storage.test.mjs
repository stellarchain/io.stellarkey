import assert from "node:assert/strict";
import test from "node:test";

import { emptyStore } from "../src/lib/merchant/defaults.ts";
import {
  applyTicketAdjustment,
  buildOrder,
  cashTender,
  settleNewOrder,
} from "../src/lib/merchant/orders.ts";
import * as storage from "../src/lib/merchant/storage.ts";

const TILL = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

function completedOrder(overrides = {}) {
  return {
    id: "order-1",
    number: 1001,
    reference: "MC1001",
    network: "testnet",
    status: "paid",
    lines: [],
    totals: {
      grossMinor: 250,
      discountMinor: 0,
      tipMinor: 0,
      netMinor: 203,
      taxByRate: { standard: 47 },
      taxMinor: 47,
      totalMinor: 250,
    },
    currency: "EUR",
    tender: [],
    staffName: "Owner",
    terminalName: "Counter",
    createdAt: Date.now(),
    paidAt: Date.now(),
    payerAddress: null,
    note: null,
    ...overrides,
  };
}

function sampleStore() {
  const settings = emptyStore().settings;
  const order = completedOrder();
  return {
    version: 3,
    settings: {
      ...settings,
      enabled: true,
      terminalName: "Counter",
      receivingPublicKey: TILL,
    },
    catalogue: emptyStore().catalogue,
    modifierGroups: emptyStore().modifierGroups,
    orders: [order],
    charges: [
      {
        id: "charge-1",
        orderId: order.id,
        reference: order.reference,
        routingId: "4001",
        network: "testnet",
        destination: TILL,
        amountMinor: 250,
        currency: "EUR",
        quotes: [],
        status: "paid",
        createdAt: order.createdAt,
        expiresAt: order.createdAt + 600_000,
        payment: null,
      },
    ],
    refunds: [
      {
        id: "refund-1",
        orderId: order.id,
        network: "testnet",
        amountMinor: 50,
        asset: { code: "XLM", issuer: null },
        amount: "1.0000000",
        destination: TILL,
        reason: "customer_request",
        note: null,
        transactionHash: "abc",
        createdAt: order.createdAt,
      },
    ],
    unmatched: [],
    nextOrderNumber: 1002,
    cursors: { testnet: "123" },
  };
}

test("the operational store defaults to a complete v3 schema", () => {
  const store = emptyStore();
  assert.equal(store.version, 3);
  assert.deepEqual(store.staff, []);
  assert.equal(store.activeStaffId, null);
  assert.deepEqual(store.onShiftStaffIds, []);
  assert.equal(store.settings.operatorLockMode, "after_sale");
  assert.equal(store.settings.operatorLockTimeoutMinutes, 5);
  assert.deepEqual(store.shifts, []);
  assert.deepEqual(store.invoices, []);
  assert.deepEqual(store.counterCodes, []);
  assert.deepEqual(store.counterPayments, []);
  assert.deepEqual(store.customers, []);
  assert.deepEqual(store.adjustments, []);
  assert.deepEqual(store.refundRequests, []);
  assert.deepEqual(store.peripherals, []);
  assert.deepEqual(store.exportRecords, []);
  assert.equal(store.tillTextSize, "standard");
  assert.equal(store.nextShiftNumber, 1);
  assert.equal(store.nextInvoiceNumber, 1);
  assert.equal(store.terminal.name, store.settings.terminalName);
});

test("the decoder rejects POC and incomplete merchant schemas", () => {
  assert.equal(storage.decodeMerchantStore({ ...emptyStore(), version: 1 }), null);
  const incomplete = { ...emptyStore() };
  delete incomplete.onShiftStaffIds;
  assert.equal(storage.decodeMerchantStore(incomplete), null);

  const incompleteOrder = completedOrder();
  delete incompleteOrder.staffId;
  assert.equal(
    storage.decodeMerchantStore({ ...emptyStore(), orders: [incompleteOrder] }),
    null,
  );

  for (const obsoleteShape of [
    { ...emptyStore(), shifts: [{ id: "shift-without-current-actor-fields" }] },
    { ...emptyStore(), refunds: [{ id: "refund-without-current-lifecycle-fields" }] },
    { ...emptyStore(), exportRecords: [{ id: "export-without-current-audit-fields" }] },
    { ...emptyStore(), cursors: { mainnet: "123" } },
  ]) {
    assert.equal(storage.decodeMerchantStore(obsoleteShape), null);
  }
});

test("the decoder rejects minimally shaped records in every merchant collection", () => {
  const paymentShell = {
    asset: { code: "XLM", issuer: null },
    destination: TILL,
  };
  const incompleteCollections = {
    catalogue: [{ id: "item-1" }],
    modifierGroups: [{ id: "group-1" }],
    orders: [{
      id: "order-1",
      lines: [],
      staffId: null,
      stockAppliedAt: null,
      stockExceptions: [],
    }],
    charges: [{ id: "charge-1", payment: null }],
    refunds: [{
      id: "refund-1",
      kind: "order",
      sourcePaymentId: null,
      submissionStatus: "confirmed",
    }],
    unmatched: [{
      id: "payment-1",
      destination: TILL,
      reconciliationOutcome: "unmatched",
      candidateChargeId: null,
      candidateInvoiceId: null,
    }],
    paymentReconciliations: [{
      id: "payment-1",
      payment: paymentShell,
      outcome: "unmatched",
      chargeId: null,
      orderId: null,
      invoiceId: null,
      amountMinor: null,
      reversalAmount: null,
      resolution: null,
    }],
    staff: [{ id: "staff-1" }],
    shifts: [{
      id: "shift-1",
      openedById: "staff-1",
      closedById: null,
      closedBy: null,
      terminalName: "Counter",
      network: "testnet",
      zReport: null,
    }],
    invoices: [{
      id: "invoice-1",
      network: "testnet",
      destination: null,
      quotes: [],
      payments: [],
      createdAt: 1,
      updatedAt: 1,
      createdById: "staff-1",
      createdBy: "Owner",
      issuedAt: null,
      issuedById: null,
      issuedBy: null,
      voidedAt: null,
      voidedById: null,
      voidedBy: null,
      voidReason: null,
    }],
    counterCodes: [{
      id: "code-1",
      network: "testnet",
      destination: TILL,
      requestMessage: "Pay StellarKey",
      quotes: [],
      expiresAt: null,
      createdAt: 1,
      updatedAt: 1,
      createdById: "staff-1",
      createdBy: "Owner",
    }],
    counterPayments: [{
      id: "payment-1",
      codeId: "code-1",
      payment: paymentShell,
      amountMinor: null,
      quote: null,
      seenAt: 1,
    }],
    customers: [{
      address: TILL,
      name: null,
      preferredAsset: { code: "XLM", issuer: null },
      sourceIds: [],
      loyalty: null,
      note: null,
    }],
    adjustments: [{
      id: "adjustment-1",
      orderId: "order-1",
      lineId: null,
      staffId: "staff-1",
    }],
    refundRequests: [{ id: "request-1", sourcePaymentId: null }],
    peripherals: [{ id: "printer-1" }],
  };

  for (const [field, records] of Object.entries(incompleteCollections)) {
    assert.equal(
      storage.decodeMerchantStore({ ...emptyStore(), [field]: records }),
      null,
      `${field} accepted an incomplete current-schema record`,
    );
  }
});

test("a current store decodes every operational collection", () => {
  const store = {
    ...emptyStore(),
    settings: { ...emptyStore().settings, recordRetentionMonths: null },
    activeStaffId: "staff-1",
    onShiftStaffIds: ["staff-1"],
    staff: [
      {
        id: "staff-1",
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
      },
    ],
    shifts: [
      {
        id: "shift-1",
        number: 1,
        openedAt: 10,
        closedAt: null,
        openedById: "staff-1",
        openedBy: "staff-1",
        closedById: null,
        closedBy: null,
        terminalName: "This device",
        network: "mainnet",
        floatMinor: 5000,
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
      },
    ],
    customers: [
      {
        address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        name: "Customer",
        firstSeenAt: 1,
        lastSeenAt: 2,
        orderCount: 1,
        lifetimeMinor: 250,
        averageMinor: 250,
        preferredAsset: { code: "XLM", issuer: null },
        sourceIds: [],
        loyalty: null,
        note: null,
      },
    ],
    tillTextSize: "large",
    nextShiftNumber: 2,
    nextInvoiceNumber: 18,
  };

  assert.deepEqual(storage.decodeMerchantStore(store), store);
});

test("a merchant can persist zero accepted assets to pause new charges", () => {
  const store = {
    ...emptyStore(),
    settings: { ...emptyStore().settings, acceptedAssets: [] },
  };

  assert.equal(storage.decodeMerchantStore(store), store);
});

test("a type-valid order line may omit its optional adjustment", () => {
  const base = emptyStore();
  const order = buildOrder(base, {
    id: "order-without-adjustment",
    network: "testnet",
    lines: [{
      id: "line-1",
      itemId: null,
      name: "Keypad amount",
      quantity: 1,
      unitPriceMinor: 500,
      modifiers: [],
      taxRateId: "standard",
      note: null,
    }],
    discountMinor: 0,
    tipMinor: 0,
    staffId: null,
    staffName: "Owner",
    now: 1,
  });
  const store = { ...base, orders: [order] };

  assert.equal(storage.decodeMerchantStore(store), store);
});

test("an invoice-only payment refund request persists its zero order number", () => {
  const request = {
    id: "refund-request-1",
    orderId: "invoice-1",
    orderNumber: 0,
    invoiceId: "invoice-1",
    invoiceNumber: "INV-2026-0001",
    amountMinor: 250,
    reason: "overpayment",
    note: null,
    sourcePaymentId: "payment-1",
    requestedById: "staff-1",
    requestedBy: "Owner",
    requestedAt: 1,
    status: "pending",
    reviewedById: null,
    reviewedAt: null,
    refundId: null,
  };
  const store = { ...emptyStore(), refundRequests: [request] };

  assert.equal(storage.decodeMerchantStore(store), store);
});

test("a settled cash order reloads with tender, stock, and adjustment audit intact", () => {
  const now = Date.now();
  const actor = {
    id: "staff-owner",
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
  const line = {
    id: "line-stock",
    itemId: "item-stock",
    name: "Stock item",
    quantity: 1,
    unitPriceMinor: 500,
    modifiers: [],
    taxRateId: "standard",
    note: null,
    adjustmentMinor: 0,
  };
  const base = {
    ...emptyStore(),
    catalogue: [
      {
        id: "item-stock",
        name: "Stock item",
        sku: "STOCK",
        category: "Test",
        priceMinor: 500,
        taxRateId: "standard",
        colour: "#0A84FF",
        modifierGroupIds: [],
        trackStock: true,
        stockOnHand: 2,
        lowStockAt: 1,
        active: true,
        sortIndex: 0,
      },
    ],
  };
  const ticket = { lines: [line], discountMinor: 0, tipMinor: 0 };
  const adjusted = applyTicketAdjustment(base, ticket, {
    id: "adjustment-live",
    kind: "discount",
    lineId: line.id,
    amountMinor: 100,
    reasonCode: "Loyalty",
    actor,
    now,
  });
  const order = buildOrder(base, {
    id: "order-live",
    network: "testnet",
    ...adjusted.ticket,
    staffId: actor.id,
    staffName: actor.name,
    now: now + 1,
  });
  const committed = settleNewOrder(
    base,
    order,
    [cashTender(order.totals.totalMinor, 500)],
    [adjusted.adjustment],
    now + 2,
  ).store;
  const reloaded = storage.decodeMerchantStore(committed);
  assert.deepEqual(reloaded.orders[0].tender, [
    { kind: "cash", amountMinor: order.totals.totalMinor, receivedMinor: 500, changeMinor: 100 },
  ]);
  assert.equal(reloaded.orders[0].stockAppliedAt, now + 2);
  assert.equal(reloaded.catalogue[0].stockOnHand, 1);
  assert.equal(reloaded.adjustments[0].orderId, "order-live");
  assert.equal(reloaded.adjustments[0].staffId, actor.id);
});

test("pruning retains every unresolved financial record", () => {
  const old = Date.now() - 900 * 86_400_000;
  const store = {
    ...emptyStore(),
    orders: [
      completedOrder({ id: "closed", status: "paid", createdAt: old }),
      completedOrder({ id: "open", status: "open", createdAt: old }),
      completedOrder({ id: "awaiting", status: "awaiting", createdAt: old }),
    ],
    charges: [
      {
        ...sampleStore().charges[0],
        id: "pending-charge",
        orderId: "missing-order",
        status: "awaiting",
        createdAt: old,
      },
    ],
    invoices: [
      {
        id: "invoice-1",
        number: "INV-1",
        status: "sent",
        customerName: "Customer",
        customerEmail: null,
        customerAddress: null,
        reference: "INV1",
        lines: [],
        totals: completedOrder().totals,
        currency: "EUR",
        issuedAt: old,
        dueAt: old,
        paidAt: null,
        paidMinor: 0,
        note: null,
      },
    ],
    refundRequests: [
      {
        id: "request-1",
        orderNumber: 1001,
        amountMinor: 100,
        reason: "other",
        requestedBy: "staff-1",
        requestedAt: old,
        status: "pending",
      },
    ],
  };

  const pruned = storage.prune(store, 30);
  assert.deepEqual(pruned.orders.map((order) => order.id), ["open", "awaiting"]);
  assert.equal(pruned.charges.length, 1);
  assert.equal(pruned.invoices.length, 1);
  assert.equal(pruned.refundRequests.length, 1);
});

test("pruning keeps the order graph behind an unresolved payment and tracked refund", () => {
  const old = Date.now() - 900 * 86_400_000;
  const order = completedOrder({ id: "review-order", status: "paid", createdAt: old });
  const charge = {
    ...sampleStore().charges[0],
    id: "review-charge",
    orderId: order.id,
    status: "paid",
    createdAt: old,
  };
  const payment = {
    id: "review-payment",
    transactionHash: "a".repeat(64),
    ledger: 123,
    from: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    amount: "1.0000000",
    asset: { code: "XLM", issuer: null },
    memo: "M1001",
    createdAt: new Date(old).toISOString(),
  };
  const store = {
    ...emptyStore(),
    orders: [order],
    charges: [charge],
    unmatched: [{
      ...payment,
      seenAt: old,
      reconciliationOutcome: "duplicate",
      candidateChargeId: charge.id,
    }],
    paymentReconciliations: [{
      id: payment.id,
      network: "mainnet",
      payment,
      outcome: "duplicate",
      chargeId: charge.id,
      orderId: order.id,
      amountMinor: 100,
      observedAt: old,
      resolution: null,
    }],
    refunds: [{
      id: "tracked-refund",
      orderId: order.id,
      kind: "payment_reversal",
      sourcePaymentId: payment.id,
      network: "mainnet",
      amountMinor: 100,
      asset: payment.asset,
      amount: payment.amount,
      destination: payment.from,
      reason: "duplicate",
      note: null,
      transactionHash: "b".repeat(64),
      submissionStatus: "status_unknown",
      createdAt: old,
    }],
  };

  const pruned = storage.prune(store, 30);
  assert.deepEqual(pruned.orders.map((entry) => entry.id), [order.id]);
  assert.deepEqual(pruned.charges.map((entry) => entry.id), [charge.id]);
  assert.deepEqual(pruned.unmatched.map((entry) => entry.id), [payment.id]);
  assert.deepEqual(pruned.paymentReconciliations.map((entry) => entry.id), [payment.id]);
  assert.deepEqual(pruned.refunds.map((entry) => entry.id), ["tracked-refund"]);
});

test("retention removes expired customer PII but preserves unresolved provenance", () => {
  const now = Date.now();
  const old = now - 900 * 86_400_000;
  const recent = now - 2 * 86_400_000;
  const customer = (address, sourceId, lastSeenAt, note) => ({
    address,
    name: `Name ${sourceId}`,
    firstSeenAt: lastSeenAt,
    lastSeenAt,
    orderCount: 1,
    lifetimeMinor: 100,
    averageMinor: 100,
    preferredAsset: { code: "XLM", issuer: null },
    sourceIds: [sourceId],
    loyalty: {
      stamps: 1,
      target: 10,
      redeemedCount: 0,
      events: [{ id: `event-${sourceId}`, kind: "earned", sourceId, at: lastSeenAt, actorId: null, actorName: null }],
    },
    note,
  });
  const unresolvedPayment = {
    id: "unresolved-source",
    network: "mainnet",
    payment: {
      id: "unresolved-source",
      transactionHash: "c".repeat(64),
      ledger: 5,
      from: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      amount: "1.0000000",
      asset: { code: "XLM", issuer: null },
      memo: null,
      createdAt: new Date(old).toISOString(),
    },
    outcome: "unmatched",
    chargeId: null,
    orderId: null,
    amountMinor: null,
    observedAt: old,
    resolution: null,
  };
  const store = {
    ...emptyStore(),
    customers: [
      customer("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF", "expired", old, "delete me"),
      customer("GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBPLO", "recent", recent, "keep me"),
      customer("GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC3", "unresolved-source", old, "expire note"),
    ],
    paymentReconciliations: [unresolvedPayment],
  };

  const pruned = storage.prune(store, 30);
  assert.deepEqual(pruned.customers.map((entry) => entry.sourceIds[0]), ["recent", "unresolved-source"]);
  assert.equal(pruned.customers[0].note, "keep me");
  assert.equal(pruned.customers[1].note, null);
  assert.deepEqual(pruned.customers[1].sourceIds, ["unresolved-source"]);
  assert.deepEqual(pruned.customers[1].loyalty.events.map((event) => event.sourceId), ["unresolved-source"]);
});
