"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import { fmtFiat } from "@/lib/format";
import { fetchAssetPrices, getUnitPrice, type AssetPrices } from "@/lib/prices";

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
  const { network, xlmPriceUsd, fiatCurrency, fiatRates, privacyMode } = useWallet();
  const normalized = code.trim().toUpperCase();
  const isNative = isNativeProp ?? (!issuer && (normalized === "XLM" || normalized === "NATIVE"));
  const [assetPrices, setAssetPrices] = useState<AssetPrices>({});

  useEffect(() => {
    if (isNative) return;
    let alive = true;
    void fetchAssetPrices([{ code: normalized, issuer: issuer ?? null, network }]).then((p) => {
      if (alive && Object.keys(p).length > 0) setAssetPrices(p);
    });
    return () => {
      alive = false;
    };
  }, [normalized, issuer, isNative, network]);

  if (privacyMode || amount === null || amount === undefined) return null;
  const num = typeof amount === "number" ? amount : parseFloat(amount);
  if (!Number.isFinite(num) || num <= 0) return null;
  const unit = getUnitPrice(normalized, issuer, network, isNative, xlmPriceUsd, assetPrices);
  if (unit === null) return null;

  return (
    <span className={className}>
      {prefix}
      {fmtFiat(num * unit, fiatCurrency, fiatRates)}
    </span>
  );
}
