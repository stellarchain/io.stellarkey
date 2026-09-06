"use client";

import { useEffect, useState } from "react";
import {
  useWalletIdentity,
  useWalletMarket,
  useWalletPreferences,
} from "@/hooks/useWallet";
import { fmtFiat } from "@/lib/format";
import { assetPriceKey, fetchAssetPriceSamples, marketDataLabel, type MarketSamples } from "@/lib/prices";

/**
 * Live local-currency equivalent of an asset amount, e.g. "≈ $4.91".
 * Renders nothing when the asset is unpriced, the amount is zero/invalid,
 * or privacy mode is masking balances.
 */
export function FiatValue({
  amount,
  code,
  issuer,
  isNative: isNativeProp,
  className = "",
  prefix = "≈ ",
}: {
  amount: number | string | null | undefined;
  /** Asset code; "XLM" (or "native") prices via the live XLM rate. */
  code: string;
  issuer?: string | null;
  isNative?: boolean;
  className?: string;
  prefix?: string;
}) {
  const { network } = useWalletIdentity();
  const { xlmPriceSample, fiatRateSamples, fiatRates } = useWalletMarket();
  const { fiatCurrency, privacyMode } = useWalletPreferences();
  const normalized = code.trim().toUpperCase();
  const isNative = isNativeProp ?? (!issuer && (normalized === "XLM" || normalized === "NATIVE"));
  const [assetPrices, setAssetPrices] = useState<MarketSamples>({});

  useEffect(() => {
    if (isNative) return;
    let alive = true;
    void fetchAssetPriceSamples([{ code: normalized, issuer: issuer ?? null, network }]).then((p) => {
      if (alive) setAssetPrices(p);
    });
    return () => {
      alive = false;
    };
  }, [normalized, issuer, isNative, network]);

  if (privacyMode || amount === null || amount === undefined) return null;
  const num = typeof amount === "number" ? amount : parseFloat(amount);
  if (!Number.isFinite(num) || num <= 0) return null;
  const sample = isNative ? xlmPriceSample : assetPrices[assetPriceKey(network, normalized, issuer)];
  const unit = network === "mainnet" ? sample?.value ?? null : null;
  if (unit === null) return null;
  const status = marketDataLabel([sample, fiatRateSamples[fiatCurrency]]);

  return (
    <span className={className} title={status}>
      {prefix}
      {fmtFiat(num * unit, fiatCurrency, fiatRates)}
      {status.startsWith("Stale") && " · stale"}
      <span className="sr-only"> {status}</span>
    </span>
  );
}
