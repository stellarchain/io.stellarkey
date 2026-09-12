"use client";

import { useId, useLayoutEffect, useMemo, useState } from "react";
import { SectionHeader } from "@/components/ui";
import { useWalletMarket } from "@/hooks/useWallet";
import { triggerHaptic } from "@/lib/haptics";
import { marketDataLabel } from "@/lib/prices";
import { Button, ModalBody, ModalFooter, Notice, QuickAmountChips, Select } from "./ui";
import { IconSwap } from "./icons";

interface UnitPriceOption {
  code: string;
  name: string;
  usdPrice: number;
  isFiat?: boolean;
  isStellar?: boolean;
}

/** Header text the converter reports to its shell: the market-data disclosure. */
export type CurrencyConverterHeader = { title: string; subtitle?: string };

export interface CurrencyConverterModalBodyProps {
  onClose: () => void;
  onOpenSwap?: () => void;
  onHeaderChange: (header: CurrencyConverterHeader | null) => void;
}

// Mounted by the CurrencyConverterModal shell for each opening and kept
// through its exit.
export function CurrencyConverterModalBody({
  onClose,
  onOpenSwap,
  onHeaderChange,
}: CurrencyConverterModalBodyProps) {
  const { xlmPriceUsd, xlmPriceSample, fiatRates, fiatRateSamples } = useWalletMarket();
  const [fromCode, setFromCode] = useState("XLM");
  const [toCode, setToCode] = useState("USD");
  const [fromAmount, setFromAmount] = useState("100");
  const fromAmountId = useId();

  const units: UnitPriceOption[] = useMemo(() => {
    const names: Record<string, string> = {
      USD: "US Dollar",
      EUR: "Euro",
      GBP: "British Pound",
      JPY: "Japanese Yen",
      CAD: "Canadian Dollar",
      AUD: "Australian Dollar",
      CHF: "Swiss Franc",
    };
    const fiatUnits = Object.entries(fiatRates)
      .filter((entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] > 0)
      .map(([code, perUsd]) => ({
        code,
        name: names[code] ?? code,
        usdPrice: 1 / perUsd,
        isFiat: true,
      }));
    return [
      { code: "XLM", name: "Stellar Lumens", usdPrice: xlmPriceUsd ?? 0, isStellar: true },
      ...fiatUnits,
    ];
  }, [xlmPriceUsd, fiatRates]);

  const fromUnit = units.find((u) => u.code === fromCode) ?? units[0];
  const toUnit = units.find((u) => u.code === toCode) ?? units[1];

  const parsedFrom = parseFloat(fromAmount) || 0;
  const priceUnavailable = !(fromUnit.usdPrice > 0) || !(toUnit.usdPrice > 0);
  const rate = priceUnavailable ? null : fromUnit.usdPrice / toUnit.usdPrice;
  const calculatedTo = rate === null ? null : parsedFrom * rate;
  const unavailableCode = !(fromUnit.usdPrice > 0) ? fromUnit.code : toUnit.code;

  function handleSwapUnits() {
    triggerHaptic("selection");
    setFromCode(toCode);
    setToCode(fromCode);
  }

  const canDEXSwap = fromUnit.isStellar && toUnit.isStellar && fromCode !== toCode;
  const unitOptions = units.map((u) => ({
    value: u.code,
    label: u.code,
    sublabel: u.name,
    triggerLabel: u.code,
  }));

  const subtitle = marketDataLabel(
    [fromCode, toCode].map((code) => code === "XLM" ? xlmPriceSample : fiatRateSamples[code]),
  );
  useLayoutEffect(() => {
    onHeaderChange({ title: "Currency Converter", subtitle });
    return () => onHeaderChange(null);
  }, [onHeaderChange, subtitle]);

  return (
    <ModalBody>
      {/* Converter Card */}
      <div className="rounded-3xl bg-white/[0.03] border border-white/10 p-5 space-y-4 shadow-xl">
        {/* From Input */}
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-neutral-400 mb-1.5" htmlFor={fromAmountId}>
            Convert From
          </label>
          <div className="flex items-center gap-2">
            <input
              id={fromAmountId}
              type="text"
              inputMode="decimal"
              enterKeyHint="done"
              autoComplete="off"
              value={fromAmount}
              onChange={(e) => setFromAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="0.00"
              className="input mono !h-12 flex-1 text-base font-semibold sm:text-[15px]"
            />
            <Select
              value={fromCode}
              onChange={setFromCode}
              ariaLabel="Convert from"
              panelMinWidth={230}
              className="!h-12 !w-32 text-[14px] font-semibold"
              options={unitOptions}
            />
          </div>
        </div>

        {/* Swap Invert Button */}
        <div className="flex items-center justify-center">
          <button
            type="button"
            onClick={handleSwapUnits}
            aria-label="Invert conversion"
            className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/[0.08] text-[var(--color-oncolor)] shadow-sm transition-transform hover:bg-white/[0.16] active:scale-95"
          >
            <IconSwap size={16} />
          </button>
        </div>

        {/* To Output */}
        <div>
          <SectionHeader as="span" className="block mb-1.5">Converted Amount</SectionHeader>
          <div className="flex items-center gap-2">
            <output
              className={`input mono !h-12 flex flex-1 items-center bg-white/[0.02] text-base font-semibold text-white sm:text-[15px] ${
                priceUnavailable ? "opacity-40" : ""
              }`}
            >
              {calculatedTo !== null && calculatedTo > 0
                ? calculatedTo.toLocaleString("en-US", {
                    maximumFractionDigits: toUnit.isFiat && toUnit.code === "JPY" ? 0 : 4,
                  })
                : priceUnavailable
                  ? "—"
                  : "0.00"}
            </output>
            <Select
              value={toCode}
              onChange={setToCode}
              ariaLabel="Convert to"
              panelMinWidth={230}
              className="!h-12 !w-32 text-[14px] font-semibold"
              options={unitOptions}
            />
          </div>
        </div>
      </div>

      {priceUnavailable ? (
        <Notice tone="warn">
          Price unavailable for {unavailableCode} right now. Conversions resume when market data returns.
        </Notice>
      ) : (
        /* Rate Summary Banner */
        <div className="flex items-center justify-between px-2 text-[12.5px] text-neutral-300">
          <span>Exchange Rate:</span>
          <span className="mono font-semibold text-[#30D158]">
            1 {fromCode} ={" "}
            {(rate ?? 0).toLocaleString("en-US", {
              maximumFractionDigits: 6,
            })}{" "}
            {toCode}
          </span>
        </div>
      )}

      {/* Quick Amount Presets */}
      <QuickAmountChips fill values={[10, 50, 100, 500, 1000]} onPick={setFromAmount} />

      {/* DEX Swap Action if both are Stellar assets */}
      <ModalFooter
        secondary={
          canDEXSwap && onOpenSwap ? (
            <Button type="button" variant="ghost" onClick={onClose}>
              Done
            </Button>
          ) : undefined
        }
        primary={
          canDEXSwap && onOpenSwap ? (
            <Button
              type="button"
              onClick={() => {
                onClose();
                onOpenSwap();
              }}
            >
              <IconSwap size={16} />
              <span>Execute swap on Stellar DEX</span>
            </Button>
          ) : (
            <Button type="button" variant="ghost" onClick={onClose}>
              Done
            </Button>
          )
        }
      />
    </ModalBody>
  );
}
