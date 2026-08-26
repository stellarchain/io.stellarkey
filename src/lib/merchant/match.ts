import { quoteFor } from "./charge";
import { compareToBand, toleranceStroops } from "./money";
import type { Charge, MatchedPayment, MerchantSettings } from "./types";

/** A payment Horizon has shown us, before we know what it belongs to. */
export type ObservedPayment = Omit<MatchedPayment, "lane">;

export type MatchOutcome =
  /** The memo named a charge. Nothing to confirm. */
  | { lane: "memo"; charge: Charge; verdict: AmountVerdict }
  /** One live charge fits and a person has to agree before it is filed. */
  | { lane: "amount"; charge: Charge; verdict: AmountVerdict; needsConfirmation: true }
  /** A second payment against a reference that is already settled. */
  | { lane: "duplicate"; charge: Charge }
  /** Nothing safe to say. It goes to the tray until staff attach it. */
  | { lane: "unmatched"; reason: UnmatchedReason };

export type AmountVerdict = "exact" | "inside" | "short" | "over";

export type UnmatchedReason =
  | "no_candidate"
  | "ambiguous"
  | "wrong_asset"
  | "outside_band"
  | "expired";

function amountVerdict(
  payment: ObservedPayment,
  charge: Charge,
  settings: MerchantSettings,
): AmountVerdict | null {
  const quote = quoteFor(charge, payment.asset);
  if (!quote) return null;
  const band = toleranceStroops(
    quote.amount,
    settings.toleranceBps,
    settings.toleranceFloorMinor,
    quote.unitPriceMinorE6,
  );
  return compareToBand(payment.amount, quote.amount, band);
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
  now = Date.now(),
): MatchOutcome {
  // `charges` is expected to be scoped to the active network by the caller.

  // Lane 1 — the memo names a charge outright.
  if (payment.memo) {
    const named = charges.find((c) => c.reference === payment.memo);
    if (named) {
      if (named.status !== "awaiting") return { lane: "duplicate", charge: named };
      const verdict = amountVerdict(payment, named, settings);
      if (!verdict) return { lane: "unmatched", reason: "wrong_asset" };
      return { lane: "memo", charge: named, verdict };
    }
  }

  // Lane 2 — no usable memo. Only charges still open, in the asset that arrived.
  const live = charges.filter(
    (c) => c.status === "awaiting" && now < c.expiresAt && quoteFor(c, payment.asset),
  );
  if (live.length === 0) {
    const expiredFit = charges.some(
      (c) => c.status === "awaiting" && now >= c.expiresAt && quoteFor(c, payment.asset),
    );
    if (expiredFit) return { lane: "unmatched", reason: "expired" };
    const anyAsset = charges.some((c) => c.status === "awaiting" && now < c.expiresAt);
    return { lane: "unmatched", reason: anyAsset ? "wrong_asset" : "no_candidate" };
  }

  // Exact to the stroop. This is the only test that can read a sub-cent salt.
  const exact = live.filter((c) => amountVerdict(payment, c, settings) === "exact");
  if (exact.length === 1) {
    return { lane: "amount", charge: exact[0], verdict: "exact", needsConfirmation: true };
  }
  if (exact.length > 1) return { lane: "unmatched", reason: "ambiguous" };

  // The band, and only against a single remaining candidate.
  if (live.length > 1) return { lane: "unmatched", reason: "ambiguous" };
  const only = live[0];
  const verdict = amountVerdict(payment, only, settings);
  if (verdict === "inside") {
    return { lane: "amount", charge: only, verdict, needsConfirmation: true };
  }
  return { lane: "unmatched", reason: "outside_band" };
}

/** What a matched payment does to its charge. */
export function chargeStatusFor(verdict: AmountVerdict): Charge["status"] {
  if (verdict === "short") return "underpaid";
  if (verdict === "over") return "overpaid";
  return "paid";
}

export function describeUnmatched(reason: UnmatchedReason): string {
  switch (reason) {
    case "ambiguous":
      return "More than one open charge fits this amount, so the till will not guess.";
    case "wrong_asset":
      return "This asset does not match any open charge.";
    case "outside_band":
      return "The amount is outside every open charge's tolerance.";
    case "expired":
      return "The charge it would have matched has expired.";
    default:
      return "No open charge matches this payment.";
  }
}
