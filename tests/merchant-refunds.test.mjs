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
    network: "testnet",
    amountMinor,
    asset: { code: "XLM", issuer: null },
    amount: "1.0000000",
    destination: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    reason: "customer_request",
    note: null,
    transactionHash: createHash("sha256").update(id).digest("hex"),
    submissionStatus,
    createdAt: 10,
  };
}

test("unconfirmed refund submissions reserve funds without claiming the order is refunded", () => {
  const base = { ...emptyStore(), orders: [order()] };
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
  const base = { ...emptyStore(), orders: [order()] };
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
  const base = { ...emptyStore(), orders: [order()] };
  const pending = recordRefundSubmission(base, refund("failed", 5_000, "status_unknown"));
  const failed = reconcileRefundSubmission(pending, "failed", "failed");

  assert.equal(failed.refunds[0].submissionStatus, "failed");
  assert.equal(failed.orders[0].status, "paid");
  assert.equal(refundableMinor(failed, "order-1"), 5_000);
});

test("pending approval requests reserve value except for their own signed release", () => {
  const base = {
    ...emptyStore(),
    orders: [order()],
    refundRequests: [
      {
        id: "request-1",
        orderId: "order-1",
        amountMinor: 2_000,
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
  assert.match(detail, /Status unknown[^\n]*do not retry/i);
  assert.match(detail, /Confirming/);
});
