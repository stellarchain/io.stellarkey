import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { emptyStore } from "../src/lib/merchant/defaults.ts";
import {
  availableRefundMinor,
  recordRefundSubmission,
  reconcileRefundSubmission,
  refundableMinor,
} from "../src/lib/merchant/refunds.ts";

function order(totalMinor = 5_000) {
  return {
    id: "order-1",
    number: 1001,
    status: "paid",
    totals: { totalMinor },
  };
}

function refund(id, amountMinor, submissionStatus) {
  return {
    id,
    orderId: "order-1",
    kind: "order",
    sourcePaymentId: "payment-settled",
    network: "testnet",
    amountMinor,
    asset: { code: "XLM", issuer: null },
    amount: "1.0000000",
    destination: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBL",
    reason: "customer_request",
    note: null,
    transactionHash: createHash("sha256").update(id).digest("hex"),
    submissionStatus,
    createdAt: 10,
  };
}

function observedPayment(id = "payment-settled", amount = "10.0000000") {
  return {
    id,
    transactionHash: createHash("sha256").update(`payment:${id}`).digest("hex"),
    ledger: 123,
    from: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBL",
    destination: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    amount,
    asset: { code: "XLM", issuer: null },
    memo: "M1001",
    createdAt: new Date(1_000).toISOString(),
  };
}

function paymentStore({
  chargeStatus = "paid",
  orderStatus = "paid",
  payment = observedPayment(),
} = {}) {
  const sale = order();
  const charge = {
    id: "charge-1",
    orderId: sale.id,
    reference: "M1001",
    network: "testnet",
    destination: payment.destination,
    amountMinor: sale.totals.totalMinor,
    currency: "EUR",
    quotes: [
      {
        asset: payment.asset,
        amount: payment.amount,
        unitPriceMinorE6: 500_000_000,
        quotedAt: 1,
      },
    ],
    status: chargeStatus,
    createdAt: 1,
    expiresAt: 10_000,
    payment: { ...payment, lane: "memo" },
  };
  return {
    ...emptyStore(),
    orders: [{ ...sale, status: orderStatus }],
    charges: [charge],
  };
}

test("unconfirmed refund submissions reserve funds without claiming the order is refunded", () => {
  const base = paymentStore();
  const unknown = recordRefundSubmission(base, refund("unknown", 2_000, "status_unknown"));

  assert.equal(refundableMinor(unknown, "order-1"), 3_000);
  assert.equal(unknown.orders[0].status, "paid");
  assert.equal(unknown.refunds[0].submissionStatus, "status_unknown");
  assert.throws(
    () => recordRefundSubmission(unknown, refund("too-much", 3_001, "accepted")),
    /remain refundable/i,
  );
});

test("confirmation applies an order refund exactly once and terminal status cannot regress", () => {
  const base = paymentStore();
  const pending = recordRefundSubmission(base, refund("first", 2_000, "accepted"));
  const confirmed = reconcileRefundSubmission(pending, "first", "confirmed");

  assert.equal(confirmed.orders[0].status, "partially_refunded");
  assert.equal(confirmed.refunds[0].submissionStatus, "confirmed");
  assert.equal(reconcileRefundSubmission(confirmed, "first", "accepted"), confirmed);

  const fullyRefunded = recordRefundSubmission(
    confirmed,
    refund("second", 3_000, "confirmed"),
  );
  assert.equal(fullyRefunded.orders[0].status, "refunded");
  assert.equal(refundableMinor(fullyRefunded, "order-1"), 0);
});

test("canonically failed submissions release their reserved amount", () => {
  const base = paymentStore();
  const pending = recordRefundSubmission(base, refund("failed", 5_000, "status_unknown"));
  const failed = reconcileRefundSubmission(pending, "failed", "failed");

  assert.equal(failed.refunds[0].submissionStatus, "failed");
  assert.equal(failed.orders[0].status, "paid");
  assert.equal(refundableMinor(failed, "order-1"), 5_000);
});

test("refunding an unmatched payment never reduces the order's refundable sale value", () => {
  const duplicate = observedPayment("payment-duplicate", "60.0000000");
  const base = {
    ...paymentStore(),
    paymentReconciliations: [
      {
        id: duplicate.id,
        network: "testnet",
        payment: duplicate,
        outcome: "duplicate",
        chargeId: "charge-1",
        orderId: "order-1",
        amountMinor: 6_000,
        observedAt: 2,
        resolution: null,
      },
    ],
  };
  const reversal = {
    ...refund("duplicate-payment", 6_000, "confirmed"),
    kind: "payment_reversal",
    sourcePaymentId: "payment-duplicate",
    reason: "duplicate",
    amount: "60.0000000",
  };
  const recorded = recordRefundSubmission(base, reversal);

  assert.equal(recorded.orders[0].status, "paid");
  assert.equal(refundableMinor(recorded, "order-1"), 5_000);
  assert.equal(recorded.refunds[0].sourcePaymentId, "payment-duplicate");
  assert.throws(
    () => recordRefundSubmission(recorded, { ...reversal, id: "again", transactionHash: "f".repeat(64) }),
    /exceeds.*source payment/i,
  );
});

test("ordinary refunds require the exact payment on a settled charge", () => {
  for (const chargeStatus of ["underpaid", "overpaid", "expired"]) {
    const store = paymentStore({ chargeStatus, orderStatus: "awaiting" });
    assert.throws(
      () =>
        recordRefundSubmission(store, {
          ...refund(`ordinary-${chargeStatus}`, 1_000, "confirmed"),
          sourcePaymentId: "payment-settled",
          amount: "2.0000000",
        }),
      /settled payment|paid order/i,
    );
  }

  const duplicate = observedPayment("payment-duplicate");
  const settled = paymentStore();
  assert.throws(
    () =>
      recordRefundSubmission(settled, {
        ...refund("ordinary-duplicate", 1_000, "confirmed"),
        sourcePaymentId: duplicate.id,
        amount: "2.0000000",
      }),
    /settled payment|source payment/i,
  );
});

test("source-payment reversals cannot exceed the exact received asset amount", () => {
  const source = observedPayment("payment-overpaid", "10.0000000");
  const store = {
    ...paymentStore({ chargeStatus: "overpaid", orderStatus: "awaiting", payment: source }),
    paymentReconciliations: [
      {
        id: source.id,
        network: "testnet",
        payment: source,
        outcome: "overpaid",
        chargeId: "charge-1",
        orderId: "order-1",
        amountMinor: 5_000,
        observedAt: 2,
        resolution: null,
      },
    ],
    unmatched: [
      {
        ...source,
        seenAt: 2,
        reconciliationOutcome: "overpaid",
        candidateChargeId: "charge-1",
      },
    ],
  };

  assert.throws(
    () =>
      recordRefundSubmission(store, {
        ...refund("too-large-source", 5_001, "accepted"),
        kind: "payment_reversal",
        sourcePaymentId: source.id,
        amount: "10.0000001",
        reason: "overpayment",
      }),
    /received|source payment/i,
  );
});

test("pending approval requests reserve value except for their own signed release", () => {
  const base = {
    ...paymentStore(),
    refundRequests: [
      {
        id: "request-1",
        orderId: "order-1",
        amountMinor: 2_000,
        sourcePaymentId: null,
        status: "pending",
      },
    ],
  };

  assert.equal(availableRefundMinor(base, "order-1"), 3_000);
  assert.equal(availableRefundMinor(base, "order-1", "request-1"), 5_000);
});

test("merchant refund surfaces preserve and explain the tracked submission state", () => {
  const hook = readFileSync(
    new URL("../src/hooks/useMerchant.tsx", import.meta.url),
    "utf8",
  );
  const detail = readFileSync(
    new URL("../src/components/merchant/OrderDetailModal.tsx", import.meta.url),
    "utf8",
  );

  assert.match(hook, /submissionStatus:\s*result\.status/);
  assert.match(hook, /reconcileRefundSubmission/);
  assert.match(hook, /settledOrderPaymentSource\(current, orderId\)/);
  assert.match(hook, /sourcePaymentId:\s*sourcePayment\.id/);
  assert.match(detail, /settled\?\.status === "paid"/);
  assert.match(detail, /Status unknown[^\n]*do not retry/i);
  assert.match(detail, /Confirming/);
});
