import { FIAT_SYMBOLS } from "../format";
import type { FiatCurrency } from "../format";
import type {
  Minor,
  OrderLine,
  OrderTotals,
  StellarAmount,
  TaxMode,
  TaxRate,
  TipSettings,
} from "./types";

/**
 * All merchant arithmetic. Money is an integer count of minor units; tax is the
 * sum of per-line figures and is never recomputed from a grand total, because a
 * mixed-rate ticket does not survive the shortcut.
 */

const STROOPS_PER_UNIT = BigInt(10_000_000);
/** Quote prices carry six extra digits so a sub-cent asset price stays exact. */
export const PRICE_SCALE = 1_000_000;
const PRICE_SCALE_BIG = BigInt(PRICE_SCALE);

/** Commercial rounding: half away from zero, so 0.5 never drifts toward even. */
export function roundMinor(value: number): Minor {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/** "27.33" or 27.33 → 2733. Throws on anything that is not a plain amount. */
export function toMinor(value: string | number): Minor {
  const raw = typeof value === "number" ? value.toFixed(2) : value.trim();
  if (!/^-?\d*(\.\d*)?$/.test(raw) || raw === "" || raw === "." || raw === "-") {
    throw new Error(`Not an amount: ${String(value)}`);
  }
  const negative = raw.startsWith("-");
  const [whole, fraction = ""] = raw.replace("-", "").split(".");
  const cents = Number(`${whole || "0"}${(fraction + "00").slice(0, 2)}`);
  return negative ? -cents : cents;
}

/** 2733 → "27.33". No symbol, no grouping — for inputs and machine output. */
export function minorToDecimal(minor: Minor): string {
  const negative = minor < 0;
  const abs = Math.abs(minor);
  return `${negative ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** 2733 → "€ 27.33". */
export function fmtMinor(minor: Minor, currency: FiatCurrency): string {
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const body = `${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
  return `${negative ? "-" : ""}${FIAT_SYMBOLS[currency] ?? ""} ${body}`.trim();
}

/** Unit price plus every modifier, times quantity. */
export function lineGrossMinor(line: OrderLine): Minor {
  const unit = line.modifiers.reduce((sum, m) => sum + m.priceMinor, line.unitPriceMinor);
  return unit * line.quantity;
}

/**
 * Split `amount` across `weights` so the parts sum to exactly `amount`.
 * Largest-remainder, so a pro-rata discount never loses or invents a cent.
 */
export function distribute(amount: Minor, weights: number[]): Minor[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0 || amount === 0) return weights.map(() => 0);
  const exact = weights.map((w) => (amount * w) / total);
  const floors = exact.map((v) => Math.floor(v));
  let remainder = amount - floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  const out = [...floors];
  for (const { i } of order) {
    if (remainder <= 0) break;
    out[i] += 1;
    remainder -= 1;
  }
  return out;
}

/** Tax contained in (inclusive) or added to (added) a gross figure. */
export function taxOn(grossMinor: Minor, percent: number, mode: TaxMode): Minor {
  if (percent <= 0) return 0;
  return mode === "inclusive"
    ? roundMinor((grossMinor * percent) / (100 + percent))
    : roundMinor((grossMinor * percent) / 100);
}

export function tipPresets(
  baseMinor: Minor,
  tips: TipSettings,
): { label: string; amountMinor: Minor }[] {
  if (tips.mode === "off") return [];
  const usePercent = tips.mode === "percent" && baseMinor > tips.thresholdMinor;
  if (usePercent) {
    return tips.percents.map((p) => ({
      label: `${p} %`,
      amountMinor: roundMinor((baseMinor * p) / 100),
    }));
  }
  return tips.fixedMinor.map((amountMinor) => ({
    label: minorToDecimal(amountMinor),
    amountMinor,
  }));
}

export interface TotalsInput {
  lines: OrderLine[];
  taxRates: TaxRate[];
  taxMode: TaxMode;
  discountMinor?: Minor;
  tipMinor?: Minor;
}

/**
 * The whole ticket, derived once. Discount is spread pro-rata across lines so
 * each tax rate is charged on what was actually paid for it; tip is never taxed.
 */
export function orderTotals({
  lines,
  taxRates,
  taxMode,
  discountMinor = 0,
  tipMinor = 0,
}: TotalsInput): OrderTotals {
  const lineGross = lines.map(lineGrossMinor);
  const grossMinor = lineGross.reduce((a, b) => a + b, 0);
  const discount = Math.min(Math.max(discountMinor, 0), grossMinor);
  const discountPerLine = distribute(discount, lineGross);

  const rateById = new Map(taxRates.map((r) => [r.id, r]));
  const taxByRate: Record<string, Minor> = {};
  let taxMinor = 0;

  lines.forEach((line, i) => {
    const payable = lineGross[i] - discountPerLine[i];
    const rate = rateById.get(line.taxRateId);
    const tax = taxOn(payable, rate?.percent ?? 0, taxMode);
    if (tax === 0) return;
    taxByRate[line.taxRateId] = (taxByRate[line.taxRateId] ?? 0) + tax;
    taxMinor += tax;
  });

  const payableGross = grossMinor - discount;
  const netMinor = taxMode === "inclusive" ? payableGross - taxMinor : payableGross;
  const totalMinor =
    (taxMode === "inclusive" ? payableGross : payableGross + taxMinor) + Math.max(tipMinor, 0);

  return {
    grossMinor,
    discountMinor: discount,
    tipMinor: Math.max(tipMinor, 0),
    netMinor,
    taxByRate,
    taxMinor,
    totalMinor,
  };
}

/** "27.3300000" → 273300000n. Throws on a malformed amount. */
export function toStroops(amount: StellarAmount): bigint {
  const raw = amount.trim();
  if (!/^-?\d+(\.\d{1,7})?$/.test(raw)) throw new Error(`Not a Stellar amount: ${amount}`);
  const negative = raw.startsWith("-");
  const [whole, fraction = ""] = raw.replace("-", "").split(".");
  const stroops = BigInt(whole) * STROOPS_PER_UNIT + BigInt(fraction.padEnd(7, "0"));
  return negative ? -stroops : stroops;
}

/** 273300000n → "27.3300000". Always seven decimals, the way Horizon prints them. */
export function fromStroops(stroops: bigint): StellarAmount {
  const negative = stroops < BigInt(0);
  const abs = negative ? -stroops : stroops;
  const whole = abs / STROOPS_PER_UNIT;
  const fraction = (abs % STROOPS_PER_UNIT).toString().padStart(7, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/**
 * A live rate (shop currency per 1 unit of asset, e.g. 0.2532) as the integer
 * price a quote is held at. XLM at EUR 0.2532 becomes 25_320_000.
 */
export function unitPriceE6(currencyPerUnit: number): number {
  if (!Number.isFinite(currencyPerUnit) || currencyPerUnit <= 0) {
    throw new Error("A positive rate is required to quote an asset amount.");
  }
  return Math.round(currencyPerUnit * 100 * PRICE_SCALE);
}

/**
 * What to ask for in an asset, given a held quote. Rounded up, so the shop is
 * never short by a stroop.
 */
export function assetAmountFor(amountMinor: Minor, unitPriceMinorE6: number): StellarAmount {
  if (!Number.isInteger(unitPriceMinorE6) || unitPriceMinorE6 <= 0) {
    throw new Error("A quote price is required to quote an asset amount.");
  }
  const numerator = BigInt(amountMinor) * STROOPS_PER_UNIT * PRICE_SCALE_BIG;
  const denominator = BigInt(unitPriceMinorE6);
  const stroops = (numerator + denominator - BigInt(1)) / denominator;
  return fromStroops(stroops);
}

/** The reverse: what an asset amount is worth, in minor units. */
export function minorForAssetAmount(amount: StellarAmount, unitPriceMinorE6: number): Minor {
  const stroops = toStroops(amount);
  return Number(
    (stroops * BigInt(unitPriceMinorE6)) / (STROOPS_PER_UNIT * PRICE_SCALE_BIG),
  );
}

/**
 * The band a memo-less payment is judged against, in stroops. Exact comparison
 * always runs first; this only ever decides a single remaining candidate.
 */
export function toleranceStroops(
  expected: StellarAmount,
  bps: number,
  floorMinor: Minor,
  unitPriceMinorE6: number,
): bigint {
  const expectedStroops = toStroops(expected);
  const proportional = (expectedStroops * BigInt(Math.max(bps, 0))) / BigInt(10_000);
  const floor =
    unitPriceMinorE6 > 0 && floorMinor > 0
      ? toStroops(assetAmountFor(floorMinor, unitPriceMinorE6))
      : BigInt(0);
  return proportional > floor ? proportional : floor;
}

export function compareToBand(
  actual: StellarAmount,
  expected: StellarAmount,
  band: bigint,
): "exact" | "inside" | "short" | "over" {
  const a = toStroops(actual);
  const e = toStroops(expected);
  if (a === e) return "exact";
  const delta = a - e;
  if (delta < BigInt(0)) return -delta <= band ? "inside" : "short";
  return delta <= band ? "inside" : "over";
}
