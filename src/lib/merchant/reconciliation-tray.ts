import type {
  MerchantStore,
  PaymentReconciliation,
  UnmatchedPayment,
} from "./types";

export const MAX_RECONCILIATION_TRAY_ROWS = 200;

export function reconciliationNeedsAction(record: PaymentReconciliation): boolean {
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
    throw new Error(
      `The reconciliation tray limit must be between 0 and ${MAX_RECONCILIATION_TRAY_ROWS}.`,
    );
  }
  if (limit === 0) return [];
  const tray: UnmatchedPayment[] = [];
  for (const record of store.paymentReconciliations) {
    if (reconciliationNeedsAction(record)) tray.push(unmatchedForReconciliation(record));
    if (tray.length === limit) break;
  }
  return tray;
}
