import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createCharge } from "../src/lib/merchant/charge.ts";
import { defaultSettings, emptyStore } from "../src/lib/merchant/defaults.ts";
import {
  attachReconciledPayment,
  bulkDismissPendingReconciliations,
  dismissReconciledPayment,
  markReconciledRefund,
  pendingReconciliationTray,
  reconcileIncomingPayments,
} from "../src/lib/merchant/reconciliation.ts";
import { recordRefundSubmission } from "../src/lib/merchant/refunds.ts";
import { closeShift, openShift, unresolvedShiftFlows } from "../src/lib/merchant/shifts.ts";
import { fetchIncomingPayments } from "../src/lib/merchant/watch.ts";

const NOW = 1_800_000_000_000;
const TILL = "GAVLAAAWTBEO5XJELA3TID4XVHELGTFYRMMFRU2MQ25C5VVCBI476ZVG";
const PAYER = "GCUXWZHL7FGVL3MVYH6N5G3RACCKAC7ZLTUBKKN4I5MCCTDPJXITNGFD";
const ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const USDC = { code: "USDC", issuer: ISSUER };

function actor() {
  return {
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
}

function awaitingStore({ split = false, expiresAt = NOW + 60_000 } = {}) {
  const base = emptyStore();
  const settings = {
    ...defaultSettings(),
    profile: { ...base.settings.profile, name: "Merchant" },
    receivingPublicKey: TILL,
    acceptedAssets: [USDC],
  };
  const item = {
    ...base.catalogue[0],
    id: "stock-item",
    name: "Stock item",
    priceMinor: 1_000,
    trackStock: true,
    stockOnHand: 2,
  };
  const order = { shiftId: null,
    id: "order-1",
    number: 1001,
    reference: "M1001",
    network: "mainnet",
    status: "awaiting",
    lines: [
      {
        id: "line-1",
        itemId: item.id,
        name: item.name,
        quantity: 1,
        unitPriceMinor: 1_000,
        modifiers: [],
        taxRateId: item.taxRateId,
        note: null,
        adjustmentMinor: 0,
      },
    ],
    totals: {
      grossMinor: 1_000,
      discountMinor: 0,
      tipMinor: 0,
      netMinor: 1_000,
      taxByRate: {},
      taxMinor: 0,
      totalMinor: 1_000,
    },
    currency: "EUR",
    tender: split ? [{ kind: "card", amountMinor: 400, externalReference: "CARD-1" }] : [],
    staffId: actor().id,
    staffName: actor().name,
    terminalName: "Counter",
    createdAt: NOW - 1_000,
    paidAt: null,
    stockAppliedAt: null,
    payerAddress: null,
    note: null,
  };
  const amountMinor = split ? 600 : 1_000;
  const charge = createCharge({
    order,
    settings,
    network: "mainnet",
    destination: TILL,
    quotes: [{ asset: USDC, currencyPerUnit: 1 }],
    amountMinor,
    now: NOW - 1_000,
    id: "charge-1",
    routingId: "5001",
  });
  return {
    ...base,
    settings,
    catalogue: [item],
    orders: [order],
    charges: [{ ...charge, expiresAt }],
    staff: [actor()],
    activeStaffId: actor().id,
  };
}

function payment(overrides = {}) {
  return {
    id: "payment-1",
    transactionHash: "a".repeat(64),
    ledger: 60_000_001,
    from: PAYER,
    destination: TILL,
    amount: "10.0000000",
    asset: USDC,
    routingId: "5001",
    routingConflict: false,
    memo: null,
    createdAt: "2027-01-15T08:00:00Z",
    ...overrides,
  };
}

test("an exact split payment settles the remainder and replay is idempotent", () => {
  const initial = awaitingStore({ split: true });
  const first = reconcileIncomingPayments(initial, {
    network: "mainnet",
    payments: [payment({ amount: "6.0000000" })],
    now: NOW,
  });

  assert.equal(first.orders[0].status, "paid");
  assert.deepEqual(first.orders[0].tender, [
    { kind: "card", amountMinor: 400, externalReference: "CARD-1" },
    { kind: "crypto", amountMinor: 600, chargeId: "charge-1" },
  ]);
  assert.equal(first.catalogue[0].stockOnHand, 1);
  assert.equal(first.paymentReconciliations[0].outcome, "settled");
  assert.equal(first.paymentReconciliations[0].amountMinor, 600);
  assert.deepEqual(first.unmatched, []);

  const replay = reconcileIncomingPayments(first, {
    network: "mainnet",
    payments: [payment({ amount: "6.0000000" })],
    now: NOW + 5_000,
  });
  assert.equal(replay, first);
  assert.equal(replay.catalogue[0].stockOnHand, 1);
  assert.equal(replay.paymentReconciliations.length, 1);
});

test("a confirmed payment settles even when another sale depleted its stock", () => {
  const initial = awaitingStore();
  initial.catalogue[0].stockOnHand = 0;

  const settled = reconcileIncomingPayments(initial, {
    network: "mainnet",
    payments: [payment()],
    now: NOW,
  });

  assert.equal(settled.orders[0].status, "paid");
  assert.equal(settled.charges[0].status, "paid");
  assert.equal(settled.paymentReconciliations[0].outcome, "settled");
  assert.equal(settled.catalogue[0].stockOnHand, -1);
  assert.equal(settled.orders[0].stockAppliedAt, NOW);
  assert.deepEqual(settled.orders[0].stockExceptions, [
    {
      reason: "insufficient_stock",
      itemId: "stock-item",
      itemName: "Stock item",
      requested: 1,
      available: 0,
      recordedAt: NOW,
    },
  ]);
});

for (const [label, amount, outcome, chargeStatus] of [
  ["underpayment", "8.0000000", "underpaid", "underpaid"],
  ["overpayment", "12.0000000", "overpaid", "overpaid"],
]) {
  test(`${label} is retained for action without settling the order`, () => {
    const reconciled = reconcileIncomingPayments(awaitingStore(), {
      network: "mainnet",
      payments: [payment({ amount })],
      now: NOW,
    });

    assert.equal(reconciled.orders[0].status, "awaiting");
    assert.equal(reconciled.orders[0].stockAppliedAt, null);
    assert.equal(reconciled.charges[0].status, chargeStatus);
    assert.equal(reconciled.paymentReconciliations[0].outcome, outcome);
    assert.equal(reconciled.unmatched[0].reconciliationOutcome, outcome);
    assert.equal(reconciled.unmatched[0].candidateChargeId, "charge-1");
  });
}

test("an exact payment after expiry is late and never auto-settles", () => {
  const reconciled = reconcileIncomingPayments(awaitingStore({ expiresAt: NOW - 1 }), {
    network: "mainnet",
    payments: [payment()],
    now: NOW,
  });

  assert.equal(reconciled.orders[0].status, "awaiting");
  assert.equal(reconciled.charges[0].status, "expired");
  assert.equal(reconciled.paymentReconciliations[0].outcome, "late");
  assert.equal(reconciled.unmatched[0].reconciliationOutcome, "late");
});

test("a payment created before expiry settles after delayed observation", () => {
  const initial = awaitingStore({ expiresAt: NOW + 1_000 });
  initial.charges[0].status = "expired";
  const reconciled = reconcileIncomingPayments(initial, {
    network: "mainnet",
    payments: [payment({ createdAt: new Date(NOW + 500).toISOString() })],
    now: NOW + 5_000,
  });

  assert.equal(reconciled.orders[0].status, "paid");
  assert.equal(reconciled.charges[0].status, "paid");
  assert.equal(reconciled.paymentReconciliations[0].outcome, "settled");
});

test("a payment created at the expiry boundary is late", () => {
  const initial = awaitingStore({ expiresAt: NOW + 1_000 });
  const reconciled = reconcileIncomingPayments(initial, {
    network: "mainnet",
    payments: [payment({ createdAt: new Date(NOW + 1_000).toISOString() })],
    now: NOW + 5_000,
  });

  assert.equal(reconciled.orders[0].status, "awaiting");
  assert.equal(reconciled.paymentReconciliations[0].outcome, "late");
});

test("an invalid Horizon payment timestamp is retained for review", () => {
  const reconciled = reconcileIncomingPayments(awaitingStore(), {
    network: "mainnet",
    payments: [payment({ createdAt: "not-a-timestamp" })],
    now: NOW,
  });

  assert.equal(reconciled.orders[0].status, "awaiting");
  assert.equal(reconciled.charges[0].status, "awaiting");
  assert.equal(reconciled.paymentReconciliations[0].outcome, "invalid_time");
  assert.equal(reconciled.unmatched[0].reconciliationOutcome, "invalid_time");
});

test("a payment cannot settle a charge issued to another receiving account", () => {
  const reconciled = reconcileIncomingPayments(awaitingStore(), {
    network: "mainnet",
    payments: [payment({ destination: ISSUER })],
    now: NOW,
  });

  assert.equal(reconciled.orders[0].status, "awaiting");
  assert.equal(reconciled.charges[0].status, "awaiting");
  assert.equal(reconciled.paymentReconciliations[0].outcome, "routing_unknown");
});

test("an awaiting charge stops settling after the merchant receiving account changes", () => {
  const initial = awaitingStore();
  const changed = {
    ...initial,
    settings: { ...initial.settings, receivingPublicKey: ISSUER },
  };
  const reconciled = reconcileIncomingPayments(changed, {
    network: "mainnet",
    payments: [payment()],
    now: NOW,
  });

  assert.equal(reconciled.orders[0].status, "awaiting");
  assert.equal(reconciled.charges[0].status, "awaiting");
  assert.equal(reconciled.paymentReconciliations[0].outcome, "routing_unknown");
  assert.equal(reconciled.unmatched[0].destination, TILL);
});

test("watch targets and cursors retain immutable destinations after settings change", async () => {
  const watch = await import("../src/lib/merchant/watch.ts");
  assert.equal(typeof watch.merchantWatchDestinations, "function");
  assert.equal(typeof watch.merchantCursorKey, "function");

  const initial = awaitingStore();
  const store = {
    ...initial,
    settings: { ...initial.settings, receivingPublicKey: ISSUER },
    invoices: [
      {
        id: "invoice-old-destination",
        network: "mainnet",
        destination: PAYER,
        status: "partially_paid",
      },
    ],
    counterCodes: [
      {
        id: "counter-old-destination",
        network: "mainnet",
        destination: TILL,
        active: true,
      },
    ],
  };

  assert.deepEqual(
    watch.merchantWatchDestinations(
      {
        receivingPublicKey: store.settings.receivingPublicKey,
        charges: store.charges,
        invoices: store.invoices,
        counterCodes: store.counterCodes,
      },
      "mainnet",
    ),
    [ISSUER, TILL, PAYER],
  );
  assert.equal(watch.merchantCursorKey("mainnet", TILL), `mainnet:${TILL}`);
});

test("a second payment on a paid memo is a duplicate and cannot mutate the order", () => {
  const once = reconcileIncomingPayments(awaitingStore(), {
    network: "mainnet",
    payments: [payment()],
    now: NOW,
  });
  const duplicatePayment = payment({
    id: "payment-2",
    transactionHash: "b".repeat(64),
    createdAt: "2027-01-15T08:01:00Z",
  });
  const twice = reconcileIncomingPayments(once, {
    network: "mainnet",
    payments: [duplicatePayment],
    now: NOW + 60_000,
  });

  assert.equal(twice.orders[0].status, "paid");
  assert.equal(twice.orders[0].tender.length, 1);
  assert.equal(twice.catalogue[0].stockOnHand, 1);
  assert.equal(twice.paymentReconciliations[0].outcome, "duplicate");
  assert.equal(twice.unmatched[0].reconciliationOutcome, "duplicate");
  assert.equal(twice.unmatched[0].candidateChargeId, "charge-1");
});

test("a duplicate is resolved only by its persisted non-failed refund submission", () => {
  const settled = reconcileIncomingPayments(awaitingStore(), {
    network: "mainnet",
    payments: [payment()],
    now: NOW,
  });
  const duplicate = reconcileIncomingPayments(settled, {
    network: "mainnet",
    payments: [payment({ id: "payment-2", transactionHash: "b".repeat(64) })],
    now: NOW + 1,
  });
  const failedRefund = {
    id: "refund-failed",
    orderId: "order-1",
    kind: "payment_reversal",
    sourcePaymentId: "payment-2",
    network: "mainnet",
    amountMinor: 1_000,
    asset: USDC,
    amount: "10.0000000",
    destination: PAYER,
    reason: "duplicate",
    note: null,
    transactionHash: "c".repeat(64),
    submissionStatus: "failed",
    createdAt: NOW + 2,
  };
  const recorded = recordRefundSubmission(duplicate, failedRefund);

  assert.throws(
    () => markReconciledRefund(recorded, {
      paymentId: "payment-2",
      refundId: "refund-failed",
      actor: actor(),
      now: NOW + 3,
    }),
    /failed|did not move/i,
  );
  assert.equal(recorded.paymentReconciliations[0].resolution, null);
  const unknownRefund = { ...failedRefund, id: "refund-unknown", transactionHash: "d".repeat(64), submissionStatus: "status_unknown" };
  const unknownRecorded = recordRefundSubmission(duplicate, unknownRefund);
  assert.throws(
    () => markReconciledRefund(unknownRecorded, {
      paymentId: "payment-2",
      refundId: "refund-unknown",
      actor: actor(),
      now: NOW + 3,
    }),
    /confirmed/i,
  );
  assert.throws(
    () => markReconciledRefund(duplicate, {
      paymentId: "payment-2",
      refundId: "not-persisted",
      actor: actor(),
      now: NOW + 3,
    }),
    /persisted refund/i,
  );
});

test("dismiss and exact manual attach keep an immutable staff audit", () => {
  const candidate = reconcileIncomingPayments(awaitingStore(), {
    network: "mainnet",
    payments: [payment({ routingId: null })],
    now: NOW,
  });
  assert.equal(candidate.paymentReconciliations[0].outcome, "needs_confirmation");

  const attached = attachReconciledPayment(candidate, {
    paymentId: "payment-1",
    chargeId: "charge-1",
    actor: actor(),
    now: NOW + 1,
  });
  assert.equal(attached.orders[0].status, "paid");
  assert.equal(attached.paymentReconciliations[0].resolution.kind, "attached");
  assert.equal(attached.paymentReconciliations[0].resolution.staffId, actor().id);

  const stray = reconcileIncomingPayments(awaitingStore(), {
    network: "mainnet",
    payments: [payment({ id: "stray", routingId: "999999" })],
    now: NOW,
  });
  const dismissed = dismissReconciledPayment(stray, {
    paymentId: "stray",
    actor: actor(),
    now: NOW + 1,
  });
  assert.deepEqual(dismissed.unmatched, []);
  assert.equal(dismissed.paymentReconciliations[0].resolution.kind, "dismissed");
  assert.throws(
    () => dismissReconciledPayment(dismissed, {
      paymentId: "stray",
      actor: actor(),
      now: NOW + 2,
    }),
    /already been resolved/i,
  );
});

test("reconciliation rows remain actionable after a dust flood evicts their tray projection", () => {
  const owner = actor();
  const opened = openShift(awaitingStore(), {
    id: "shift-flood",
    actor: owner,
    terminalName: "Counter",
    network: "mainnet",
    floatMinor: 0,
    now: NOW - 2_000,
  });
  const genuine = payment({ id: "genuine", routingId: null });
  const dust = Array.from({ length: 250 }, (_, index) => payment({
    id: `dust-${String(index).padStart(3, "0")}`,
    transactionHash: index.toString(16).padStart(64, "0"),
    amount: "0.0000001",
    routingId: String(6_000 + index),
  }));
  const flooded = reconcileIncomingPayments(opened.store, {
    network: "mainnet",
    payments: [genuine, ...dust],
    now: NOW,
  });

  assert.equal(flooded.paymentReconciliations.length, 251);
  assert.equal(flooded.unmatched.length, 200);
  assert.equal(flooded.unmatched.some((entry) => entry.id === genuine.id), false);
  assert.equal(pendingReconciliationTray(flooded).length, 200);
  assert.deepEqual(pendingReconciliationTray(flooded, 0), []);

  const attached = attachReconciledPayment(flooded, {
    paymentId: genuine.id,
    chargeId: "charge-1",
    actor: owner,
    now: NOW + 1,
  });
  assert.equal(attached.orders[0].status, "paid");
  assert.equal(
    attached.paymentReconciliations.find((entry) => entry.id === genuine.id)?.resolution?.kind,
    "attached",
  );

  const cashier = { ...owner, id: "cashier", name: "Cashier", role: "server" };
  assert.throws(
    () => bulkDismissPendingReconciliations(attached, {
      actor: cashier,
      now: NOW + 2,
      limit: 100,
    }),
    /owner/i,
  );

  let cleared = attached;
  const resolvedIds = [];
  while (unresolvedShiftFlows(cleared, opened.shift.id, NOW + 10).length > 0) {
    const result = bulkDismissPendingReconciliations(cleared, {
      actor: owner,
      now: NOW + 2 + resolvedIds.length,
      limit: 100,
    });
    assert.ok(result.resolvedIds.length > 0 && result.resolvedIds.length <= 100);
    resolvedIds.push(...result.resolvedIds);
    cleared = result.store;
  }

  assert.equal(resolvedIds.length, 250);
  assert.equal(resolvedIds[0], "dust-000", "bulk cleanup starts with evicted oldest rows");
  assert.equal(pendingReconciliationTray(cleared).length, 0);
  assert.ok(
    cleared.paymentReconciliations
      .filter((entry) => entry.id.startsWith("dust-"))
      .every(
        (entry) =>
          entry.resolution?.kind === "dismissed" &&
          entry.resolution.staffId === owner.id &&
          entry.resolution.staffName === owner.name,
      ),
    "every bulk disposition keeps its own owner audit record",
  );

  const closed = closeShift(cleared, {
    shiftId: opened.shift.id,
    actor: owner,
    countedMinor: 0,
    now: NOW + 1_000,
  });
  assert.equal(closed.report.kind, "z");
});

test("the watcher resumes oldest-first and advances the cursor to the newest record", async (t) => {
  const olderToken = (BigInt(60_000_001) << 32n).toString();
  const newerToken = (BigInt(60_000_002) << 32n).toString();
  let requested;
  t.mock.method(globalThis, "fetch", async (url) => {
    requested = new URL(String(url));
    const record = (id, token, createdAt) => ({
      id,
      type: "payment",
      transaction_hash: (id === "newer" ? "a" : "b").repeat(64),
      transaction_successful: true,
      created_at: createdAt,
      paging_token: token,
      to: TILL,
      from: PAYER,
      asset_type: "credit_alphanum4",
      asset_code: "USDC",
      asset_issuer: ISSUER,
      amount: "10.0000000",
      transaction: { memo: "5001", memo_type: "id", successful: true },
    });
    return new Response(JSON.stringify({
      _embedded: {
        // Horizon returns newest-first when there is no cursor.
        records: [
          record("newer", newerToken, "2027-01-15T08:01:00Z"),
          record("older", olderToken, "2027-01-15T08:00:00Z"),
        ],
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  });

  const first = await fetchIncomingPayments({ publicKey: TILL, network: "mainnet" });
  assert.equal(requested.searchParams.get("order"), "desc");
  assert.deepEqual(first.payments.map((entry) => entry.id), ["older", "newer"]);
  assert.equal(first.cursor, newerToken);
  assert.ok(first.payments.every((entry) => entry.destination === TILL));

  await fetchIncomingPayments({ publicKey: TILL, network: "mainnet", cursor: first.cursor });
  assert.equal(requested.searchParams.get("order"), "asc");
  assert.equal(requested.searchParams.get("cursor"), newerToken);
});

test("merchant settlement reads ignore a configured Horizon endpoint", async (t) => {
  const previousWindow = globalThis.window;
  const values = new Map([
    ["wallet.endpoint.horizon.mainnet.v1", "https://malicious-horizon.example"],
  ]);
  globalThis.window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
  };
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  });
  let requested = "";
  t.mock.method(globalThis, "fetch", async (url) => {
    requested = String(url);
    return new Response(JSON.stringify({ _embedded: { records: [] } }), { status: 200 });
  });

  await fetchIncomingPayments({ publicKey: TILL, network: "mainnet", cursor: "1" });
  assert.match(requested, /^https:\/\/horizon\.stellar\.org\/accounts\//);
});

test("the watcher fails closed on a payment without explicit successful transaction evidence", async (t) => {
  const token = (BigInt(60_000_003) << 32n).toString();
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
    _embedded: {
      records: [{
        id: "missing-success",
        type: "payment",
        transaction_hash: "a".repeat(64),
        created_at: "2027-01-15T08:02:00Z",
        paging_token: token,
        to: TILL,
        from: PAYER,
        asset_type: "credit_alphanum4",
        asset_code: "USDC",
        asset_issuer: ISSUER,
        amount: "10.0000000",
        transaction: { memo: "5001", memo_type: "id" },
      }],
    },
  }), { status: 200, headers: { "content-type": "application/json" } }));

  await assert.rejects(
    fetchIncomingPayments({ publicKey: TILL, network: "mainnet", cursor: "1" }),
    /invalid.*horizon|successful.*required/i,
  );
});

test("duplicate and unmatched production surfaces expose real audited actions", () => {
  const hook = readFileSync(new URL("../src/hooks/useMerchant.tsx", import.meta.url), "utf8");
  const duplicate = readFileSync(
    new URL("../src/components/merchant/DuplicateChargeSheet.tsx", import.meta.url),
    "utf8",
  );
  const orders = readFileSync(
    new URL("../src/components/merchant/OrdersPage.tsx", import.meta.url),
    "utf8",
  );

  assert.match(hook, /reconcileIncomingPayments/);
  assert.match(hook, /submitPaymentRefund/);
  assert.doesNotMatch(duplicate, /merchant\/mock|MOCK_|DESIGN MOCK|Would send|Nothing was signed/);
  assert.match(duplicate, /await submitPaymentRefund\(/);
  assert.match(orders, /reconciliationOutcome/);
  assert.match(orders, /DuplicateChargeSheet/);
  assert.match(orders, /Owner cleanup/);
  assert.match(orders, /dismissPendingReconciliations/);
});

test("stale charges cannot render a new payment request", () => {
  const hook = readFileSync(new URL("../src/hooks/useMerchant.tsx", import.meta.url), "utf8");
  const sheet = readFileSync(
    new URL("../src/components/merchant/ChargeSheet.tsx", import.meta.url),
    "utf8",
  );
  const payUriFor = hook.split("const payUriFor = useCallback")[1]
    ?.split("const orderFor = useCallback")[0] ?? "";

  assert.match(payUriFor, /isCurrentReceivingDestination\(settings, charge\.destination\)/);
  assert.match(sheet, /receivingAccountChanged/);
  assert.match(sheet, /requestAvailable/);
  assert.match(sheet, /Receiving account changed/);
});
