import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { emptyStore } from "../src/lib/merchant/defaults.ts";
import {
  addStaffMember,
  canReleaseRefund,
  createRefundRequest,
  decideRefundRequest,
  defaultPermissionsFor,
  nextPinAttempt,
  updateStaffMember,
} from "../src/lib/merchant/permissions.ts";

const PIN_DIGEST =
  "pbkdf2-sha256$v1$600000$AAECAwQFBgcICQoLDA0ODw==$AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";

function member(id, role, overrides = {}) {
  return {
    id,
    name: id,
    role,
    permissions: defaultPermissionsFor(role),
    pinDigest: PIN_DIGEST,
    pinSetAt: 1,
    active: true,
    ...overrides,
  };
}

function staffedStore() {
  const owner = member("owner", "owner");
  const server = member("server", "server");
  return {
    ...emptyStore(),
    settings: { ...emptyStore().settings, enabled: true },
    staff: [owner, server],
    activeStaffId: owner.id,
  };
}

test("role defaults expose deliberate least-privilege ceilings", () => {
  assert.equal(defaultPermissionsFor("owner").refundCeilingMinor, null);
  assert.equal(defaultPermissionsFor("owner").exportRecords, true);
  assert.equal(defaultPermissionsFor("manager").refundCeilingMinor, 10_000);
  assert.equal(defaultPermissionsFor("server").refundCeilingMinor, 2_000);
  assert.equal(defaultPermissionsFor("server").seeReports, false);
  assert.equal(defaultPermissionsFor("accountant").takePayment, false);
  assert.equal(defaultPermissionsFor("accountant").exportRecords, true);
});

test("refund ceilings distinguish direct release from approval", () => {
  const server = member("server", "server");
  assert.equal(canReleaseRefund(server, 2_000), true);
  assert.equal(canReleaseRefund(server, 2_001), false);
  assert.equal(canReleaseRefund(member("disabled", "server", { active: false }), 100), false);
  assert.equal(canReleaseRefund(member("owner", "owner"), 1_000_000), true);
  assert.equal(
    canReleaseRefund(
      member("none", "server", {
        permissions: { ...defaultPermissionsFor("server"), refundCeilingMinor: 0 },
      }),
      1,
    ),
    false,
  );
});

test("only an active owner can manage staff and the last owner is protected", () => {
  const store = staffedStore();
  assert.throws(
    () => updateStaffMember(store, "server", "owner", { name: "Changed" }),
    /owner/i,
  );
  assert.throws(
    () => updateStaffMember(store, "owner", "owner", { active: false }),
    /last active owner/i,
  );
  assert.throws(
    () => updateStaffMember(store, "owner", "owner", { role: "manager" }),
    /last active owner/i,
  );

  const updated = updateStaffMember(store, "owner", "server", {
    name: "Front counter",
    permissions: { ...defaultPermissionsFor("server"), refundCeilingMinor: 500 },
  });
  assert.equal(updated.staff.find((entry) => entry.id === "server").name, "Front counter");
  assert.equal(updated.staff.find((entry) => entry.id === "server").permissions.refundCeilingMinor, 500);
  assert.equal(store.staff.find((entry) => entry.id === "server").name, "server");
});

test("staff creation validates identity, credential, and uniqueness", () => {
  const store = staffedStore();
  const added = addStaffMember(store, "owner", {
    id: "books",
    name: "  Bea  ",
    role: "accountant",
    pinDigest: PIN_DIGEST,
    now: 20,
  });
  assert.equal(added.staff[0].id, "books");
  assert.equal(added.staff[0].name, "Bea");
  assert.equal(added.staff[0].permissions.exportRecords, true);
  assert.throws(
    () => addStaffMember(added, "owner", { id: "books", name: "Duplicate", role: "server", pinDigest: PIN_DIGEST, now: 21 }),
    /already exists/i,
  );
  assert.throws(
    () => addStaffMember(store, "owner", { id: "bad", name: "Bad", role: "server", pinDigest: "1234", now: 21 }),
    /credential/i,
  );
});

test("five wrong PINs impose a timed lockout and success clears failures", () => {
  let state = { failures: 0, blockedUntil: 0 };
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const result = nextPinAttempt(state, false, 1_000 + attempt);
    state = result.state;
    assert.equal(result.blocked, false);
  }
  const fifth = nextPinAttempt(state, false, 2_000);
  assert.equal(fifth.blocked, true);
  assert.equal(fifth.state.blockedUntil, 32_000);

  const stillBlocked = nextPinAttempt(fifth.state, true, 31_999);
  assert.equal(stillBlocked.blocked, true);
  assert.deepEqual(stillBlocked.state, fifth.state);

  const success = nextPinAttempt(fifth.state, true, 32_000);
  assert.equal(success.blocked, false);
  assert.deepEqual(success.state, { failures: 0, blockedUntil: 0 });
});

test("over-ceiling refunds become immutable pending requests", () => {
  const store = staffedStore();
  const order = {
    id: "order-1",
    number: 1204,
    status: "paid",
    totals: { totalMinor: 5_000 },
  };
  const withOrder = { ...store, orders: [order] };
  const { store: requested, request } = createRefundRequest(withOrder, {
    id: "request-1",
    orderId: order.id,
    amountMinor: 2_001,
    reason: "customer_request",
    note: "Customer changed their mind",
    requestedById: "server",
    now: 10_000,
  });

  assert.equal(request.status, "pending");
  assert.equal(request.orderNumber, 1204);
  assert.equal(request.requestedBy, "server");
  assert.equal(request.reviewedById, null);
  assert.equal(request.refundId, null);
  assert.equal(requested.refundRequests[0], request);
  assert.throws(
    () => createRefundRequest(requested, { id: "request-2", orderId: order.id, amountMinor: 2_001, reason: "customer_request", requestedById: "server", now: 10_001 }),
    /already pending/i,
  );

  const secondAmount = createRefundRequest(requested, {
    id: "request-3",
    orderId: order.id,
    amountMinor: 2_999,
    reason: "other",
    requestedById: "server",
    now: 10_002,
  });
  assert.equal(secondAmount.store.refundRequests.length, 2);
  assert.throws(
    () => createRefundRequest(secondAmount.store, {
      id: "request-4",
      orderId: order.id,
      amountMinor: 2_001,
      reason: "other",
      requestedById: "server",
      now: 10_003,
    }),
    /remain refundable/i,
  );
});

test("a qualified reviewer can decline or record a signed refund result", () => {
  const store = staffedStore();
  const order = { id: "order-1", number: 1204, status: "paid", totals: { totalMinor: 5_000 } };
  const { store: pending } = createRefundRequest(
    { ...store, orders: [order] },
    {
      id: "request-1",
      orderId: order.id,
      amountMinor: 2_500,
      reason: "other",
      requestedById: "server",
      now: 10,
    },
  );

  assert.throws(
    () => decideRefundRequest(pending, { requestId: "request-1", reviewerId: "server", decision: "approved", now: 20, refundId: "refund-1" }),
    /ceiling/i,
  );
  assert.throws(
    () => decideRefundRequest(pending, { requestId: "request-1", reviewerId: "owner", decision: "approved", now: 20 }),
    /signed refund/i,
  );

  const approved = decideRefundRequest(pending, {
    requestId: "request-1",
    reviewerId: "owner",
    decision: "approved",
    now: 20,
    refundId: "refund-1",
  });
  assert.deepEqual(approved.refundRequests[0], {
    ...pending.refundRequests[0],
    status: "approved",
    reviewedById: "owner",
    reviewedAt: 20,
    refundId: "refund-1",
  });

  const declined = decideRefundRequest(pending, {
    requestId: "request-1",
    reviewerId: "owner",
    decision: "declined",
    now: 21,
  });
  assert.equal(declined.refundRequests[0].status, "declined");
  assert.equal(declined.refundRequests[0].refundId, null);
});

test("staff and refund production surfaces use persisted merchant actions", () => {
  const staffPage = readFileSync(
    new URL("../src/components/merchant/StaffTerminalsPage.tsx", import.meta.url),
    "utf8",
  );
  const requests = readFileSync(
    new URL("../src/components/merchant/RefundRequestsPanel.tsx", import.meta.url),
    "utf8",
  );
  const orderDetail = readFileSync(
    new URL("../src/components/merchant/OrderDetailModal.tsx", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(staffPage, /merchant\/mock|MOCK_STAFF|would be saved/);
  assert.doesNotMatch(requests, /merchant\/mock|MOCK_REFUND|Queued as an outbound/);
  assert.match(staffPage, /await switchStaff\(/);
  assert.match(staffPage, /await resetStaffPin\(/);
  assert.match(staffPage, /aria-label="Staff name"/);
  assert.match(staffPage, /label="Active on this till"/);
  assert.match(requests, /await approveRefundRequest\(/);
  assert.match(orderDetail, /submitRefund: submitMerchantRefund/);
});
