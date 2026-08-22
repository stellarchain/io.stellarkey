"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import { fmtAmount, isValidAmount } from "@/lib/format";
import { findStrictSendRoute, type SwapRoute } from "@/lib/swap";
import type { AssetBalance } from "@/lib/types";
import { triggerHaptic } from "@/lib/haptics";
import { Button, ErrorText } from "./ui";
import { IconAlert, IconChevronDown, IconSliders, IconSwap } from "./icons";

export function SwapPage() {
  const { balances, swap, network } = useWallet();
  const [sendKey, setSendKey] = useState("native");
  const [destKey, setDestKey] = useState("");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState<number>(0.5); // 0.5% default
  const [showSettings, setShowSettings] = useState(false);
  const [route, setRoute] = useState<{
    dest: string;
    min: string;
    hops: number;
    raw: SwapRoute;
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
    if (!valid || !sendAsset || !destAsset || !routeKey) return;

    const timer = window.setTimeout(async () => {
      setRouting(true);
      setError(null);
      try {
        const res = await findStrictSendRoute({
          network: networkRef.current,
          sendCode: sendAsset.code,
          sendIssuer: sendAsset.issuer,
          sendAmount: amount,
          destCode: destAsset.code,
          destIssuer: destAsset.issuer,
        });
        if (!alive) return;
        if (!res) {
          setRoute(null);
          setNoRoute(true);
        } else {
          const destAmtNum = parseFloat(res.destinationAmount);
          const minNum = destAmtNum * (1 - slippage / 100);
          setRoute({
            dest: res.destinationAmount,
            min: minNum.toFixed(7),
            hops: res.intermediates.length,
            raw: res,
          });
          setNoRoute(false);
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
      window.clearTimeout(timer);
    };
  }, [routeKey, sendAsset, destAsset, amount, slippage, valid]);

  function flipAssets() {
    triggerHaptic("selection");
    const prevSend = sendKey;
    const prevDest = effectiveDestKey;
    if (prevDest) {
      setSendKey(prevDest);
      setDestKey(prevSend);
      setAmount("");
      setRoute(null);
      setNoRoute(false);
    }
  }

  function handleAmountChange(val: string) {
    const cleaned = val.replace(/[^0-9.]/g, "");
    setAmount(cleaned);
    if (!cleaned) {
      setRoute(null);
      setNoRoute(false);
    }
  }

  async function handleSwap() {
    if (!sendAsset || !destAsset || !route) return;
    setBusy(true);
    setError(null);
    try {
      await swap({
        sendCode: sendAsset.code,
        sendIssuer: sendAsset.issuer,
        sendAmount: amount,
        destCode: destAsset.code,
        destIssuer: destAsset.issuer,
        destMin: route.min,
        intermediates: route.raw.intermediates,
      });
      triggerHaptic("success");
      setAmount("");
      setRoute(null);
    } catch (e) {
      triggerHaptic("error");
      setError(e instanceof Error ? e.message : "Swap execution failed.");
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
      <div className="flex items-center justify-between py-2">
        <h1 className="text-[22px] font-semibold tracking-tight text-white">In-App Swap</h1>
        <button
          type="button"
          onClick={() => {
            triggerHaptic("selection");
            setShowSettings((v) => !v);
          }}
          className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
            showSettings ? "bg-white/20 text-white" : "bg-white/[0.08] text-neutral-400 hover:text-white"
          }`}
          aria-label="Slippage Settings"
        >
          <IconSliders size={15} />
        </button>
      </div>

      {/* Slippage Settings Card */}
      {showSettings && (
        <div className="fade-in mb-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-md">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[13px] font-semibold text-white">Slippage Tolerance</span>
            <span className="mono text-[12px] text-[#0A84FF]">{slippage}%</span>
          </div>
          <div className="flex items-center gap-2">
            {[0.1, 0.5, 1.0, 3.0].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  triggerHaptic("selection");
                  setSlippage(s);
                }}
                className={`flex-1 rounded-xl py-1.5 text-center text-[12px] font-semibold transition-all ${
                  slippage === s
                    ? "bg-[#0A84FF] text-white shadow-md"
                    : "bg-white/10 text-neutral-300 hover:bg-white/15"
                }`}
              >
                {s}%
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Swap Box */}
      <div className="relative mt-2 space-y-2">
        {/* Source Card */}
        <div className="panel p-4">
          <div className="flex items-center justify-between text-[12px] text-neutral-400">
            <span>You Pay</span>
            {sendAsset && (
              <div className="flex items-center gap-1.5">
                <span className="mono text-[11px]">
                  Bal: {fmtAmount(sendAsset.balance)}
                </span>
                {[0.5, 1].map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => {
                      triggerHaptic("selection");
                      handleAmountChange(
                        (
                          parseFloat(sendAsset.balance) * f -
                          (sendAsset.isNative && f === 1 ? 1 : 0)
                        )
                          .toFixed(7)
                          .replace(/\.?0+$/, ""),
                      );
                    }}
                    className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-300 hover:bg-white/20 hover:text-white"
                  >
                    {f === 1 ? "Max" : "50%"}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="mt-3 flex items-center justify-between gap-3">
            <input
              className="mono w-full border-none bg-transparent text-[32px] font-light text-white outline-none placeholder:text-neutral-600"
              placeholder="0.0"
              inputMode="decimal"
              value={amount}
              onChange={(e) => handleAmountChange(e.target.value)}
            />
            <AssetSelect
              options={options}
              value={sendKey}
              onChange={(k) => {
                setSendKey(k);
                setRoute(null);
                setNoRoute(false);
              }}
            />
          </div>
        </div>

        {/* Flip Button */}
        <div className="absolute left-1/2 top-[47%] -translate-x-1/2 -translate-y-1/2 z-10">
          <button
            type="button"
            onClick={flipAssets}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-neutral-900 shadow-xl transition-transform active:rotate-180 hover:bg-neutral-800 text-white"
            aria-label="Flip Assets"
          >
            <IconSwap size={18} />
          </button>
        </div>

        {/* Destination Card */}
        <div className="panel p-4">
          <div className="flex items-center justify-between text-[12px] text-neutral-400">
            <span>You Receive (Estimated)</span>
            {destAsset && (
              <span className="mono text-[11px]">
                Bal: {fmtAmount(destAsset.balance)}
              </span>
            )}
          </div>

          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="mono text-[32px] font-light text-white truncate min-h-[48px] flex items-center">
              {routing ? (
                <span className="text-neutral-500 text-[20px] animate-pulse">Finding best DEX path…</span>
              ) : route ? (
                fmtAmount(route.dest)
              ) : (
                <span className="text-neutral-600">0.0</span>
              )}
            </div>
            <AssetSelect
              options={options}
              value={effectiveDestKey}
              onChange={(k) => {
                setDestKey(k);
                setRoute(null);
                setNoRoute(false);
              }}
            />
          </div>
        </div>
      </div>

      {/* Route & Orderbook Details */}
      {route && sendAsset && destAsset && (
        <div className="fade-in mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-2.5 backdrop-blur-md">
          {exchangeRate && (
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-neutral-400">Exchange Rate</span>
              <span className="mono text-white font-medium">
                1 {sendAsset.code} ≈ {exchangeRate} {destAsset.code}
              </span>
            </div>
          )}
          <div className="flex items-center justify-between text-[12px]">
            <span className="text-neutral-400">Guaranteed Minimum</span>
            <span className="mono text-neutral-200">
              {fmtAmount(route.min)} {destAsset.code}
            </span>
          </div>
          <div className="flex items-center justify-between text-[12px]">
            <span className="text-neutral-400">DEX Routing</span>
            <span className="mono text-[11px] text-[#30D158] font-medium">
              {route.hops === 0
                ? "Direct Orderbook"
                : `${route.hops} intermediate hop${route.hops > 1 ? "s" : ""}`}
            </span>
          </div>
        </div>
      )}

      {noRoute && (
        <div className="mt-4 flex items-center gap-2 rounded-2xl border border-[#FF9F0A]/30 bg-[#FF9F0A]/10 p-3.5 text-[12px] text-[#FF9F0A]">
          <IconAlert size={16} className="shrink-0" />
          <span>No DEX orderbook liquidity found for this asset pair and amount.</span>
        </div>
      )}

      <div className="mt-4">
        <ErrorText message={error ?? ""} />
      </div>

      <div className="mt-6">
        <Button
          className="w-full !py-3.5 text-[16px] font-semibold"
          disabled={!valid || !route || busy || routing}
          loading={busy}
          onClick={() => void handleSwap()}
        >
          {routing ? "Checking Rates…" : busy ? "Executing Swap…" : "Confirm Swap"}
        </Button>
      </div>
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
  onChange: (val: string) => void;
}) {
  return (
    <div className="relative shrink-0">
      <select
        className="input !w-auto appearance-none py-2 pl-3.5 pr-8 text-[14px] font-semibold bg-white/10 border-white/10 hover:border-white/20"
        value={value}
        onChange={(e) => {
          triggerHaptic("selection");
          onChange(e.target.value);
        }}
        aria-label="Select Asset"
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
