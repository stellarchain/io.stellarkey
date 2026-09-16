import type { NetworkKey } from "../stellar";
import { assetKey } from "./charge";
import { lineGrossMinor } from "./money";
import type { AcceptedAsset, Charge, Minor, Order, Refund } from "./types";

export interface TodaySummary {
  takingsMinor: Minor;
  orderCount: number;
  avgTicketMinor: Minor;
  tipsMinor: Minor;
  taxMinor: Minor;
  refundedMinor: Minor;
  byHour: { hour: number; orders: number; takingsMinor: Minor }[];
  topItems: { name: string; units: number; revenueMinor: Minor }[];
  assetMix: { asset: AcceptedAsset; takingsMinor: Minor; share: number }[];
}

export function summarizeMerchantDay(
  orders: readonly Order[],
  refunds: readonly Refund[],
  paymentChargeByOrderId: ReadonlyMap<string, Charge>,
  network: NetworkKey,
  now: number,
): TodaySummary {
  const from = new Date(now).setHours(0, 0, 0, 0);
  const paid = orders.filter((order): order is Order & { paidAt: number } => (
    order.network === network && order.paidAt !== null && order.paidAt >= from
  ));
  let takingsMinor = 0;
  let tipsMinor = 0;
  let taxMinor = 0;
  let refundedMinor = 0;
  const hours = new Map<number, { orders: number; takingsMinor: Minor }>();
  const items = new Map<string, { units: number; revenueMinor: Minor }>();
  const mix = new Map<string, { asset: AcceptedAsset; takingsMinor: Minor }>();

  for (const order of paid) {
    takingsMinor += order.totals.totalMinor;
    tipsMinor += order.totals.tipMinor;
    taxMinor += order.totals.taxMinor;

    const hour = new Date(order.paidAt).getHours();
    const bucket = hours.get(hour) ?? { orders: 0, takingsMinor: 0 };
    bucket.orders += 1;
    bucket.takingsMinor += order.totals.totalMinor;
    hours.set(hour, bucket);

    for (const line of order.lines) {
      const entry = items.get(line.name) ?? { units: 0, revenueMinor: 0 };
      entry.units += line.quantity;
      entry.revenueMinor += lineGrossMinor(line);
      items.set(line.name, entry);
    }

    const asset = paymentChargeByOrderId.get(order.id)?.payment?.asset;
    if (asset) {
      const key = assetKey(asset);
      const entry = mix.get(key) ?? { asset, takingsMinor: 0 };
      entry.takingsMinor += order.totals.totalMinor;
      mix.set(key, entry);
    }
  }

  for (const refund of refunds) {
    if (refund.kind === "order" && refund.network === network &&
        refund.createdAt >= from && refund.submissionStatus === "confirmed") {
      refundedMinor += refund.amountMinor;
    }
  }

  return {
    takingsMinor,
    orderCount: paid.length,
    avgTicketMinor: paid.length ? Math.round(takingsMinor / paid.length) : 0,
    tipsMinor,
    taxMinor,
    refundedMinor,
    byHour: [...hours.entries()]
      .map(([hour, values]) => ({ hour, ...values }))
      .sort((a, b) => a.hour - b.hour),
    topItems: [...items.entries()]
      .map(([name, values]) => ({ name, ...values }))
      .sort((a, b) => b.revenueMinor - a.revenueMinor)
      .slice(0, 8),
    assetMix: [...mix.values()]
      .map((values) => ({ ...values, share: takingsMinor ? values.takingsMinor / takingsMinor : 0 }))
      .sort((a, b) => b.takingsMinor - a.takingsMinor),
  };
}

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
