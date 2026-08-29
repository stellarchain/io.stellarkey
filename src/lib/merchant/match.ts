import { quoteFor } from "./charge";
import { compareToBand, toStroops, toleranceStroops } from "./money";
import { parsePaymentCreatedAt } from "./payment-time";
import type { Charge, MatchedPayment, MerchantSettings } from "./types";

/** A payment Horizon has shown us, before we know what it belongs to. */
export type ObservedPayment = Omit<MatchedPayment, "lane">;

export type MatchOutcome =
  /** The memo named a charge. Nothing to confirm. */
  | {
      lane: "memo";
      charge: Charge;
      verdict: AmountVerdict;
      direction: AmountDirection;
      late: boolean;
    }
  /** One live charge fits and a person has to agree before it is filed. */
  | {
      lane: "amount";
      charge: Charge;
      verdict: AmountVerdict;
      direction: AmountDirection;
      needsConfirmation: true;
    }
  /** A second payment against a reference that is already settled. */
  | { lane: "duplicate"; charge: Charge }
  /** Nothing safe to say. It goes to the tray until staff attach it. */
  | { lane: "unmatched"; reason: UnmatchedReason };

export type AmountVerdict = "exact" | "inside" | "short" | "over";
export type AmountDirection = "exact" | "short" | "over";

export type UnmatchedReason =
  | "no_candidate"
  | "ambiguous"
  | "wrong_asset"
  | "outside_band"
  | "expired"
  | "invalid_time";

function amountVerdict(
  payment: ObservedPayment,
  charge: Charge,
  settings: MerchantSettings,
): { verdict: AmountVerdict; direction: AmountDirection } | null {
  const quote = quoteFor(charge, payment.asset);
  if (!quote) return null;
  const band = toleranceStroops(
    quote.amount,
    settings.toleranceBps,
    settings.toleranceFloorMinor,
    quote.unitPriceMinorE6,
  );
  const verdict = compareToBand(payment.amount, quote.amount, band);
  const actual = toStroops(payment.amount);
  const expected = toStroops(quote.amount);
  return {
    verdict,
    direction: actual === expected ? "exact" : actual < expected ? "short" : "over",
  };
}

/**
 * Resolve an incoming payment to a charge.
 *
 * The order is memo, then the amount lane — exact stroops first, the tolerance
 * band second — then the time window. Exact comparison runs before the band
 * because the band is millions of stroops wide: it can tell a payment from a
 * typo, but it cannot tell three identical espressos apart. Anything the rules
 * cannot decide goes to the tray rather than to a guess, because a band cannot
 * distinguish a short payment from somebody else's payment.
 */
export function matchPayment(
  payment: ObservedPayment,
  charges: Charge[],
  settings: MerchantSettings,
): MatchOutcome {
  // `charges` is expected to be scoped to the active network by the caller.
  const paymentAt = parsePaymentCreatedAt(payment.createdAt);
  if (paymentAt === null) return { lane: "unmatched", reason: "invalid_time" };

  // Lane 1 — the memo names a charge outright.
  if (payment.memo) {
    const named = charges.find((c) => c.reference === payment.memo);
    if (named) {
      if (named.status !== "awaiting" && named.status !== "expired") {
        return { lane: "duplicate", charge: named };
      }
      const late = paymentAt >= named.expiresAt;
      const comparison = amountVerdict(payment, named, settings);
      if (!comparison) return { lane: "unmatched", reason: "wrong_asset" };
      return { lane: "memo", charge: named, ...comparison, late };
    }
  }

  // Lane 2 — no usable memo. Only charges still open, in the asset that arrived.
  const live = charges.filter(
    (c) =>
      (c.status === "awaiting" || c.status === "expired") &&
      paymentAt < c.expiresAt &&
      quoteFor(c, payment.asset),
  );
  if (live.length === 0) {
    const expiredFit = charges.some(
      (c) =>
        (c.status === "awaiting" || c.status === "expired") &&
        paymentAt >= c.expiresAt &&
        quoteFor(c, payment.asset),
    );
    if (expiredFit) return { lane: "unmatched", reason: "expired" };
    const anyAsset = charges.some(
      (c) =>
        (c.status === "awaiting" || c.status === "expired") && paymentAt < c.expiresAt,
    );
    return { lane: "unmatched", reason: anyAsset ? "wrong_asset" : "no_candidate" };
  }

  // Exact to the stroop. This is the only test that can read a sub-cent salt.
  const exact = live.filter((charge) => amountVerdict(payment, charge, settings)?.verdict === "exact");
  if (exact.length === 1) {
    return {
      lane: "amount",
      charge: exact[0],
      verdict: "exact",
      direction: "exact",
      needsConfirmation: true,
    };
  }
  if (exact.length > 1) return { lane: "unmatched", reason: "ambiguous" };

  // The band, and only against a single remaining candidate.
  if (live.length > 1) return { lane: "unmatched", reason: "ambiguous" };
  const only = live[0];
  const comparison = amountVerdict(payment, only, settings);
  if (comparison?.verdict === "inside") {
    return { lane: "amount", charge: only, ...comparison, needsConfirmation: true };
  }
  return { lane: "unmatched", reason: "outside_band" };
}

/** What a matched payment does to its charge. */
export function chargeStatusFor(verdict: AmountVerdict): Charge["status"] {
  if (verdict === "short") return "underpaid";
  if (verdict === "over") return "overpaid";
  return "paid";
}
