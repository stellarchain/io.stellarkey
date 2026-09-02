import { quoteFor } from "./charge";
import { matchPayment, type ObservedPayment, type UnmatchedReason } from "./match";
import { minorForAssetAmount, toStroops } from "./money";
import { completeCryptoTender } from "./orders";
import type {
  Charge,
  MerchantStore,
  Minor,
  PaymentReconciliation,
  PaymentReconciliationOutcome,
  PaymentResolution,
  StaffMember,
  UnmatchedPayment,
} from "./types";
import type { NetworkKey } from "../stellar";
import { canonicalPayerAddress } from "./payer";
import { merchantPaymentIdentitySet, paymentTransactionIdentity } from "./payment-identity";
import { isCurrentReceivingDestination } from "./destination";

export interface ReconcileIncomingInput {
  network: NetworkKey;
  payments: ObservedPayment[];
  now?: number;
}

export interface ResolveReconciliationInput {
  paymentId: string;
  actor: StaffMember;
  now: number;
}

export interface AttachReconciliationInput extends ResolveReconciliationInput {
  chargeId: string;
}

export interface BulkResolveReconciliationsInput {
  actor: StaffMember;
  now: number;
  limit?: number;
}

export const MAX_RECONCILIATION_TRAY_ROWS = 200;
export const MAX_BULK_RECONCILIATION_RESOLUTIONS = 100;

function outcomeForUnmatched(reason: UnmatchedReason): PaymentReconciliationOutcome {
  if (reason === "ambiguous") return "ambiguous";
  if (reason === "wrong_asset") return "wrong_asset";
  if (reason === "outside_band") return "outside_band";
  if (reason === "expired") return "late";
  if (reason === "invalid_time") return "invalid_time";
  if (reason === "routing_conflict") return "routing_conflict";
  if (reason === "routing_unknown") return "routing_unknown";
  return "unmatched";
}

function valueFor(payment: ObservedPayment, charge: Charge | null): Minor | null {
  if (!charge) return null;
  const quote = quoteFor(charge, payment.asset);
  if (!quote) return null;
  const minor = minorForAssetAmount(payment.amount, quote.unitPriceMinorE6);
  return Number.isSafeInteger(minor) && minor >= 0 ? minor : null;
}

function reconciliationNeedsAction(record: PaymentReconciliation): boolean {
  return record.outcome !== "settled" && record.resolution === null;
}

function unmatchedForReconciliation(record: PaymentReconciliation): UnmatchedPayment {
  return {
    ...record.payment,
    seenAt: record.observedAt,
    reconciliationOutcome: record.outcome,
    candidateChargeId: record.chargeId,
    candidateInvoiceId: record.invoiceId,
    candidateCounterCodeId: record.counterCodeId ?? null,
  };
}

/**
 * The tray is only a bounded presentation of the durable reconciliation log.
 * Action handlers always resolve against the log itself, never this projection.
 */
export function pendingReconciliationTray(
  store: MerchantStore,
  limit = MAX_RECONCILIATION_TRAY_ROWS,
): UnmatchedPayment[] {
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > MAX_RECONCILIATION_TRAY_ROWS) {
    throw new Error(`The reconciliation tray limit must be between 0 and ${MAX_RECONCILIATION_TRAY_ROWS}.`);
  }
  if (limit === 0) return [];
  const tray: UnmatchedPayment[] = [];
  for (const record of store.paymentReconciliations) {
    if (reconciliationNeedsAction(record)) tray.push(unmatchedForReconciliation(record));
    if (tray.length === limit) break;
  }
  return tray;
}

function withReconciliationTray(store: MerchantStore): MerchantStore {
  return { ...store, unmatched: pendingReconciliationTray(store) };
}

function recordFor(
  payment: ObservedPayment,
  network: NetworkKey,
  outcome: PaymentReconciliationOutcome,
  charge: Charge | null,
  now: number,
): PaymentReconciliation {
  return {
    id: payment.id,
    network,
    payment: { ...payment },
    outcome,
    chargeId: charge?.id ?? null,
    orderId: charge?.orderId ?? null,
    invoiceId: null,
    counterCodeId: null,
    amountMinor: valueFor(payment, charge),
    reversalAmount: null,
    observedAt: now,
    resolution: null,
  };
}

function updateChargeWithPayment(
  store: MerchantStore,
  charge: Charge,
  payment: ObservedPayment,
  status: Charge["status"],
): MerchantStore {
  return {
    ...store,
    charges: store.charges.map((entry) =>
      entry.id === charge.id
        ? { ...entry, status, payment: { ...payment, lane: "routing" as const } }
        : entry,
    ),
  };
}

function reconcileOne(
  store: MerchantStore,
  network: NetworkKey,
  payment: ObservedPayment,
  now: number,
): MerchantStore {
  if (store.paymentReconciliations.some((entry) => entry.id === payment.id)) return store;

  const scoped = store.charges.filter(
    (charge) =>
      charge.network === network &&
      isCurrentReceivingDestination(store.settings, charge.destination) &&
      charge.destination === payment.destination,
  );
  if (merchantPaymentIdentitySet(store).has(paymentTransactionIdentity(network, payment))) {
    const named = payment.routingId
      ? scoped.find((entry) => entry.routingId === payment.routingId) ?? null
      : null;
    return {
      ...store,
      paymentReconciliations: [
        recordFor(payment, network, "duplicate", named, now),
        ...store.paymentReconciliations,
      ],
    };
  }
  const outcome = matchPayment(payment, scoped, store.settings);
  let next = store;
  let charge: Charge | null = "charge" in outcome ? outcome.charge : null;
  if (!charge && payment.routingId) {
    charge = scoped.find((entry) => entry.routingId === payment.routingId) ?? null;
  }
  let recordedOutcome: PaymentReconciliationOutcome;

  if (outcome.lane === "routing") {
    if (outcome.late) {
      recordedOutcome = "late";
      next = updateChargeWithPayment(next, outcome.charge, payment, "expired");
    } else if (outcome.verdict === "exact") {
      recordedOutcome = "settled";
      next = updateChargeWithPayment(next, outcome.charge, payment, "paid");
      next = completeCryptoTender(next, {
        orderId: outcome.charge.orderId,
        chargeId: outcome.charge.id,
        amountMinor: outcome.charge.amountMinor,
        payerAddress: canonicalPayerAddress(payment.from),
        now,
      }).store;
    } else {
      recordedOutcome = outcome.direction === "short" ? "underpaid" : "overpaid";
      next = updateChargeWithPayment(
        next,
        outcome.charge,
        payment,
        outcome.direction === "short" ? "underpaid" : "overpaid",
      );
    }
  } else if (outcome.lane === "amount") {
    recordedOutcome = "needs_confirmation";
  } else if (outcome.lane === "duplicate") {
    recordedOutcome = "duplicate";
  } else {
    recordedOutcome = outcomeForUnmatched(outcome.reason);
  }

  const reconciliation = recordFor(payment, network, recordedOutcome, charge, now);
  return {
    ...next,
    paymentReconciliations: [reconciliation, ...next.paymentReconciliations],
  };
}

/** Apply Horizon observations oldest-first, exactly once per operation ID. */
export function reconcileIncomingPayments(
  store: MerchantStore,
  { network, payments, now = Date.now() }: ReconcileIncomingInput,
): MerchantStore {
  let next = store;
  for (const payment of payments) next = reconcileOne(next, network, payment, now);
  return next === store ? store : withReconciliationTray(next);
}

function activePaymentActor(actor: StaffMember): void {
  if (!actor.active || !actor.permissions.takePayment) {
    throw new Error(`${actor.name} is not allowed to resolve incoming payments.`);
  }
}

function validResolutionTime(now: number): void {
  if (!Number.isSafeInteger(now) || now <= 0) {
    throw new Error("Payment resolution time is invalid.");
  }
}

function unresolved(
  store: MerchantStore,
  input: ResolveReconciliationInput,
): PaymentReconciliation {
  activePaymentActor(input.actor);
  validResolutionTime(input.now);
  const reconciliation = store.paymentReconciliations.find(
    (entry) => entry.id === input.paymentId,
  );
  if (!reconciliation) throw new Error("That incoming payment is no longer in the review log.");
  if (reconciliation.resolution) throw new Error("That incoming payment has already been resolved.");
  if (reconciliation.outcome === "settled") {
    throw new Error("That incoming payment already settled automatically.");
  }
  return reconciliation;
}

function resolution(
  kind: PaymentResolution["kind"],
  actor: StaffMember,
  at: number,
  targetChargeId: string | null = null,
  refundId: string | null = null,
): PaymentResolution {
  return {
    kind,
    staffId: actor.id,
    staffName: actor.name,
    at,
    targetChargeId,
    refundId,
  };
}

export function dismissReconciledPayment(
  store: MerchantStore,
  input: ResolveReconciliationInput,
): MerchantStore {
  const reconciliation = unresolved(store, input);
  return withReconciliationTray({
    ...store,
    paymentReconciliations: store.paymentReconciliations.map((entry) =>
      entry.id === reconciliation.id
        ? { ...entry, resolution: resolution("dismissed", input.actor, input.now) }
        : entry,
    ),
  });
}

/** Owner-only bounded cleanup, oldest first, with one immutable disposition per row. */
export function bulkDismissPendingReconciliations(
  store: MerchantStore,
  input: BulkResolveReconciliationsInput,
): { store: MerchantStore; resolvedIds: string[] } {
  const owner = store.staff.find((member) => member.id === input.actor.id);
  if (
    !owner?.active ||
    owner.role !== "owner" ||
    store.activeStaffId !== owner.id ||
    !owner.permissions.takePayment
  ) {
    throw new Error("Only an active owner can dismiss pending payments in bulk.");
  }
  validResolutionTime(input.now);
  const limit = input.limit ?? MAX_BULK_RECONCILIATION_RESOLUTIONS;
  if (
    !Number.isSafeInteger(limit) ||
    limit <= 0 ||
    limit > MAX_BULK_RECONCILIATION_RESOLUTIONS
  ) {
    throw new Error(
      `Bulk payment cleanup must resolve between 1 and ${MAX_BULK_RECONCILIATION_RESOLUTIONS} rows.`,
    );
  }
  const resolvedIds: string[] = [];
  for (
    let index = store.paymentReconciliations.length - 1;
    index >= 0 && resolvedIds.length < limit;
    index -= 1
  ) {
    const record = store.paymentReconciliations[index];
    if (reconciliationNeedsAction(record)) resolvedIds.push(record.id);
  }
  if (resolvedIds.length === 0) return { store, resolvedIds };
  const resolved = new Set(resolvedIds);
  const next = withReconciliationTray({
    ...store,
    paymentReconciliations: store.paymentReconciliations.map((entry) =>
      resolved.has(entry.id)
        ? { ...entry, resolution: resolution("dismissed", owner, input.now) }
        : entry,
    ),
  });
  return { store: next, resolvedIds };
}

export function attachReconciledPayment(
  store: MerchantStore,
  input: AttachReconciliationInput,
): MerchantStore {
  const reconciliation = unresolved(store, input);
  const payment = reconciliation.payment;
  const charge = store.charges.find((entry) => entry.id === input.chargeId);
  if (!charge) throw new Error("The target charge no longer exists.");
  if (charge.network !== reconciliation.network) {
    throw new Error("A payment cannot be attached across Stellar networks.");
  }
  if (charge.destination !== payment.destination) {
    throw new Error("A payment cannot be attached to another receiving account.");
  }
  if (charge.payment && charge.payment.id !== payment.id) {
    throw new Error("That charge already carries another payment.");
  }
  const quote = quoteFor(charge, payment.asset);
  if (!quote || toStroops(payment.amount) !== toStroops(quote.amount)) {
    throw new Error("Only an exact payment in the quoted asset can settle this charge.");
  }
  const order = store.orders.find((entry) => entry.id === charge.orderId);
  if (!order || order.status !== "awaiting") {
    throw new Error("Only an awaiting order can accept this payment.");
  }

  const withPayment = withReconciliationTray({
    ...store,
    charges: store.charges.map((entry) =>
      entry.id === charge.id
        ? { ...entry, status: "paid", payment: { ...payment, lane: "manual" } }
        : entry,
    ),
    paymentReconciliations: store.paymentReconciliations.map((entry) =>
      entry.id === reconciliation.id
        ? {
            ...entry,
            resolution: resolution("attached", input.actor, input.now, charge.id),
          }
        : entry,
    ),
  });
  return completeCryptoTender(withPayment, {
    orderId: charge.orderId,
    chargeId: charge.id,
    amountMinor: charge.amountMinor,
    payerAddress: canonicalPayerAddress(payment.from),
    now: input.now,
  }).store;
}

export function markReconciledRefund(
  store: MerchantStore,
  input: ResolveReconciliationInput & { refundId: string },
): MerchantStore {
  const reconciliation = unresolved(store, input);
  if (!input.refundId) throw new Error("A persisted refund ID is required.");
  const refund = store.refunds.find((entry) => entry.id === input.refundId);
  if (
    !refund ||
    refund.kind !== "payment_reversal" ||
    refund.sourcePaymentId !== reconciliation.id
  ) {
    throw new Error("A matching persisted refund is required before resolving this payment.");
  }
  if (refund.submissionStatus === "failed") {
    throw new Error("The refund submission failed and did not move funds, so this payment remains open.");
  }
  if (refund.submissionStatus !== "confirmed") {
    throw new Error("The refund must be canonically confirmed before this payment can be resolved.");
  }
  return withReconciliationTray({
    ...store,
    paymentReconciliations: store.paymentReconciliations.map((entry) =>
      entry.id === reconciliation.id
        ? {
            ...entry,
            resolution: resolution(
              "refund_submitted",
              input.actor,
              input.now,
              null,
              input.refundId,
            ),
          }
        : entry,
    ),
  });
}
