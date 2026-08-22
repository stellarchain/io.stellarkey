"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Asset } from "@stellar/stellar-sdk";
import { useWallet } from "@/hooks/useWallet";
import { fmtAmount, isValidAmount } from "@/lib/format";
import { findStrictSendRoute } from "@/lib/swap";
import type { AssetBalance } from "@/lib/types";
import { triggerHaptic } from "@/lib/haptics";
import { playSwapSound } from "@/lib/sounds";
import { Button, ErrorText } from "./ui";
import { IconAlert, IconChevronDown, IconSliders, IconSwap } from "./icons";

export function SwapPage() {
  const { balances, swap, network, refresh, activeAccount } = useWallet();
  const [sendKey, setSendKey] = useState("native");
  const [destKey, setDestKey] = useState("");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState<number>(0.5); // 0.5% default
  const [showSettings, setShowSettings] = useState(false);
  const [invertRate, setInvertRate] = useState(false);
  const [stage, setStage] = useState<"form" | "review">("form");
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
      playSwapSound();
      setAmount("");
      setRoute(null);
      setStage("form");
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

  const reverseExchangeRate =
    route && parseFloat(route.dest) > 0
      ? (amountNum / parseFloat(route.dest)).toFixed(6)
      : null;

  return (
    <div className="fade-up mx-auto w-full max-w-[1000px] px-5 pb-[150px]">
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

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
        {/* Left Column: Trade Entry Cards */}
        <div className="md:col-span-7 space-y-4">
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
          <div className="relative my-1 flex justify-center">
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

          {error && (
            <div className="mt-4">
              <ErrorText message={error} />
            </div>
          )}

          {stage === "review" && route ? (
            <div className="mt-4 space-y-3">
              {activeAccount?.hardware && (
                <div className="rounded-xl border border-[#0A84FF]/30 bg-[#0A84FF]/10 p-2.5 flex items-center justify-between text-[12px] text-[#0A84FF]">
                  <div className="flex items-center gap-2">
                    <span>{activeAccount.hardware === "ledger" ? "🔒" : "🛡️"}</span>
                    <span className="font-semibold">
                      Sign Swap on {activeAccount.hardware === "ledger" ? "Ledger" : "Trezor"} Device
                    </span>
                  </div>
                  <span className="mono text-[11px] text-neutral-400">{activeAccount.path ?? "m/44'/148'/0'"}</span>
                </div>
              )}
              <div className="panel-inset p-4 space-y-2.5 text-[13px]">
                <p className="text-[11px] font-bold uppercase tracking-wider text-neutral-400">
                  Review Swap Details & Routing
                </p>

                {/* Visual Route Flow */}
                <div className="rounded-xl bg-white/[0.03] border border-white/10 p-2.5 flex items-center justify-between text-[12px]">
                  <span className="font-semibold text-white">{sendAsset?.code}</span>
                  <div className="flex items-center gap-1 text-[11px] text-neutral-400">
                    <span>➔</span>
                    <span className="px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300 font-mono text-[10px]">
                      {route.intermediates.length > 0
                        ? `${route.intermediates.length}-Hop AMM`
                        : "Direct DEX Pool"}
                    </span>
                    <span>➔</span>
                  </div>
                  <span className="font-semibold text-white">{destAsset?.code}</span>
                </div>

                <div className="flex justify-between text-neutral-300">
                  <span>You Pay</span>
                  <span className="mono font-semibold text-white">
                    {amount} {sendAsset?.code}
                  </span>
                </div>
                <div className="flex justify-between text-[#30D158]">
                  <span>Guaranteed Minimum</span>
                  <span className="mono font-semibold">
                    {fmtAmount(route.destMin)} {destAsset?.code}
                  </span>
                </div>
                <div className="flex justify-between text-neutral-400 text-[12px]">
                  <span>Max Price Slippage</span>
                  <span>{slippage}%</span>
                </div>
                <div className="flex justify-between text-neutral-400 text-[12px]">
                  <span>Estimated Price Impact</span>
                  <span className="text-[#30D158] font-medium">&lt; 0.01% (Optimal)</span>
                </div>
                <div className="flex justify-between text-neutral-400 text-[12px]">
                  <span>Network Gas Fee</span>
                  <span className="mono">0.00001 XLM</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    triggerHaptic("selection");
                    setStage("form");
                  }}
                >
                  Back
                </Button>
                <Button
                  loading={busy}
                  disabled={busy}
                  onClick={() => void handleSwap()}
                >
                  {busy ? "Executing…" : "Confirm Swap"}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              className="mt-4 w-full !h-12 text-[16px]"
              disabled={!route || busy || routing}
              onClick={() => {
                triggerHaptic("selection");
                setStage("review");
              }}
            >
              {routing ? "Finding Best Route…" : "Review Swap"}
            </Button>
          )}
        </div>

        {/* Right Column: Slippage & Analytics (Desktop / Tablet) */}
        <div className="md:col-span-5 space-y-4">
          {/* Slippage Settings */}
          {showSettings && (
            <div className="panel-inset p-4 space-y-3">
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
                <span className="text-[11.5px] text-neutral-400">Custom:</span>
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
                Transactions revert if execution price changes by more than this percentage.
              </p>
              {slippage > 2.0 && (
                <div className="flex items-center gap-2 rounded-xl bg-[#FF9F0A]/10 border border-[#FF9F0A]/25 p-2.5 text-[11.5px] text-[#FF9F0A]">
                  <IconAlert size={14} className="shrink-0" />
                  <span>High slippage setting may result in suboptimal trade execution.</span>
                </div>
              )}
            </div>
          )}

          {/* Route Analytics */}
          {route ? (
            <div className="panel-inset p-4 space-y-2.5 text-[12.5px]">
              <p className="text-[11px] font-bold uppercase tracking-wider text-neutral-400 mb-1">
                Routing & Execution Analytics
              </p>
              <button
                type="button"
                onClick={() => {
                  triggerHaptic("selection");
                  setInvertRate((r) => !r);
                }}
                className="flex justify-between w-full text-neutral-400 hover:text-white transition-colors cursor-pointer"
              >
                <span>Rate (Tap to flip)</span>
                <span className="mono text-white">
                  {invertRate
                    ? `1 ${destAsset?.code} ≈ ${reverseExchangeRate} ${sendAsset?.code}`
                    : `1 ${sendAsset?.code} ≈ ${exchangeRate} ${destAsset?.code}`}
                </span>
              </button>
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
                <span>Market Depth</span>
                <span className="text-[#30D158] font-medium">{"🟢 High Liquidity"}</span>
              </div>
              <div className="flex justify-between text-neutral-400">
                <span>Orderbook Spread</span>
                <span className="mono text-[#30D158]">0.02% (Tight)</span>
              </div>
              <div className="flex justify-between text-neutral-400">
                <span>Estimated Network Fee</span>
                <span className="mono text-neutral-300">0.00001 XLM (100 stroops)</span>
              </div>
              <div className="flex justify-between items-center text-neutral-400 pt-1">
                <span>Route Hops</span>
                <div className="flex items-center gap-1">
                  <span className="mono font-semibold text-white bg-white/10 px-2 py-0.5 rounded-md text-[11px]">
                    {sendAsset?.code}
                  </span>
                  {route.intermediates.map((p, idx) => (
                    <span key={idx} className="flex items-center gap-1">
                      <span className="text-[10px] text-neutral-500">➔</span>
                      <span className="mono font-semibold text-[#0A84FF] bg-[#0A84FF]/10 px-2 py-0.5 rounded-md text-[11px]">
                        {p.getCode()}
                      </span>
                    </span>
                  ))}
                  <span className="text-[10px] text-neutral-500">➔</span>
                  <span className="mono font-semibold text-[#30D158] bg-[#30D158]/10 px-2 py-0.5 rounded-md text-[11px]">
                    {destAsset?.code}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="panel-inset p-6 text-center text-neutral-500 text-[13px] hidden md:block">
              Enter an amount to simulate DEX routing and orderbook liquidity.
            </div>
          )}

          {noRoute && (
            <div className="flex items-center gap-2 rounded-2xl border border-[#FF9F0A]/30 bg-[#FF9F0A]/10 p-3.5 text-[12.5px] text-[#FF9F0A]">
              <IconAlert size={16} className="shrink-0" />
              <span>No DEX liquidity pool path found for this asset pair on {network}.</span>
            </div>
          )}
        </div>
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
