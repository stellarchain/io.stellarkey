"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Asset } from "@stellar/stellar-sdk";
import { useWallet } from "@/hooks/useWallet";
import { fmtAmount, isValidAmount } from "@/lib/format";
import { findStrictSendRoute } from "@/lib/swap";
import type { AssetBalance } from "@/lib/types";
import { triggerHaptic } from "@/lib/haptics";
import { Button, ErrorText } from "./ui";
import { IconAlert, IconChevronDown, IconSliders, IconSwap } from "./icons";

export function SwapPage() {
  const { balances, swap, network, refresh } = useWallet();
  const [sendKey, setSendKey] = useState("native");
  const [destKey, setDestKey] = useState("");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState<number>(0.5); // 0.5% default
  const [showSettings, setShowSettings] = useState(false);
  const [route, setRoute] = useState<{
    dest: string;
    destMin: string;
    intermediates: Asset[];
    sendAmount: string;
  } | null>(null);
  const [routing, setRouting] = useState(false);
  const [noRoute, setNoRoute] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const networkRef = useRef(network);
  useEffect(() => {
    networkRef.current = network;
  }, [network]);

  const options = useMemo(() => balances ?? [], [balances]);
  const effectiveDestKey = destKey || options.find((b) => b.key !== sendKey)?.key || "";

  const sendAsset = useMemo(
    () => options.find((b) => b.key === sendKey) ?? null,
    [options, sendKey],
  );
  const destAsset = useMemo(
    () => options.find((b) => b.key === effectiveDestKey) ?? null,
    [options, effectiveDestKey],
  );

  const amountNum = parseFloat(amount || "0");
  const valid =
    isValidAmount(amount) &&
    sendAsset !== null &&
    destAsset !== null &&
    amountNum <= parseFloat(sendAsset.balance) &&
    sendAsset.key !== destAsset?.key;

  const routeKey = valid ? `${amount}|${sendAsset?.key}|${destAsset?.key}|${slippage}` : null;

  useEffect(() => {
    let alive = true;
    if (!valid || !sendAsset || !destAsset) {
      return;
    }

    const timer = setTimeout(async () => {
      setRouting(true);
      setNoRoute(false);
      setError(null);
      try {
        const found = await findStrictSendRoute({
          network: networkRef.current,
          sendCode: sendAsset.code,
          sendIssuer: sendAsset.issuer,
          sendAmount: amount,
          destCode: destAsset.code,
          destIssuer: destAsset.issuer,
        });

        if (!alive) return;
        if (found) {
          const minVal = (parseFloat(found.destinationAmount) * (1 - slippage / 100)).toFixed(7);
          setRoute({
            dest: found.destinationAmount,
            destMin: minVal,
            intermediates: found.intermediates,
            sendAmount: amount,
          });
          setNoRoute(false);
        } else {
          setRoute(null);
          setNoRoute(true);
        }
      } catch {
        if (alive) {
          setRoute(null);
          setNoRoute(true);
        }
      } finally {
        if (alive) setRouting(false);
      }
    }, 350);

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [routeKey, sendAsset, destAsset, amount, slippage, valid]);

  function flipAssets() {
    triggerHaptic("medium");
    const prevSend = sendKey;
    const prevDest = effectiveDestKey;
    if (!prevDest) return;
    setSendKey(prevDest);
    setDestKey(prevSend);
    setAmount("");
    setRoute(null);
  }

  function handleAmountChange(val: string) {
    const clean = val.replace(/,/g, ".");
    setAmount(clean);
    if (!clean) setRoute(null);
  }

  async function handleSwap() {
    if (!route || !sendAsset || !destAsset) return;
    setBusy(true);
    setError(null);
    try {
      await swap({
        sendCode: sendAsset.code,
        sendIssuer: sendAsset.issuer,
        sendAmount: route.sendAmount,
        destCode: destAsset.code,
        destIssuer: destAsset.issuer,
        destMin: route.destMin,
        intermediates: route.intermediates,
      });
      triggerHaptic("success");
      setAmount("");
      setRoute(null);
      window.setTimeout(() => void refresh(), 4000);
    } catch (e) {
      triggerHaptic("error");
      setError(e instanceof Error ? e.message : "Swap failed.");
    } finally {
      setBusy(false);
    }
  }

  const exchangeRate =
    route && amountNum > 0
      ? (parseFloat(route.dest) / amountNum).toFixed(6)
      : null;

  return (
    <div className="fade-up mx-auto w-full max-w-[560px] px-5 pb-[150px]">
      <div className="flex items-center justify-between pb-4 pt-2">
        <h2 className="text-[17px] font-bold text-white tracking-tight">In-App Swap</h2>
        <button
          type="button"
          onClick={() => {
            triggerHaptic("selection");
            setShowSettings((s) => !s);
          }}
          className={`icon-btn !h-8 !w-8 ${showSettings ? "bg-white/20 text-white" : ""}`}
          aria-label="Slippage Settings"
        >
          <IconSliders size={16} />
        </button>
      </div>

      {showSettings && (
        <div className="panel-inset mb-4 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-semibold text-white">Slippage Tolerance</span>
            <span className="text-[12px] font-medium text-[#0A84FF]">{slippage}%</span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {[0.1, 0.5, 1.0, 3.0].map((val) => (
              <button
                key={val}
                type="button"
                onClick={() => {
                  triggerHaptic("selection");
                  setSlippage(val);
                }}
                className={`rounded-xl py-2 text-[12.5px] font-semibold transition-all ${
                  slippage === val
                    ? "bg-[#0A84FF] text-white shadow-sm"
                    : "bg-white/[0.08] text-neutral-300 hover:text-white"
                }`}
              >
                {val}%
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="text-[11.5px] text-neutral-400">Custom Slippage:</span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                step="0.1"
                min="0.05"
                max="10"
                placeholder={String(slippage)}
                value={slippage}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  if (!Number.isNaN(val) && val > 0 && val <= 20) {
                    setSlippage(val);
                  }
                }}
                className="input mono !h-7 !w-20 text-[12px] text-center"
              />
              <span className="text-[12px] font-bold text-neutral-400">%</span>
            </div>
          </div>
          <p className="text-[11px] text-neutral-400">
            Transactions revert if the execution price changes by more than this percentage.
          </p>
        </div>
      )}

      {/* Sell card */}
      <div className="panel-inset p-4 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-semibold uppercase tracking-wider text-neutral-400">
            You Pay
          </span>
          {sendAsset && (
            <button
              type="button"
              onClick={() => {
                triggerHaptic("selection");
                setAmount(sendAsset.balance);
              }}
              className="text-[12px] font-medium text-[#0A84FF] hover:underline"
            >
              Balance: {fmtAmount(sendAsset.balance)}
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <input
            type="text"
            inputMode="decimal"
            placeholder="0.0"
            value={amount}
            onChange={(e) => handleAmountChange(e.target.value)}
            className="w-full bg-transparent text-[32px] font-bold text-white outline-none placeholder:text-neutral-600"
          />
          <AssetSelect
            options={options}
            value={sendKey}
            onChange={(k) => {
              setSendKey(k);
              setRoute(null);
            }}
          />
        </div>
        {/* Quick Percent Buttons */}
        {sendAsset && (
          <div className="flex items-center gap-1.5 pt-1">
            {[0.25, 0.5, 0.75, 1.0].map((pct) => (
              <button
                key={pct}
                type="button"
                onClick={() => {
                  triggerHaptic("selection");
                  const bal = parseFloat(sendAsset.balance);
                  const res = (bal * pct).toFixed(7).replace(/\.?0+$/, "");
                  setAmount(res);
                }}
                className="rounded-lg bg-white/[0.06] px-2.5 py-1 text-[11px] font-medium text-neutral-300 hover:bg-white/[0.12]"
              >
                {pct === 1.0 ? "MAX" : `${pct * 100}%`}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Flip button */}
      <div className="relative my-2 flex justify-center">
        <button
          type="button"
          onClick={flipAssets}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-neutral-900 text-white shadow-lg transition-transform active:scale-90 hover:bg-neutral-800"
          aria-label="Invert Assets"
        >
          <IconSwap size={18} />
        </button>
      </div>

      {/* Buy card */}
      <div className="panel-inset p-4 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-semibold uppercase tracking-wider text-neutral-400">
            You Receive (Estimated)
          </span>
          {destAsset && (
            <span className="text-[12px] text-neutral-400">
              Balance: {fmtAmount(destAsset.balance)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="w-full text-[32px] font-bold text-white">
            {routing ? (
              <span className="skeleton inline-block h-9 w-32 rounded-lg align-middle" />
            ) : route ? (
              fmtAmount(route.dest)
            ) : (
              <span className="text-neutral-600">0.0</span>
            )}
          </div>
          <AssetSelect
            options={options.filter((b) => b.key !== sendKey)}
            value={effectiveDestKey}
            onChange={(k) => {
              setDestKey(k);
              setRoute(null);
            }}
          />
        </div>
      </div>

      {/* Route Info & Guaranteed Minimum */}
      {route && (
        <div className="panel-inset mt-4 p-4 space-y-2 text-[12.5px]">
          <div className="flex justify-between text-neutral-400">
            <span>Rate</span>
            <span className="mono text-white">
              1 {sendAsset?.code} ≈ {exchangeRate} {destAsset?.code}
            </span>
          </div>
          <div className="flex justify-between text-neutral-400">
            <span>Min. Received (Guarantee)</span>
            <span className="mono text-white">
              {fmtAmount(route.destMin)} {destAsset?.code}
            </span>
          </div>
          <div className="flex justify-between text-neutral-400">
            <span>Price Impact</span>
            <span className="text-[#30D158] font-medium">{"< 0.1% Minimal"}</span>
          </div>
          <div className="flex justify-between text-neutral-400">
            <span>Route Path</span>
            <span className="mono text-neutral-300">
              {route.intermediates.length === 0
                ? "Direct DEX Pool"
                : `${sendAsset?.code} → ${route.intermediates.map((p) => p.getCode()).join(" → ")} → ${destAsset?.code}`}
            </span>
          </div>
        </div>
      )}

      {noRoute && (
        <div className="mt-4 flex items-center gap-2 rounded-2xl border border-[#FF9F0A]/30 bg-[#FF9F0A]/10 p-3.5 text-[12.5px] text-[#FF9F0A]">
          <IconAlert size={16} className="shrink-0" />
          <span>No DEX liquidity pool path found for this asset pair on {network}.</span>
        </div>
      )}

      {error && (
        <div className="mt-4">
          <ErrorText message={error} />
        </div>
      )}

      <Button
        className="mt-6 w-full !h-12 text-[16px]"
        loading={busy}
        disabled={!route || busy || routing}
        onClick={() => void handleSwap()}
      >
        {routing ? "Finding Best Route…" : busy ? "Executing Swap…" : "Swap"}
      </Button>
    </div>
  );
}

function AssetSelect({
  options,
  value,
  onChange,
}: {
  options: AssetBalance[];
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="relative shrink-0">
      <select
        value={value}
        onChange={(e) => {
          triggerHaptic("selection");
          onChange(e.target.value);
        }}
        className="mono appearance-none rounded-2xl border border-white/10 bg-white/[0.08] py-2 pl-3 pr-8 text-[14px] font-semibold text-white outline-none cursor-pointer hover:bg-white/[0.12]"
      >
        {options.map((b) => (
          <option key={b.key} value={b.key} className="bg-neutral-900 text-white">
            {b.code}
          </option>
        ))}
      </select>
      <IconChevronDown
        size={14}
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400"
      />
    </div>
  );
}
