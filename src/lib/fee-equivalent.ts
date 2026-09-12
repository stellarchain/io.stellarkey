import {
  fmtFiatMarketPrice,
  type FiatCurrency,
} from "./format";
import { amountToStroops } from "./stellar-domain";

const STROOPS_PER_XLM = 10_000_000;
const MAX_SAFE_STROOPS = BigInt(Number.MAX_SAFE_INTEGER);

export function formatXlmFeeFiatValue(
  amountXlm: string,
  xlmPriceUsd: number | null,
  currency: FiatCurrency,
  rates: Partial<Record<FiatCurrency, number>>,
): string | null {
  if (xlmPriceUsd === null || !Number.isFinite(xlmPriceUsd) || xlmPriceUsd < 0) return null;
  try {
    const stroops = amountToStroops(amountXlm);
    if (stroops > MAX_SAFE_STROOPS) return null;
    const valueUsd = (Number(stroops) / STROOPS_PER_XLM) * xlmPriceUsd;
    return fmtFiatMarketPrice(valueUsd, currency, rates);
  } catch {
    return null;
  }
}
