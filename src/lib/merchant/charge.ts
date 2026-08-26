import { buildSep7PayUri } from "../payuri";
import { NETWORKS } from "../stellar";
import type { NetworkKey } from "../stellar";
import { memoByteLength } from "../format";
import { assetAmountFor, unitPriceE6 } from "./money";
import type {
  AcceptedAsset,
  Charge,
  ChargeQuote,
  MerchantSettings,
  Minor,
  Order,
} from "./types";

/** A Stellar MEMO_TEXT is 28 bytes. The reference has to fit inside one. */
export const MAX_REFERENCE_BYTES = 28;

/**
 * A short prefix from the shop's name, so a customer's wallet shows something
 * recognisable rather than a bare number. Letters and digits only — a memo is
 * bytes, and an accented shop name would eat the budget.
 */
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

/** The memo every payment for this order must carry, e.g. "MC1042". */
export function orderReference(shopName: string, orderNumber: number): string {
  const reference = `${referencePrefix(shopName)}${orderNumber}`;
  if (memoByteLength(reference) <= MAX_REFERENCE_BYTES) return reference;
  return String(orderNumber).slice(0, MAX_REFERENCE_BYTES);
}

export function isNative(asset: AcceptedAsset): boolean {
  return asset.code === "XLM" && !asset.issuer;
}

export function assetKey(asset: AcceptedAsset): string {
  return isNative(asset) ? "native" : `${asset.code}:${asset.issuer ?? ""}`;
}

export function sameAsset(a: AcceptedAsset, b: AcceptedAsset): boolean {
  return assetKey(a) === assetKey(b);
}

export interface QuoteInput {
  asset: AcceptedAsset;
  /** Shop currency per one whole unit of the asset, e.g. 0.2532 for XLM in EUR. */
  currencyPerUnit: number;
}

/**
 * A charge holds one quote per accepted asset for its whole life. Nothing on
 * Stellar can lock a rate, so this is a promise the shop makes for the expiry
 * window and absorbs the movement on — which is why the window is short and why
 * pricing in a stablecoin is the safe default.
 */
export function buildQuotes(
  amountMinor: Minor,
  inputs: QuoteInput[],
  now = Date.now(),
): ChargeQuote[] {
  return inputs.map(({ asset, currencyPerUnit }) => {
    const unitPriceMinorE6 = unitPriceE6(currencyPerUnit);
    return {
      asset,
      unitPriceMinorE6,
      amount: assetAmountFor(amountMinor, unitPriceMinorE6),
      quotedAt: now,
    };
  });
}

export interface CreateChargeInput {
  order: Order;
  settings: MerchantSettings;
  network: NetworkKey;
  destination: string;
  quotes: QuoteInput[];
  /** Defaults to the order total; a split charge uses only its outstanding leg. */
  amountMinor?: Minor;
  now?: number;
  id?: string;
}

export function createCharge({
  order,
  settings,
  network,
  destination,
  quotes,
  amountMinor,
  now = Date.now(),
  id,
}: CreateChargeInput): Charge {
  if (!destination) throw new Error("Merchant Mode needs a receiving account before it can charge.");
  if (quotes.length === 0) throw new Error("No accepted asset has a price right now.");
  const chargeAmount = amountMinor ?? order.totals.totalMinor;
  if (!Number.isSafeInteger(chargeAmount) || chargeAmount <= 0 || chargeAmount > order.totals.totalMinor) {
    throw new Error("A charge must be a positive minor-unit amount within the order total.");
  }
  return {
    id: id ?? `chg_${now.toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`,
    orderId: order.id,
    reference: order.reference,
    network,
    destination,
    amountMinor: chargeAmount,
    currency: order.currency,
    quotes: buildQuotes(chargeAmount, quotes, now),
    status: "awaiting",
    createdAt: now,
    expiresAt: now + settings.chargeExpirySeconds * 1000,
    payment: null,
  };
}

export function quoteFor(charge: Charge, asset: AcceptedAsset): ChargeQuote | null {
  return charge.quotes.find((q) => sameAsset(q.asset, asset)) ?? null;
}

/**
 * The SEP-7 request a customer's wallet reads. `network_passphrase` is always
 * set: without it a testnet request and a mainnet one are indistinguishable.
 */
export function chargePayUri(charge: Charge, quote: ChargeQuote, shopName?: string): string {
  return buildSep7PayUri({
    destination: charge.destination,
    amount: quote.amount,
    assetCode: isNative(quote.asset) ? undefined : quote.asset.code,
    assetIssuer: isNative(quote.asset) ? undefined : (quote.asset.issuer ?? undefined),
    memo: charge.reference,
    memoType: "text",
    msg: shopName ? `${shopName} · ${charge.reference}` : undefined,
    networkPassphrase: NETWORKS[charge.network].networkPassphrase,
  });
}

export function secondsRemaining(charge: Charge, now = Date.now()): number {
  return Math.max(0, Math.ceil((charge.expiresAt - now) / 1000));
}

export function isExpired(charge: Charge, now = Date.now()): boolean {
  return charge.status === "awaiting" && now >= charge.expiresAt;
}

/** Charges still worth watching Horizon for. */
export function liveCharges(charges: Charge[], network: NetworkKey, now = Date.now()): Charge[] {
  return charges.filter(
    (c) => c.network === network && c.status === "awaiting" && now < c.expiresAt,
  );
}
