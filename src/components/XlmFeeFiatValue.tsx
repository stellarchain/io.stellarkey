"use client";

import { useWalletMarket, useWalletPreferences } from "@/hooks/useWallet";
import { formatXlmFeeFiatValue } from "@/lib/fee-equivalent";

/**
 * Display-only local-currency context for an exact XLM fee. The primary XLM
 * amount remains authoritative; Testnet uses the same representative live XLM
 * market rate as the rest of the wallet preview.
 */
export function XlmFeeFiatValue({
  amount,
  className = "text-[10.5px] font-normal text-neutral-500",
}: {
  amount: string;
  className?: string;
}) {
  const { xlmPriceUsd, fiatRates } = useWalletMarket();
  const { fiatCurrency, privacyMode } = useWalletPreferences();
  if (privacyMode) return null;

  const value = formatXlmFeeFiatValue(amount, xlmPriceUsd, fiatCurrency, fiatRates);
  return (
    <span className={className} data-xlm-fee-fiat>
      {value === null || value === "Rate unavailable" ? "Local rate unavailable" : `≈ ${value}`}
    </span>
  );
}
