"use client";

import { useMemo, useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import { triggerHaptic } from "@/lib/haptics";
import { Button, Modal, ModalHeader, Select } from "./ui";
import { IconSwap } from "./icons";

interface UnitPriceOption {
  code: string;
  name: string;
  usdPrice: number;
  isFiat?: boolean;
  isStellar?: boolean;
}

export function CurrencyConverterModal({
  open,
  onClose,
  onOpenSwap,
}: {
  open: boolean;
  onClose: () => void;
  onOpenSwap?: () => void;
}) {
  const { xlmPriceUsd, fiatRates } = useWallet();
  const [fromCode, setFromCode] = useState("XLM");
  const [toCode, setToCode] = useState("USD");
  const [fromAmount, setFromAmount] = useState("100");

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
  const rate = toUnit.usdPrice > 0 ? fromUnit.usdPrice / toUnit.usdPrice : 0;
  const calculatedTo = parsedFrom * rate;

  function handleSwapUnits() {
    triggerHaptic("selection");
    setFromCode(toCode);
    setToCode(fromCode);
  }

  const canDEXSwap = fromUnit.isStellar && toUnit.isStellar && fromCode !== toCode;

  if (!open) return null;

  return (
    <Modal open onClose={onClose} wide>
      <ModalHeader
        title="Live Currency Converter"
        subtitle="Current XLM price and live fiat exchange rates"
        onClose={onClose}
      />
      <div className="space-y-4 p-4 sm:p-6">
        {/* Converter Card */}
        <div className="rounded-3xl bg-white/[0.03] border border-white/10 p-5 space-y-4 shadow-xl">
          {/* From Input */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-neutral-400 mb-1.5">
              Convert From
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                inputMode="decimal"
                value={fromAmount}
                onChange={(e) => setFromAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="0.00"
                className="input mono !h-12 text-[20px] font-semibold flex-1"
              />
              <Select
                value={fromCode}
                onChange={setFromCode}
                ariaLabel="Convert from"
                panelMinWidth={230}
                className="!h-12 !w-32 text-[14px] font-semibold"
                options={units.map((u) => ({
                  value: u.code,
                  label: u.code,
                  sublabel: u.name,
                  triggerLabel: u.code,
                }))}
              />
            </div>
          </div>

          {/* Swap Invert Button */}
          <div className="flex items-center justify-center">
            <button
              type="button"
              onClick={handleSwapUnits}
              className="h-9 w-9 rounded-full bg-white/[0.08] hover:bg-white/[0.16] border border-white/10 flex items-center justify-center text-white transition-transform hover:scale-110 shadow-sm"
              title="Invert conversion"
            >
              <IconSwap size={16} />
            </button>
          </div>

          {/* To Output */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-neutral-400 mb-1.5">
              Converted Amount
            </label>
            <div className="flex items-center gap-2">
              <div className="input mono !h-12 text-[20px] font-semibold flex-1 flex items-center bg-white/[0.02] text-white">
                {calculatedTo > 0
                  ? calculatedTo.toLocaleString("en-US", {
                      maximumFractionDigits: toUnit.isFiat && toUnit.code === "JPY" ? 0 : 4,
                    })
                  : "0.00"}
              </div>
              <Select
                value={toCode}
                onChange={setToCode}
                ariaLabel="Convert to"
                panelMinWidth={230}
                className="!h-12 !w-32 text-[14px] font-semibold"
                options={units.map((u) => ({
                  value: u.code,
                  label: u.code,
                  sublabel: u.name,
                  triggerLabel: u.code,
                }))}
              />
            </div>
          </div>
        </div>

        {/* Rate Summary Banner */}
        <div className="flex items-center justify-between px-2 text-[12.5px] text-neutral-300">
          <span>Exchange Rate:</span>
          <span className="mono font-semibold text-[#30D158]">
            1 {fromCode} ={" "}
            {rate.toLocaleString("en-US", {
              maximumFractionDigits: 6,
            })}{" "}
            {toCode}
          </span>
        </div>

        {/* Quick Amount Presets */}
        <div className="flex items-center gap-2">
          {[10, 50, 100, 500, 1000].map((amt) => (
            <button
              key={amt}
              type="button"
              onClick={() => {
                triggerHaptic("selection");
                setFromAmount(String(amt));
              }}
              className="chip flex-1 justify-center text-[12px] font-medium"
            >
              {amt}
            </button>
          ))}
        </div>

        {/* DEX Swap Action if both are Stellar assets */}
        {canDEXSwap && onOpenSwap && (
          <Button
            className="w-full flex items-center justify-center gap-2 !py-3.5 text-[14px] font-semibold !bg-[#0A84FF] text-white"
            onClick={() => {
              triggerHaptic("success");
              onClose();
              onOpenSwap();
            }}
          >
            <IconSwap size={16} />
            <span>Execute Swap on Stellar DEX</span>
          </Button>
        )}

        <Button variant="ghost" className="w-full" onClick={onClose}>
          Done
        </Button>
      </div>
    </Modal>
  );
}
