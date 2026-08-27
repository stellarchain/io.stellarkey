import type {
  Charge,
  MerchantStore,
  Order,
  Refund,
  RefundSubmissionStatus,
} from "./types";
import { sameAsset } from "./charge";
import { toStroops } from "./money";

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

function paidOrder(order: Order): boolean {
  return (
    order.status === "paid" ||
    order.status === "partially_refunded" ||
    order.status === "refunded"
  );
}

/** The immutable on-chain receipt funding this order's Stellar refund lane. */
export function settledOrderPaymentSource(
  store: MerchantStore,
  orderId: string,
  sourcePaymentId?: string | null,
): Charge | null {
  const order = store.orders.find((entry) => entry.id === orderId);
  if (!order || !paidOrder(order)) return null;
  const cryptoChargeIds = new Set(
    (order.tender ?? [])
      .filter((part) => part.kind === "crypto" && typeof part.chargeId === "string")
      .map((part) => part.chargeId as string),
  );
  return (
    store.charges.find(
      (charge) =>
        charge.orderId === order.id &&
        charge.status === "paid" &&
        Number.isSafeInteger(charge.amountMinor) &&
        charge.amountMinor > 0 &&
        charge.payment !== null &&
        (!sourcePaymentId || charge.payment.id === sourcePaymentId) &&
        (cryptoChargeIds.size === 0 || cryptoChargeIds.has(charge.id)),
    ) ?? null
  );
}

function sourceRefunds(
  store: MerchantStore,
  orderId: string,
  sourcePaymentId: string,
): Refund[] {
  return store.refunds.filter(
    (refund) =>
      refund.kind === "order" &&
      refund.orderId === orderId &&
      (refund.sourcePaymentId === sourcePaymentId || refund.sourcePaymentId === null) &&
      refundReservesFunds(refund),
  );
}

export function refundableMinor(store: MerchantStore, orderId: string): number {
  const order = store.orders.find((entry) => entry.id === orderId);
  if (!order) throw new Error("The order no longer exists.");
  const source = settledOrderPaymentSource(store, orderId);
  if (!source?.payment) return 0;
  const reserved = sourceRefunds(store, orderId, source.payment.id).reduce(
    (sum, refund) => sum + refund.amountMinor,
    0,
  );
  return Math.max(0, Math.min(order.totals.totalMinor, source.amountMinor) - reserved);
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
  if (!Number.isSafeInteger(refund.amountMinor) || refund.amountMinor <= 0) {
    throw new Error("The refund amount must be a positive integer number of minor units.");
  }

  if (refund.kind === "order") {
    const source = settledOrderPaymentSource(store, order.id, refund.sourcePaymentId);
    if (!refund.sourcePaymentId || !source?.payment) {
      throw new Error("An ordinary refund requires its exact settled payment on a paid order.");
    }
    if (
      refund.network !== source.network ||
      refund.destination !== source.payment.from ||
      !sameAsset(refund.asset, source.payment.asset)
    ) {
      throw new Error("The refund does not match its settled source payment.");
    }
    const available = refundableMinor(store, order.id);
    if (refund.submissionStatus !== "failed" && refund.amountMinor > available) {
      throw new Error(`Only ${available} minor units remain refundable on this order.`);
    }
    if (refund.submissionStatus !== "failed") {
      const prior = sourceRefunds(store, order.id, source.payment.id);
      const priorMinor = prior.reduce((sum, entry) => sum + entry.amountMinor, 0);
      const priorStroops = prior.reduce(
        (sum, entry) => sum + toStroops(entry.amount),
        BigInt(0),
      );
      const cumulativeMinor = priorMinor + refund.amountMinor;
      const maximumStroops =
        (toStroops(source.payment.amount) * BigInt(cumulativeMinor)) /
        BigInt(source.amountMinor);
      if (priorStroops + toStroops(refund.amount) > maximumStroops) {
        throw new Error("The refund exceeds the value received from its source payment.");
      }
    }
  } else {
    const reconciliation = refund.sourcePaymentId
      ? store.paymentReconciliations.find((entry) => entry.id === refund.sourcePaymentId)
      : null;
    if (
      !reconciliation ||
      reconciliation.resolution ||
      reconciliation.outcome === "settled" ||
      reconciliation.orderId !== refund.orderId
    ) {
      throw new Error("That source payment is not an unresolved receipt available for reversal.");
    }
    const payment = reconciliation.payment;
    if (
      refund.network !== reconciliation.network ||
      refund.destination !== payment.from ||
      !sameAsset(refund.asset, payment.asset)
    ) {
      throw new Error("The reversal does not match its exact source payment.");
    }
    const prior = store.refunds.filter(
      (entry) =>
        entry.kind === "payment_reversal" &&
        entry.sourcePaymentId === reconciliation.id &&
        refundReservesFunds(entry),
    );
    const priorMinor = prior.reduce((sum, entry) => sum + entry.amountMinor, 0);
    const priorStroops = prior.reduce(
      (sum, entry) => sum + toStroops(entry.amount),
      BigInt(0),
    );
    if (
      reconciliation.amountMinor === null ||
      refund.submissionStatus !== "failed" &&
        (priorMinor + refund.amountMinor > reconciliation.amountMinor ||
          priorStroops + toStroops(refund.amount) > toStroops(payment.amount))
    ) {
      throw new Error("The reversal exceeds the amount received from its source payment.");
    }
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
