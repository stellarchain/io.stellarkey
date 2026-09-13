import { memoByteLength } from "../format";
import type { MerchantStore } from "./types";

/** Stellar MEMO_TEXT is capped at 28 UTF-8 bytes. */
export const MAX_PAYMENT_REFERENCE_BYTES = 28;

export type PaymentReferenceKind = "order" | "invoice" | "counter";

const KIND_TAG: Record<PaymentReferenceKind, string> = {
  order: "O",
  invoice: "I",
  counter: "C",
};

/** A stable, ASCII-only shop namespace that remains readable in a wallet. */
export function referencePrefix(shopName: string): string {
  const initials = shopName
    .split(/\s+/)
    .map((word) => word.replace(/[^A-Za-z0-9]/g, ""))
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
  if (initials.length >= 2) return initials.slice(0, 4);
  const letters = shopName.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return letters.slice(0, 4) || "TILL";
}

function suffixFor(value: string | number, kind: PaymentReferenceKind): string {
  const suffix = String(value).trim().toUpperCase();
  if (!/^[A-Z0-9]+$/.test(suffix)) {
    const label = kind === "counter" ? "Counter-code memo" : `${kind} sequence`;
    throw new Error(`${label} needs at least one uppercase letter or number.`);
  }
  return suffix;
}

/** New records use a visible type tag so separate payment flows cannot compete. */
export function paymentReference(
  kind: PaymentReferenceKind,
  shopName: string,
  suffix: string | number,
): string {
  const reference = `${referencePrefix(shopName)}-${KIND_TAG[kind]}-${suffixFor(suffix, kind)}`;
  if (memoByteLength(reference) > MAX_PAYMENT_REFERENCE_BYTES) {
    throw new Error(`The ${kind} payment reference exceeds Stellar's 28-byte memo limit.`);
  }
  return reference;
}

export function orderReference(shopName: string, orderNumber: number): string {
  if (!Number.isSafeInteger(orderNumber) || orderNumber <= 0) {
    throw new Error("The order sequence is invalid.");
  }
  return paymentReference("order", shopName, orderNumber);
}

export function invoiceReference(shopName: string, invoiceNumber: number): string {
  if (!Number.isSafeInteger(invoiceNumber) || invoiceNumber <= 0) {
    throw new Error("The invoice sequence is invalid.");
  }
  return paymentReference("invoice", shopName, invoiceNumber);
}

export function counterReference(shopName: string, suffix: string): string {
  return paymentReference("counter", shopName, suffix);
}

/** Existing references stay immutable, but no new record may reserve any of them. */
export function assertPaymentReferenceAvailable(
  store: Pick<MerchantStore, "orders" | "invoices" | "counterCodes">,
  reference: string,
): void {
  const wanted = reference.toUpperCase();
  const reserved = [
    ...store.orders.map((order) => order.reference),
    ...store.invoices.map((invoice) => invoice.reference),
    ...store.counterCodes.map((code) => code.memoPrefix),
  ];
  if (reserved.some((entry) => entry.toUpperCase() === wanted)) {
    throw new Error(`The payment reference ${reference} is already reserved by another record.`);
  }
}
