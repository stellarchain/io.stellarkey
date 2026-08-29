import { isCurrentMerchantStore } from "./schema";
import type { MerchantStore } from "./types";

/** Decode the current data format without mutating or repairing storage. */
export function decodeMerchantStore(value: unknown): MerchantStore | null {
  return isCurrentMerchantStore(value) ? value : null;
}

/** Drops resolved history beyond the configured window and retains live work. */
export function prune(store: MerchantStore, retainDays?: number): MerchantStore {
  const cutoff = (() => {
    if (retainDays !== undefined) return Date.now() - retainDays * 24 * 60 * 60 * 1000;
    if (store.settings.recordRetentionMonths === null) return Number.NEGATIVE_INFINITY;
    const date = new Date();
    date.setMonth(date.getMonth() - store.settings.recordRetentionMonths);
    return date.getTime();
  })();
  const unresolvedReconciliations = store.paymentReconciliations.filter(
    (record) => record.resolution === null,
  );
  const protectedOrderIds = new Set<string>();
  const protectedChargeIds = new Set<string>();
  const protectedInvoiceIds = new Set<string>();
  for (const record of unresolvedReconciliations) {
    if (record.orderId) protectedOrderIds.add(record.orderId);
    if (record.chargeId) protectedChargeIds.add(record.chargeId);
    if (record.invoiceId) protectedInvoiceIds.add(record.invoiceId);
  }
  for (const refund of store.refunds) {
    if (
      refund.submissionStatus === "prepared" ||
      refund.submissionStatus === "accepted" ||
      refund.submissionStatus === "status_unknown"
    ) {
      protectedOrderIds.add(refund.orderId);
      if (refund.invoiceId) protectedInvoiceIds.add(refund.invoiceId);
    }
  }
  for (const request of store.refundRequests) {
    if (request.status === "pending") protectedOrderIds.add(request.orderId);
    if (request.status === "pending" && request.invoiceId) {
      protectedInvoiceIds.add(request.invoiceId);
    }
  }
  const orders = store.orders.filter(
    (order) =>
      order.createdAt >= cutoff ||
      order.status === "open" ||
      order.status === "awaiting" ||
      protectedOrderIds.has(order.id),
  );
  const keptOrderIds = new Set(orders.map((order) => order.id));
  const unresolvedPaymentIds = new Set(unresolvedReconciliations.map((record) => record.id));
  const openInvoiceStatuses = new Set(["draft", "sent", "partially_paid", "overdue"]);
  const invoices = store.invoices.filter(
    (invoice) =>
      openInvoiceStatuses.has(invoice.status) ||
      protectedInvoiceIds.has(invoice.id) ||
      (invoice.paidAt ?? invoice.issuedAt ?? cutoff) >= cutoff,
  );
  const keptInvoiceIds = new Set(invoices.map((invoice) => invoice.id));
  const protectedCustomerSources = new Set<string>(unresolvedPaymentIds);
  for (const order of orders) protectedCustomerSources.add(`order:${order.id}`);
  for (const invoice of invoices) {
    for (const payment of invoice.payments ?? []) {
      protectedCustomerSources.add(`invoice-payment:${payment.id}`);
    }
  }
  const customers = store.customers.flatMap((customer) => {
    const recent = customer.lastSeenAt >= cutoff;
    const sourceIds = recent
      ? customer.sourceIds
      : customer.sourceIds.filter((sourceId) => protectedCustomerSources.has(sourceId));
    const events = customer.loyalty?.events.filter(
      (event) =>
        event.at >= cutoff ||
        (event.sourceId !== null && protectedCustomerSources.has(event.sourceId)),
    ) ?? [];
    if (!recent && sourceIds.length === 0 && events.length === 0) return [];
    return [{
      ...customer,
      name: recent ? customer.name : null,
      note: recent ? customer.note : null,
      sourceIds,
      loyalty: customer.loyalty ? { ...customer.loyalty, events } : null,
    }];
  });

  return {
    ...store,
    orders,
    charges: store.charges.filter(
      (charge) =>
        keptOrderIds.has(charge.orderId) ||
        charge.status === "awaiting" ||
        protectedChargeIds.has(charge.id),
    ),
    refunds: store.refunds.filter(
      (refund) =>
        keptOrderIds.has(refund.orderId) ||
        (refund.invoiceId !== undefined &&
          refund.invoiceId !== null &&
          keptInvoiceIds.has(refund.invoiceId)) ||
        refund.submissionStatus === "prepared" ||
        refund.submissionStatus === "accepted" ||
        refund.submissionStatus === "status_unknown",
    ),
    unmatched: store.unmatched.filter(
      (payment) => payment.seenAt >= cutoff || unresolvedPaymentIds.has(payment.id),
    ),
    paymentReconciliations: store.paymentReconciliations.filter(
      (record) => record.observedAt >= cutoff || record.resolution === null,
    ),
    shifts: store.shifts.filter(
      (shift) => shift.closedAt === null || shift.closedAt >= cutoff,
    ),
    invoices,
    counterPayments: store.counterPayments.filter((payment) => payment.seenAt >= cutoff),
    adjustments: store.adjustments.filter((adjustment) => adjustment.at >= cutoff),
    refundRequests: store.refundRequests.filter(
      (request) => request.status === "pending" || request.requestedAt >= cutoff,
    ),
    exportRecords: store.exportRecords.filter((record) => record.runAt >= cutoff),
    customers,
  };
}
