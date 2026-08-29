export interface PublishedProcessorRate {
  id: "square" | "paypal-pos" | "sumup" | "stripe-terminal";
  name: string;
  rateBps: number;
  fixedMinor: number;
  appliesTo: string;
  source: string;
  checkedAt: "2026-08-29";
}

export const PUBLISHED_PROCESSOR_RATES = Object.freeze([
  {
    id: "square",
    name: "Square",
    rateBps: 175,
    fixedMinor: 0,
    appliesTo: "UK card-present",
    source: "https://squareup.com/gb/en/pricing?solution=pricing-in-person-payments",
    checkedAt: "2026-08-29",
  },
  {
    id: "paypal-pos",
    name: "PayPal Point of Sale",
    rateBps: 175,
    fixedMinor: 0,
    appliesTo: "UK card-present",
    source: "https://www.paypal.com/uk/business/pos-system/pricing",
    checkedAt: "2026-08-29",
  },
  {
    id: "sumup",
    name: "SumUp",
    rateBps: 169,
    fixedMinor: 0,
    appliesTo: "UK pay-as-you-go reader",
    source: "https://help.sumup.com/en-GB/articles/4oI3qHHji2I2S9dyvRfec3-pricing-fees?lang=en",
    checkedAt: "2026-08-29",
  },
  {
    id: "stripe-terminal",
    name: "Stripe Terminal",
    rateBps: 140,
    fixedMinor: 10,
    appliesTo: "UK, EEA card",
    source: "https://stripe.com/gb/terminal",
    checkedAt: "2026-08-29",
  },
] as const satisfies readonly PublishedProcessorRate[]);

const DAYS_PER_YEAR = 365;
const BASIS_POINT_DIVISOR = 10_000;

function requirePositiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer.`);
  }
}

function requireNonNegativeSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer.`);
  }
}

function safeProduct(left: number, right: number, label: string): number {
  const result = left * right;
  if (!Number.isSafeInteger(result)) {
    throw new RangeError(`${label} exceeds the safe integer range.`);
  }
  return result;
}

export function annualSales(salesPerDay: number): number {
  requirePositiveSafeInteger(salesPerDay, "Sales per day");
  return safeProduct(salesPerDay, DAYS_PER_YEAR, "Annual sales");
}

export function annualTurnoverMinor(salesPerDay: number, ticketMinor: number): number {
  requirePositiveSafeInteger(ticketMinor, "Average ticket");
  return safeProduct(annualSales(salesPerDay), ticketMinor, "Annual turnover");
}

export function annualProcessorFeeMinor(
  salesPerDay: number,
  ticketMinor: number,
  rate: PublishedProcessorRate,
): number {
  requireNonNegativeSafeInteger(rate.rateBps, "Rate basis points");
  requireNonNegativeSafeInteger(rate.fixedMinor, "Fixed fee");

  const sales = annualSales(salesPerDay);
  const turnover = annualTurnoverMinor(salesPerDay, ticketMinor);
  const percentageNumerator = safeProduct(turnover, rate.rateBps, "Percentage fee");
  const percentageMinor = Math.round(percentageNumerator / BASIS_POINT_DIVISOR);
  const fixedMinor = safeProduct(sales, rate.fixedMinor, "Fixed fee");
  const totalMinor = percentageMinor + fixedMinor;
  if (!Number.isSafeInteger(totalMinor)) {
    throw new RangeError("Annual processor fee exceeds the safe integer range.");
  }
  return totalMinor;
}
