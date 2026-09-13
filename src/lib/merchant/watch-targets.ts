import type { NetworkKey } from "../stellar";
import type { Charge, CounterCode, Invoice } from "./types";

export interface MerchantWatchSources {
  receivingPublicKey: string | null;
  charges: Charge[];
  invoices: Invoice[];
  counterCodes: CounterCode[];
}

export function merchantCursorKey(network: NetworkKey, destination: string): string {
  return `${network}:${destination}`;
}

/** Accounts whose immutable open requests can still receive a payment. */
export function merchantWatchDestinations(
  sources: MerchantWatchSources,
  network: NetworkKey,
): string[] {
  const destinations = new Set<string>();
  const add = (destination: string | null | undefined) => {
    const value = destination?.trim();
    if (value) destinations.add(value);
  };

  add(sources.receivingPublicKey);
  for (const charge of sources.charges) {
    if (
      charge.network === network &&
      charge.payment === null &&
      (charge.status === "awaiting" || charge.status === "expired")
    ) {
      add(charge.destination);
    }
  }
  for (const invoice of sources.invoices) {
    if (
      invoice.network === network &&
      (invoice.status === "sent" ||
        invoice.status === "partially_paid" ||
        invoice.status === "overdue")
    ) {
      add(invoice.destination);
    }
  }
  for (const code of sources.counterCodes) {
    if (code.network === network && code.active) add(code.destination);
  }

  return [...destinations];
}
