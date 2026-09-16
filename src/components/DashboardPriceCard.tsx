"use client";

import { useMemo, useState } from "react";
import {
  useWalletIdentity,
  useWalletLedger,
  useWalletMarket,
  useWalletPreferences,
} from "@/hooks/useWallet";
import type { PriceRange as PriceRangeT } from "@/lib/api";
import { fmtFiat, fmtFiatMarketPrice } from "@/lib/format";
import { triggerHaptic } from "@/lib/haptics";
import { PriceChart, type PriceChartInspection } from "./PriceChart";

export function DashboardPriceCard() {
  const {
    priceData,
    priceRange,
    changePriceRange,
    priceLoading,
    priceError,
    fiatRates,
  } = useWalletMarket();
  const { accountBalances } = useWalletLedger();
  const { accounts, activeAccount, network } = useWalletIdentity();
  const { fiatCurrency } = useWalletPreferences();
  const ranges: PriceRangeT[] = ["1D", "7D", "1M", "1Y"];
  const [chartMode, setChartMode] = useState<"market" | "portfolio">("market");
  const [chartInspection, setChartInspection] = useState<PriceChartInspection | null>(null);
  const displayedRange = priceData?.range ?? priceRange;
  const periodLabel = ({
    "1D": "24-hour",
    "7D": "7-day",
    "1M": "1-month",
    "1Y": "1-year",
  } satisfies Record<PriceRangeT, string>)[displayedRange];

  const totalAllXlm = useMemo(
    () => Object.values(accountBalances).reduce((sum, n) => sum + n, 0),
    [accountBalances],
  );
  const canShowPortfolio = network === "mainnet" && totalAllXlm > 0 && priceData !== null;
  const mode = canShowPortfolio ? chartMode : "market";

  // Portfolio series: your total balance × historical XLM price
  const portfolioPoints = useMemo(
    () =>
      priceData && canShowPortfolio
        ? priceData.points.map((pt) => ({ t: pt.t, p: pt.p * totalAllXlm }))
        : [],
    [priceData, canShowPortfolio, totalAllXlm],
  );

  const headerLabel =
    mode === "portfolio"
      ? `Your Portfolio · ${accounts.length > 1 ? `${accounts.length} accounts` : activeAccount?.label ?? ""}`
      : "XLM Market";

  const currentValue =
    mode === "portfolio"
      ? portfolioPoints.at(-1)?.p ?? null
      : priceData?.current ?? null;

  let changePct = priceData?.changePct ?? null;
  if (mode === "portfolio") {
    const firstPrice = portfolioPoints[0]?.p;
    changePct = portfolioPoints.length >= 2 && currentValue !== null && firstPrice
      ? ((currentValue - firstPrice) / firstPrice) * 100
      : null;
  }

  const displayedValue = chartInspection?.p ?? currentValue;
  const displayedChangePct = chartInspection?.changePct ?? changePct;
  const up = (displayedChangePct ?? 0) >= 0;

  return (
    <section className="panel fade-up relative flex h-full flex-col p-5 sm:p-6">
      {canShowPortfolio && (
        <div className="mb-3 flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] p-0.5">
          {(
            [
              { id: "market", label: "Market" },
              { id: "portfolio", label: "Your Portfolio" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => {
                triggerHaptic("selection");
                setChartInspection(null);
                setChartMode(opt.id);
              }}
              className={`flex-1 rounded-full px-3 py-1 text-[11.5px] font-semibold transition-[color,background-color,box-shadow] ${
                mode === opt.id
                  ? "bg-[#0A84FF] text-[var(--color-oncolor)] shadow-sm"
                  : "text-neutral-400 hover:text-white"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0">
          <p className="truncate text-[12.5px] font-semibold text-neutral-400">{headerLabel}</p>
          <p className="mt-0.5 truncate text-[10.5px] text-neutral-500">
            {mode === "market"
              ? `Stellar Lumens · ${periodLabel} range`
              : `${periodLabel} estimate · current balance`}
          </p>
        </div>
        <div className="relative min-w-0 justify-self-end text-right">
          <div className="flex flex-nowrap items-center justify-end gap-2.5 text-right">
            <span className="whitespace-nowrap text-[24px] font-bold tracking-tight text-white">
              {displayedValue !== null
                ? mode === "market"
                  ? fmtFiatMarketPrice(displayedValue, fiatCurrency, fiatRates)
                  : fmtFiat(displayedValue, fiatCurrency, fiatRates)
                : "—"}
            </span>
            {displayedChangePct !== null && (
              <span
                className="shrink-0 whitespace-nowrap rounded-lg px-2 py-0.5 text-[12px] font-semibold"
                style={{
                  color: up ? "var(--color-pos)" : "var(--color-neg)",
                  background: up ? "rgba(48,209,88,0.15)" : "rgba(255,69,58,0.15)",
                }}
              >
                {up ? "+" : ""}
                {displayedChangePct.toFixed(2)}%
              </span>
            )}
          </div>
          {priceLoading && (
            <p
              aria-live="polite"
              className="absolute right-0 top-full mt-0.5 flex items-center justify-end gap-1.5 text-[10px] text-neutral-500"
            >
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#0A84FF]" aria-hidden="true" />
              Updating
            </p>
          )}
        </div>
      </div>
      {priceError && (
        <p className="mt-1 text-[10px] text-neutral-500" role="status">
          Chart refresh unavailable{priceData ? " · Showing previous data" : ""}
        </p>
      )}
      <div className="mt-3" aria-busy={priceLoading}>
        {mode === "portfolio" && portfolioPoints.length > 1 ? (
          <PriceChart
            points={portfolioPoints}
            range={displayedRange}
            currency={fiatCurrency}
            rates={fiatRates}
            onInspect={setChartInspection}
          />
        ) : priceData && priceData.points.length > 1 ? (
          <PriceChart
            points={priceData.points}
            range={displayedRange}
            currency={fiatCurrency}
            rates={fiatRates}
            marketPrecision
            onInspect={setChartInspection}
          />
        ) : priceError ? (
          <p className="flex h-[140px] items-center justify-center text-sm text-neutral-400">Chart unavailable</p>
        ) : (
          <div className="skeleton h-[140px] w-full rounded-2xl" />
        )}
      </div>
      {/* The footer owns the remaining space so both desktop summary cards end
          on one optical action line without fixed card heights. */}
      <div data-market-range-selector className="mt-auto pt-3">
        <div
          aria-label="Chart range"
          className="grid grid-cols-4 gap-1 rounded-xl bg-white/[0.06] p-1"
          role="group"
        >
          {ranges.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={priceRange === r}
              onClick={() => {
                triggerHaptic("selection");
                setChartInspection(null);
                void changePriceRange(r);
              }}
              className={`rounded-lg px-2.5 py-1 text-center text-[12px] font-semibold transition-colors ${
                priceRange === r ? "bg-white/[0.18] text-white shadow-sm" : "text-neutral-400 hover:text-white"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
