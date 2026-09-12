import type { NetworkKey } from "../stellar";
import { assetKey } from "./charge";
import { toStroops } from "./money";
import type { ObservedPayment } from "./match";
import type { MerchantStore } from "./types";

/**
 * Horizon operation IDs are provider-selected. Settlement idempotency instead
 * binds to transaction and payment facts that can be checked against the ledger.
 */
export function paymentTransactionIdentity(
  network: NetworkKey,
  payment: Pick<ObservedPayment, "transactionHash" | "destination" | "asset" | "amount">,
): string {
  return [
    network,
    payment.transactionHash.toLowerCase(),
    payment.destination,
    assetKey(payment.asset),
    toStroops(payment.amount).toString(),
  ].join(":");
}

export function merchantPaymentIdentitySet(store: MerchantStore): Set<string> {
  const identities = new Set<string>();
  for (const charge of store.charges) {
    if (charge.payment) identities.add(paymentTransactionIdentity(charge.network, charge.payment));
  }
  for (const invoice of store.invoices) {
    for (const payment of invoice.payments) {
      if (
        payment.kind === "stellar" &&
        payment.transactionHash &&
        payment.amount &&
        payment.asset &&
        invoice.destination
      ) {
        identities.add(paymentTransactionIdentity(invoice.network, {
          transactionHash: payment.transactionHash,
          destination: invoice.destination,
          asset: payment.asset,
          amount: payment.amount,
        }));
      }
    }
  }
  for (const record of store.counterPayments) {
    const code = store.counterCodes.find((entry) => entry.id === record.codeId);
    if (code) identities.add(paymentTransactionIdentity(code.network, record.payment));
  }
  for (const record of store.paymentReconciliations) {
    identities.add(paymentTransactionIdentity(record.network, record.payment));
  }
  return identities;
}
