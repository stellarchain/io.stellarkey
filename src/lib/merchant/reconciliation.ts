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

function outcomeForUnmatched(reason: UnmatchedReason): PaymentReconciliationOutcome {
  if (reason === "ambiguous") return "ambiguous";
  if (reason === "wrong_asset") return "wrong_asset";
  if (reason === "outside_band") return "outside_band";
  if (reason === "expired") return "late";
  if (reason === "invalid_time") return "invalid_time";
  return "unmatched";
}

function valueFor(payment: ObservedPayment, charge: Charge | null): Minor | null {
  if (!charge) return null;
  const quote = quoteFor(charge, payment.asset);
  if (!quote) return null;
  const minor = minorForAssetAmount(payment.amount, quote.unitPriceMinorE6);
  return Number.isSafeInteger(minor) && minor >= 0 ? minor : null;
}

function asUnmatched(
  payment: ObservedPayment,
  outcome: PaymentReconciliationOutcome,
  candidateChargeId: string | null,
  now: number,
): UnmatchedPayment {
  return {
    ...payment,
    seenAt: now,
    reconciliationOutcome: outcome,
    candidateChargeId,
  };
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
    amountMinor: valueFor(payment, charge),
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
        ? { ...entry, status, payment: { ...payment, lane: "memo" as const } }
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
    (charge) => charge.network === network && charge.destination === payment.destination,
  );
  const outcome = matchPayment(payment, scoped, store.settings);
  let next = store;
  let charge: Charge | null = "charge" in outcome ? outcome.charge : null;
  if (!charge && payment.memo) {
    charge = scoped.find((entry) => entry.reference === payment.memo) ?? null;
  }
  let recordedOutcome: PaymentReconciliationOutcome;
  let needsTray = true;

  if (outcome.lane === "memo") {
    if (outcome.late) {
      recordedOutcome = "late";
      next = updateChargeWithPayment(next, outcome.charge, payment, "expired");
    } else if (outcome.verdict === "exact") {
      recordedOutcome = "settled";
      needsTray = false;
      next = updateChargeWithPayment(next, outcome.charge, payment, "paid");
      next = completeCryptoTender(next, {
        orderId: outcome.charge.orderId,
        chargeId: outcome.charge.id,
        amountMinor: outcome.charge.amountMinor,
        payerAddress: payment.from,
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
    unmatched: needsTray
      ? [asUnmatched(payment, recordedOutcome, charge?.id ?? null, now), ...next.unmatched].slice(0, 200)
      : next.unmatched,
  };
}

/** Apply Horizon observations oldest-first, exactly once per operation ID. */
export function reconcileIncomingPayments(
  store: MerchantStore,
  { network, payments, now = Date.now() }: ReconcileIncomingInput,
): MerchantStore {
  let next = store;
  for (const payment of payments) next = reconcileOne(next, network, payment, now);
  return next;
}

function activePaymentActor(actor: StaffMember): void {
  if (!actor.active || !actor.permissions.takePayment) {
    throw new Error(`${actor.name} is not allowed to resolve incoming payments.`);
  }
}

function unresolved(
  store: MerchantStore,
  input: ResolveReconciliationInput,
): PaymentReconciliation {
  activePaymentActor(input.actor);
  if (!Number.isSafeInteger(input.now) || input.now <= 0) {
    throw new Error("Payment resolution time is invalid.");
  }
  const reconciliation = store.paymentReconciliations.find(
    (entry) => entry.id === input.paymentId,
  );
  if (!reconciliation) throw new Error("That incoming payment is no longer in the review log.");
  if (reconciliation.resolution) throw new Error("That incoming payment has already been resolved.");
  if (!store.unmatched.some((payment) => payment.id === input.paymentId)) {
    throw new Error("That incoming payment is no longer waiting for action.");
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
  return {
    ...store,
    unmatched: store.unmatched.filter((payment) => payment.id !== input.paymentId),
    paymentReconciliations: store.paymentReconciliations.map((entry) =>
      entry.id === reconciliation.id
        ? { ...entry, resolution: resolution("dismissed", input.actor, input.now) }
        : entry,
    ),
  };
}

export function attachReconciledPayment(
  store: MerchantStore,
  input: AttachReconciliationInput,
): MerchantStore {
  const reconciliation = unresolved(store, input);
  const payment = store.unmatched.find((entry) => entry.id === input.paymentId);
  const charge = store.charges.find((entry) => entry.id === input.chargeId);
  if (!payment || !charge) throw new Error("The payment or target charge no longer exists.");
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

  const withPayment: MerchantStore = {
    ...store,
    unmatched: store.unmatched.filter((entry) => entry.id !== payment.id),
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
  };
  return completeCryptoTender(withPayment, {
    orderId: charge.orderId,
    chargeId: charge.id,
    amountMinor: charge.amountMinor,
    payerAddress: payment.from,
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
  return {
    ...store,
    unmatched: store.unmatched.filter((entry) => entry.id !== input.paymentId),
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
  };
}
