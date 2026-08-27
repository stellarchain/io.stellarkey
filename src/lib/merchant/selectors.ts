import type { Charge, Order } from "./types";

export interface MerchantRecordIndex {
  readonly ordersById: ReadonlyMap<string, Order>;
  readonly chargesById: ReadonlyMap<string, Charge>;
  /** The first settled charge for an order, matching retained store order. */
  readonly paymentChargeByOrderId: ReadonlyMap<string, Charge>;
}

/** Build the joins shared by merchant summaries, receipts, and reports once. */
export function indexMerchantRecords(
  orders: readonly Order[],
  charges: readonly Charge[],
): MerchantRecordIndex {
  const ordersById = new Map(orders.map((order) => [order.id, order]));
  const chargesById = new Map(charges.map((charge) => [charge.id, charge]));
  const paymentChargeByOrderId = new Map<string, Charge>();
  for (const charge of charges) {
    if (charge.payment && !paymentChargeByOrderId.has(charge.orderId)) {
      paymentChargeByOrderId.set(charge.orderId, charge);
    }
  }
  return { ordersById, chargesById, paymentChargeByOrderId };
}

/** The exact next deadline; settled and already-closed charges do not wake the app. */
export function nextAwaitingChargeExpiry(charges: readonly Charge[]): number | null {
  let next: number | null = null;
  for (const charge of charges) {
    if (charge.status !== "awaiting") continue;
    if (next === null || charge.expiresAt < next) next = charge.expiresAt;
  }
  return next;
}

/**
 * Close every charge whose deadline has passed. Returning the original array
 * when nothing changed keeps React consumers and encrypted persistence quiet.
 */
export function expireAwaitingCharges(charges: Charge[], now: number): Charge[] {
  let changed = false;
  const next = charges.map((charge) => {
    if (charge.status !== "awaiting" || now < charge.expiresAt) return charge;
    changed = true;
    return { ...charge, status: "expired" as const };
  });
  return changed ? next : charges;
}
