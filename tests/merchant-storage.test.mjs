import assert from "node:assert/strict";
import test from "node:test";

import { emptyStore } from "../src/lib/merchant/defaults.ts";
import * as storage from "../src/lib/merchant/storage.ts";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    snapshot() {
      return Object.fromEntries(values);
    },
  };
}

function withWindow(localStorage, fn) {
  const prior = globalThis.window;
  globalThis.window = { localStorage };
  try {
    return fn();
  } finally {
    if (prior === undefined) delete globalThis.window;
    else globalThis.window = prior;
  }
}

function legacyOrder(overrides = {}) {
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

function legacyStore() {
  const settings = emptyStore().settings;
  const order = legacyOrder();
  return {
    version: 1,
    settings: { ...settings, enabled: true, terminalName: "Counter" },
    catalogue: emptyStore().catalogue,
    modifierGroups: emptyStore().modifierGroups,
    orders: [order],
    charges: [
      {
        id: "charge-1",
        orderId: order.id,
        reference: order.reference,
        network: "testnet",
        destination: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
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
        destination: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
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

test("the operational store defaults to a complete v2 schema", () => {
  const store = emptyStore();
  assert.equal(store.version, 2);
  assert.deepEqual(store.staff, []);
  assert.equal(store.activeStaffId, null);
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

test("a v2 store round-trips every operational collection", () => {
  assert.equal(typeof storage.MERCHANT_LEGACY_STORAGE_KEY, "string");
  const localStorage = memoryStorage();
  const store = {
    ...emptyStore(),
    activeStaffId: "staff-1",
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
        openedBy: "staff-1",
        closedBy: null,
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
        loyalty: null,
        note: null,
      },
    ],
    tillTextSize: "large",
    nextShiftNumber: 2,
    nextInvoiceNumber: 18,
  };

  withWindow(localStorage, () => {
    assert.equal(storage.saveMerchantStore(store), true);
    assert.deepEqual(storage.loadMerchantStore(), store);
  });
});

test("loading a v1 store migrates core records to v2 before removing the legacy key", () => {
  assert.equal(typeof storage.MERCHANT_LEGACY_STORAGE_KEY, "string");
  const legacy = legacyStore();
  const localStorage = memoryStorage({
    [storage.MERCHANT_LEGACY_STORAGE_KEY]: JSON.stringify(legacy),
  });

  withWindow(localStorage, () => {
    const migrated = storage.loadMerchantStore();
    assert.equal(migrated.version, 2);
    assert.deepEqual(migrated.orders, legacy.orders);
    assert.deepEqual(migrated.charges, legacy.charges);
    assert.deepEqual(migrated.refunds, legacy.refunds);
    assert.equal(migrated.nextOrderNumber, 1002);
    assert.equal(migrated.terminal.name, "Counter");

    const values = localStorage.snapshot();
    assert.equal(values[storage.MERCHANT_LEGACY_STORAGE_KEY], undefined);
    assert.equal(JSON.parse(values[storage.MERCHANT_STORAGE_KEY]).version, 2);
  });
});

test("nested partial settings reconcile and malformed collections are discarded", () => {
  const localStorage = memoryStorage({
    [storage.MERCHANT_STORAGE_KEY]: JSON.stringify({
      version: 2,
      settings: {
        enabled: true,
        profile: { name: "North Star" },
        tips: { mode: "off" },
        terminalName: "Front till",
      },
      catalogue: "corrupt",
      modifierGroups: null,
      orders: [],
      charges: [],
      staff: "corrupt",
      activeStaffId: "missing-staff",
      customers: [null, { address: 123 }],
      tillTextSize: "enormous",
      nextOrderNumber: -1,
    }),
  });

  withWindow(localStorage, () => {
    const recovered = storage.loadMerchantStore();
    assert.equal(recovered.settings.enabled, true);
    assert.equal(recovered.settings.profile.name, "North Star");
    assert.deepEqual(recovered.settings.profile.addressLines, []);
    assert.equal(recovered.settings.tips.mode, "off");
    assert.deepEqual(recovered.settings.tips.percents, [10, 15, 20]);
    assert.equal(recovered.catalogue.length, emptyStore().catalogue.length);
    assert.deepEqual(recovered.staff, []);
    assert.equal(recovered.activeStaffId, null);
    assert.deepEqual(recovered.customers, []);
    assert.equal(recovered.tillTextSize, "standard");
    assert.equal(recovered.nextOrderNumber, 1001);
    assert.equal(recovered.terminal.name, "Front till");
  });
});

test("a failed v2 migration write leaves the recoverable v1 payload intact", () => {
  const legacy = legacyStore();
  const localStorage = memoryStorage({
    [storage.MERCHANT_LEGACY_STORAGE_KEY]: JSON.stringify(legacy),
  });
  const setItem = localStorage.setItem;
  localStorage.setItem = (key, value) => {
    if (key === storage.MERCHANT_STORAGE_KEY) throw new Error("quota");
    setItem.call(localStorage, key, value);
  };

  withWindow(localStorage, () => {
    const migratedInMemory = storage.loadMerchantStore();
    assert.equal(migratedInMemory.version, 2);
    assert.equal(localStorage.getItem(storage.MERCHANT_STORAGE_KEY), null);
    assert.equal(
      localStorage.getItem(storage.MERCHANT_LEGACY_STORAGE_KEY),
      JSON.stringify(legacy),
    );
  });
});

test("future versions are rejected without overwriting their data", () => {
  const future = JSON.stringify({ version: 99, orders: [{ id: "future" }] });
  const localStorage = memoryStorage({ [storage.MERCHANT_STORAGE_KEY]: future });

  withWindow(localStorage, () => {
    assert.deepEqual(storage.loadMerchantStore(), emptyStore());
    assert.equal(localStorage.getItem(storage.MERCHANT_STORAGE_KEY), future);
  });
});

test("pruning retains every unresolved financial record", () => {
  const old = Date.now() - 900 * 86_400_000;
  const store = {
    ...emptyStore(),
    orders: [
      legacyOrder({ id: "closed", status: "paid", createdAt: old }),
      legacyOrder({ id: "open", status: "open", createdAt: old }),
      legacyOrder({ id: "awaiting", status: "awaiting", createdAt: old }),
    ],
    charges: [
      {
        ...legacyStore().charges[0],
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
        totals: legacyOrder().totals,
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

test("clearing merchant storage removes both schema generations", () => {
  assert.equal(typeof storage.MERCHANT_LEGACY_STORAGE_KEY, "string");
  const localStorage = memoryStorage({
    [storage.MERCHANT_STORAGE_KEY]: "v2",
    [storage.MERCHANT_LEGACY_STORAGE_KEY]: "v1",
    unrelated: "keep",
  });

  withWindow(localStorage, () => storage.clearMerchantStore());
  assert.deepEqual(localStorage.snapshot(), { unrelated: "keep" });
});
