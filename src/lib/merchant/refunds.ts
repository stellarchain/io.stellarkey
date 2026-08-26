import type {
  MerchantStore,
  Order,
  Refund,
  RefundSubmissionStatus,
} from "./types";

const FINAL_SUBMISSION_STATUSES = new Set<RefundSubmissionStatus>(["confirmed", "failed"]);

function isSubmissionStatus(value: unknown): value is RefundSubmissionStatus {
  return (
    value === "accepted" ||
    value === "confirmed" ||
    value === "status_unknown" ||
    value === "failed"
  );
}

/** Failed is the only state proven not to have moved funds. Every other state reserves value. */
export function refundReservesFunds(refund: Refund): boolean {
  return refund.submissionStatus !== "failed";
}

export function confirmedRefundMinor(store: MerchantStore, orderId: string): number {
  return store.refunds
    .filter(
      (refund) =>
        refund.kind === "order" &&
        refund.orderId === orderId &&
        refund.submissionStatus === "confirmed",
    )
    .reduce((sum, refund) => sum + refund.amountMinor, 0);
}

export function refundableMinor(store: MerchantStore, orderId: string): number {
  const order = store.orders.find((entry) => entry.id === orderId);
  if (!order) throw new Error("The order no longer exists.");
  const reserved = store.refunds
    .filter(
      (refund) =>
        refund.kind === "order" &&
        refund.orderId === orderId &&
        refundReservesFunds(refund),
    )
    .reduce((sum, refund) => sum + refund.amountMinor, 0);
  return Math.max(0, order.totals.totalMinor - reserved);
}

/** Spendable refund headroom after other staff's pending approvals are reserved. */
export function availableRefundMinor(
  store: MerchantStore,
  orderId: string,
  excludeRequestId?: string,
): number {
  const pending = store.refundRequests
    .filter(
      (request) =>
        request.orderId === orderId &&
        request.sourcePaymentId === null &&
        request.status === "pending" &&
        request.id !== excludeRequestId,
    )
    .reduce((sum, request) => sum + request.amountMinor, 0);
  return Math.max(0, refundableMinor(store, orderId) - pending);
}

function deriveOrderRefundStatus(store: MerchantStore, order: Order): Order {
  if (order.status === "open" || order.status === "awaiting" || order.status === "voided") {
    return order;
  }
  const confirmed = confirmedRefundMinor(store, order.id);
  const status = confirmed <= 0
    ? "paid"
    : confirmed >= order.totals.totalMinor
      ? "refunded"
      : "partially_refunded";
  return status === order.status ? order : { ...order, status };
}

function deriveOrder(store: MerchantStore, orderId: string): MerchantStore {
  return {
    ...store,
    orders: store.orders.map((order) =>
      order.id === orderId ? deriveOrderRefundStatus(store, order) : order),
  };
}

/** Persist the signed submission before presenting any refund as complete. */
export function recordRefundSubmission(store: MerchantStore, refund: Refund): MerchantStore {
  const order = store.orders.find((entry) => entry.id === refund.orderId);
  if (!order) throw new Error("The order no longer exists.");
  if (!refund.id || store.refunds.some((entry) => entry.id === refund.id)) {
    throw new Error("That refund submission is already recorded.");
  }
  if (
    refund.transactionHash === null ||
    !/^[0-9a-f]{64}$/i.test(refund.transactionHash) ||
    store.refunds.some(
      (entry) =>
        entry.network === refund.network && entry.transactionHash === refund.transactionHash,
    )
  ) {
    throw new Error("The refund transaction identity is invalid or already recorded.");
  }
  if (!isSubmissionStatus(refund.submissionStatus)) {
    throw new Error("The refund submission status is invalid.");
  }
  if (
    !Number.isSafeInteger(refund.amountMinor) ||
    refund.amountMinor <= 0 ||
    (
      refund.kind === "order" &&
      refund.submissionStatus !== "failed" &&
      refund.amountMinor > refundableMinor(store, order.id)
    )
  ) {
    throw new Error(
      `Only ${refundableMinor(store, order.id)} minor units remain refundable on this order.`,
    );
  }

  if (
    refund.kind === "payment_reversal" &&
    (
      !refund.sourcePaymentId ||
      store.refunds.some(
        (entry) =>
          entry.kind === "payment_reversal" &&
          entry.sourcePaymentId === refund.sourcePaymentId &&
          entry.submissionStatus !== "failed",
      )
    )
  ) {
    throw new Error("That incoming payment already has a refund submission recorded.");
  }

  const recorded = { ...store, refunds: [refund, ...store.refunds] };
  return refund.kind === "order" ? deriveOrder(recorded, order.id) : recorded;
}

/** Apply the wallet's canonical-hash resolution without allowing a final state to regress. */
export function reconcileRefundSubmission(
  store: MerchantStore,
  refundId: string,
  status: RefundSubmissionStatus,
): MerchantStore {
  if (!isSubmissionStatus(status)) throw new Error("The refund submission status is invalid.");
  const refund = store.refunds.find((entry) => entry.id === refundId);
  if (!refund) throw new Error("That refund record no longer exists.");
  if (refund.submissionStatus === status) return store;
  if (FINAL_SUBMISSION_STATUSES.has(refund.submissionStatus)) return store;

  const next = {
    ...store,
    refunds: store.refunds.map((entry) =>
      entry.id === refund.id ? { ...entry, submissionStatus: status } : entry),
  };
  return refund.kind === "order" ? deriveOrder(next, refund.orderId) : next;
}
