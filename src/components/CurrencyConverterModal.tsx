"use client";

import { useMemo, useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import { FIAT_RATES } from "@/lib/format";
import { triggerHaptic } from "@/lib/haptics";
import { Button, Modal, ModalHeader } from "./ui";
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
  const { xlmPriceUsd } = useWallet();
  const [fromCode, setFromCode] = useState("XLM");
  const [toCode, setToCode] = useState("USD");
  const [fromAmount, setFromAmount] = useState("100");

  const units: UnitPriceOption[] = useMemo(() => {
    const xlmUsd = xlmPriceUsd ?? 0.125;
    return [
      { code: "XLM", name: "Stellar Lumens", usdPrice: xlmUsd, isStellar: true },
      { code: "USDC", name: "USD Coin", usdPrice: 1.0, isStellar: true },
      { code: "EURC", name: "Euro Coin", usdPrice: 1.08, isStellar: true },
      { code: "BTC", name: "Bitcoin", usdPrice: 65000, isStellar: true },
      { code: "ETH", name: "Ethereum", usdPrice: 3500, isStellar: true },
      { code: "USD", name: "US Dollar", usdPrice: 1.0, isFiat: true },
      { code: "EUR", name: "Euro", usdPrice: 1 / (FIAT_RATES.EUR ?? 0.92), isFiat: true },
      { code: "GBP", name: "British Pound", usdPrice: 1 / (FIAT_RATES.GBP ?? 0.79), isFiat: true },
      { code: "JPY", name: "Japanese Yen", usdPrice: 1 / (FIAT_RATES.JPY ?? 154.5), isFiat: true },
      { code: "CAD", name: "Canadian Dollar", usdPrice: 1 / (FIAT_RATES.CAD ?? 1.38), isFiat: true },
      { code: "AUD", name: "Australian Dollar", usdPrice: 1 / (FIAT_RATES.AUD ?? 1.52), isFiat: true },
      { code: "CHF", name: "Swiss Franc", usdPrice: 1 / (FIAT_RATES.CHF ?? 0.89), isFiat: true },
    ];
  }, [xlmPriceUsd]);

  const fromUnit = units.find((u) => u.code === fromCode) ?? units[0];
  const toUnit = units.find((u) => u.code === toCode) ?? units[5];

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
        subtitle="Real-time fiat & crypto exchange rates"
        onClose={onClose}
      />
      <div className="p-6 space-y-5">
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
              <select
                value={fromCode}
                onChange={(e) => {
                  triggerHaptic("selection");
                  setFromCode(e.target.value);
                }}
                className="input !h-12 text-[14px] font-semibold !w-32 cursor-pointer"
              >
                {units.map((u) => (
                  <option key={u.code} value={u.code} className="bg-neutral-900 text-white">
                    {u.code}
                  </option>
                ))}
              </select>
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
              <select
                value={toCode}
                onChange={(e) => {
                  triggerHaptic("selection");
                  setToCode(e.target.value);
                }}
                className="input !h-12 text-[14px] font-semibold !w-32 cursor-pointer"
              >
                {units.map((u) => (
                  <option key={u.code} value={u.code} className="bg-neutral-900 text-white">
                    {u.code}
                  </option>
                ))}
              </select>
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
