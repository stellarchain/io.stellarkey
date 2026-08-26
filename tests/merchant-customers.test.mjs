import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { emptyStore } from "../src/lib/merchant/defaults.ts";

const NOW = 1_800_000_000_000;
const CUSTOMER = "GCUXWZHL7FGVL3MVYH6N5G3RACCKAC7ZLTUBKKN4I5MCCTDPJXITNGFD";
const OTHER = "GDVPZQMATHMBM6B3V5JK4SYOFBTCVTLV4TLFNP5LMFW3NAU7D63ZFKIO";
const ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const USDC = { code: "USDC", issuer: ISSUER };
const XLM = { code: "XLM", issuer: null };

async function customerDomain() {
  try {
    return await import("../src/lib/merchant/customers.ts");
  } catch (error) {
    assert.fail(`The customer domain is missing: ${error instanceof Error ? error.message : error}`);
  }
}

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function actor() {
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
  };
}

function storeWithActor() {
  const member = actor();
  return {
    member,
    store: { ...emptyStore(), staff: [member], activeStaffId: member.id },
  };
}

function order(id, address, amountMinor, at, asset = USDC) {
  return {
    id,
    number: Number(id.replace(/\D/g, "")) || 1,
    reference: `ORDER${id}`,
    network: "mainnet",
    status: "paid",
    lines: [],
    totals: {
      grossMinor: amountMinor,
      discountMinor: 0,
      tipMinor: 0,
      netMinor: amountMinor,
      taxByRate: {},
      taxMinor: 0,
      totalMinor: amountMinor,
    },
    currency: "EUR",
    tender: [{ kind: "crypto", amountMinor, chargeId: `charge-${id}` }],
    staffId: "staff-owner",
    staffName: "Ari",
    terminalName: "Front till",
    createdAt: at - 100,
    paidAt: at,
    stockAppliedAt: at,
    payerAddress: address,
    note: null,
    charge: {
      id: `charge-${id}`,
      orderId: id,
      reference: `ORDER${id}`,
      network: "mainnet",
      destination: OTHER,
      amountMinor,
      currency: "EUR",
      quotes: [],
      status: "paid",
      createdAt: at - 100,
      expiresAt: at + 100,
      payment: {
        id: `payment-${id}`,
        transactionHash: id.padEnd(64, "a").slice(0, 64),
        ledger: 123,
        from: address,
        amount: "1.0000000",
        asset,
        memo: `ORDER${id}`,
        createdAt: new Date(at).toISOString(),
        lane: "memo",
      },
    },
  };
}

function invoice(id, payments, status = "paid") {
  const paidMinor = payments.reduce((sum, payment) => sum + payment.amountMinor, 0);
  return {
    id,
    number: `INV-2027-${id}`,
    status,
    customerName: "Ledger customer",
    customerEmail: null,
    customerAddress: payments[0]?.from ?? null,
    reference: `INV${id}`,
    network: "mainnet",
    destination: OTHER,
    quotes: [],
    payments,
    lines: [],
    totals: {
      grossMinor: paidMinor,
      discountMinor: 0,
      tipMinor: 0,
      netMinor: paidMinor,
      taxByRate: {},
      taxMinor: 0,
      totalMinor: paidMinor,
    },
    currency: "EUR",
    issuedAt: NOW - 10_000,
    dueAt: NOW + 86_400_000,
    paidAt: status === "paid" ? NOW : null,
    paidMinor,
    note: null,
    createdAt: NOW - 20_000,
    updatedAt: NOW,
    createdById: "staff-owner",
    createdBy: "Ari",
    issuedById: "staff-owner",
    issuedBy: "Ari",
    voidedAt: null,
    voidedById: null,
    voidedBy: null,
    voidReason: null,
  };
}

function invoicePayment(id, from, amountMinor, asset, at) {
  return {
    id,
    kind: "stellar",
    network: "mainnet",
    amountMinor,
    asset,
    amount: "1.0000000",
    transactionHash: id.padEnd(64, "b").slice(0, 64),
    from,
    observedAt: at,
    recordedById: null,
    recordedBy: null,
    note: null,
  };
}

test("payer visits are durable, contact-matched, and idempotent", async () => {
  const { recordCustomerVisit } = await customerDomain();
  const first = recordCustomerVisit(emptyStore(), {
    sourceId: "order:1",
    address: CUSTOMER,
    amountMinor: 450,
    asset: USDC,
    at: NOW,
    contacts: [{ name: "Marta", address: CUSTOMER }],
  });
  assert.deepEqual(first.customers[0], {
    address: CUSTOMER,
    name: "Marta",
    firstSeenAt: NOW,
    lastSeenAt: NOW,
    orderCount: 1,
    lifetimeMinor: 450,
    averageMinor: 450,
    preferredAsset: USDC,
    sourceIds: ["order:1"],
    loyalty: null,
    note: null,
  });

  const replay = recordCustomerVisit(first, {
    sourceId: "order:1",
    address: CUSTOMER,
    amountMinor: 450,
    asset: USDC,
    at: NOW,
    contacts: [{ name: "Marta", address: CUSTOMER }],
  });
  assert.deepEqual(replay, first);

  const second = recordCustomerVisit(replay, {
    sourceId: "invoice-payment:2",
    address: CUSTOMER,
    amountMinor: 550,
    asset: XLM,
    at: NOW + 100,
    contacts: [],
  });
  assert.equal(second.customers[0].name, "Marta");
  assert.equal(second.customers[0].orderCount, 2);
  assert.equal(second.customers[0].lifetimeMinor, 1000);
  assert.equal(second.customers[0].averageMinor, 500);
  assert.deepEqual(second.customers[0].preferredAsset, XLM);
});

test("only new crypto settlements create customer visits and history is exact", async () => {
  const { customerHistory, reconcileCustomerSettlements } = await customerDomain();
  const firstOrder = order("1", CUSTOMER, 700, NOW - 1000, USDC);
  const newOrder = order("2", CUSTOMER, 300, NOW, XLM);
  const previous = {
    ...emptyStore(),
    orders: [firstOrder],
    charges: [firstOrder.charge],
  };
  const stellar = invoicePayment("invoice-pay-1", CUSTOMER, 900, USDC, NOW + 100);
  const manual = { ...invoicePayment("manual-pay", null, 100, null, NOW + 200), kind: "manual" };
  const current = {
    ...previous,
    orders: [newOrder, firstOrder],
    charges: [newOrder.charge, firstOrder.charge],
    invoices: [invoice("0001", [stellar, manual])],
  };
  const reconciled = reconcileCustomerSettlements(previous, current, {
    contacts: [{ name: "Marta", address: CUSTOMER }],
  });

  assert.equal(reconciled.customers.length, 1);
  assert.equal(reconciled.customers[0].orderCount, 2);
  assert.equal(reconciled.customers[0].lifetimeMinor, 1200);
  assert.deepEqual(reconciled.customers[0].sourceIds, ["order:2", "invoice-payment:invoice-pay-1"]);
  assert.deepEqual(
    customerHistory(reconciled, CUSTOMER).map((entry) => [entry.kind, entry.id, entry.amountMinor]),
    [["invoice", "invoice-pay-1", 900], ["order", "2", 300], ["order", "1", 700]],
  );
});

test("contact synchronization and notes persist without inventing identity", async () => {
  const { recordCustomerVisit, syncCustomerContacts, updateCustomerNote } = await customerDomain();
  let store = recordCustomerVisit(emptyStore(), {
    sourceId: "order:1",
    address: CUSTOMER,
    amountMinor: 100,
    asset: XLM,
    at: NOW,
    contacts: [],
  });
  assert.equal(store.customers[0].name, null);
  store = syncCustomerContacts(store, [{ name: "Owned contact", address: CUSTOMER }]);
  assert.equal(store.customers[0].name, "Owned contact");
  store = updateCustomerNote(store, CUSTOMER, "Oat flat white");
  assert.equal(store.customers[0].note, "Oat flat white");
  assert.throws(() => updateCustomerNote(store, CUSTOMER, "x".repeat(141)), /140/);
  assert.equal(syncCustomerContacts(store, []).customers[0].name, null);
});

test("loyalty opening, earning, and redemption retain an actor audit", async () => {
  const {
    recordCustomerVisit,
    redeemLoyaltyReward,
    startLoyaltyCard,
  } = await customerDomain();
  const { member, store: base } = storeWithActor();
  let store = recordCustomerVisit(base, {
    sourceId: "order:1",
    address: CUSTOMER,
    amountMinor: 100,
    asset: XLM,
    at: NOW,
    contacts: [],
  });
  store = startLoyaltyCard(store, {
    address: CUSTOMER,
    target: 2,
    actor: member,
    eventId: "loyalty-open",
    now: NOW + 1,
  });
  store = recordCustomerVisit(store, {
    sourceId: "order:2",
    address: CUSTOMER,
    amountMinor: 200,
    asset: XLM,
    at: NOW + 2,
    contacts: [],
  });
  store = recordCustomerVisit(store, {
    sourceId: "order:3",
    address: CUSTOMER,
    amountMinor: 300,
    asset: XLM,
    at: NOW + 3,
    contacts: [],
  });
  assert.equal(store.customers[0].loyalty.stamps, 2);
  assert.deepEqual(
    store.customers[0].loyalty.events.map((event) => event.kind),
    ["opened", "earned", "earned"],
  );

  store = redeemLoyaltyReward(store, {
    address: CUSTOMER,
    actor: member,
    eventId: "loyalty-redeem",
    now: NOW + 4,
  });
  assert.equal(store.customers[0].loyalty.stamps, 0);
  assert.equal(store.customers[0].loyalty.redeemedCount, 1);
  assert.deepEqual(store.customers[0].loyalty.events.at(-1), {
    id: "loyalty-redeem",
    kind: "redeemed",
    sourceId: null,
    at: NOW + 4,
    actorId: member.id,
    actorName: member.name,
  });
});

test("forget removes only the local profile and leaves financial history intact", async () => {
  const { forgetCustomer, recordCustomerVisit } = await customerDomain();
  const paidOrder = order("1", CUSTOMER, 700, NOW, USDC);
  let store = {
    ...emptyStore(),
    orders: [paidOrder],
    charges: [paidOrder.charge],
  };
  store = recordCustomerVisit(store, {
    sourceId: "order:1",
    address: CUSTOMER,
    amountMinor: 700,
    asset: USDC,
    at: NOW,
    contacts: [],
  });
  const forgotten = forgetCustomer(store, CUSTOMER);
  assert.deepEqual(forgotten.customers, []);
  assert.equal(forgotten.orders.length, 1);
  assert.equal(forgotten.charges.length, 1);
});

test("production customer surfaces use persisted actions, contacts, real history, and receipts", () => {
  const page = source("src/components/merchant/CustomersPage.tsx");
  const detail = source("src/components/merchant/CustomerDetailModal.tsx");
  const receipt = source("src/components/merchant/ReceiptSheet.tsx");
  const hook = source("src/hooks/useMerchant.tsx");
  for (const screen of [page, detail]) {
    assert.doesNotMatch(screen, /merchant\/mock|MOCK_CUSTOMERS|MOCK_INVOICES|MOCK_NOW/);
  }
  assert.match(page, /customers/);
  assert.doesNotMatch(page, /setCustomers\(/);
  assert.match(detail, /updateCustomerNote|startLoyaltyCard|redeemLoyaltyReward|forgetCustomer/);
  assert.match(detail, /addContact|customerHistory/);
  assert.doesNotMatch(detail, /on this screen|would be opened|would write/);
  assert.match(receipt, /loyalty|Loyalty/i);
  assert.match(hook, /reconcileCustomerSettlements/);
  assert.match(hook, /syncCustomerContacts/);
});
