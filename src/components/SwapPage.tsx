"use client";

import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import { fmtAmount, isValidAmount } from "@/lib/format";
import { formatTrezorAddress } from "@/lib/address-display";
import { findStrictSendRoute } from "@/lib/swap";
import { networkFeeXlm } from "@/lib/api";
import {
  applySlippage,
  compareStellarAmounts,
  fractionOfStellarAmount,
} from "@/lib/stellar-domain";
import type { AssetBalance } from "@/lib/types";
import {
  bindSwapQuote,
  guardCurrentSwapQuote,
  spendableAssetBalance,
  swapRequestKey,
  type BoundSwapQuote,
} from "@/lib/transaction-intent";
import { triggerHaptic } from "@/lib/haptics";
import { playSwapSound } from "@/lib/sounds";
import type { SubmissionResult } from "@/lib/submission";
import { Button, ErrorText, HashValue, Select } from "./ui";
import { IconAlert, IconLedger, IconSliders, IconSwap, IconTrezor } from "./icons";

export function SwapPage() {
  const { balances, minimumBalanceXlm, recommendedBaseFeeStroops, swap, network, refresh, activeAccount, submissionStatus } = useWallet();
  const [sendKey, setSendKey] = useState("native");
  const [destKey, setDestKey] = useState("");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState<number>(0.5); // 0.5% default
  const [showSettings, setShowSettings] = useState(false);
  const [invertRate, setInvertRate] = useState(false);
  const [stage, setStage] = useState<"form" | "review">("form");
  const [route, setRoute] = useState<BoundSwapQuote | null>(null);
  const [routingKey, setRoutingKey] = useState<string | null>(null);
  const [noRouteKey, setNoRouteKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingSubmission, setPendingSubmission] = useState<SubmissionResult | null>(null);
  const trackedSubmissionStatus = pendingSubmission ? submissionStatus(pendingSubmission) : null;
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

  const feeXlm = networkFeeXlm(recommendedBaseFeeStroops, 1);
  const sendAvailable = sendAsset?.isNative
    ? minimumBalanceXlm === null
      ? "0"
      : spendableAssetBalance(sendAsset, [minimumBalanceXlm, feeXlm])
    : sendAsset
      ? spendableAssetBalance(sendAsset)
      : "0";
  const valid =
    isValidAmount(amount) &&
    sendAsset !== null &&
    destAsset !== null &&
    compareStellarAmounts(amount, sendAvailable) <= 0 &&
    sendAsset.key !== destAsset?.key;

  const routeKey =
    valid && sendAsset && destAsset
      ? swapRequestKey({
          network,
          sendAssetKey: sendAsset.key,
          destinationAssetKey: destAsset.key,
          sendAmount: amount,
          slippage: String(slippage),
        })
      : null;
  const currentQuote = guardCurrentSwapQuote(route, routeKey);
  const routing = routeKey !== null && routingKey === routeKey;
  const noRoute = routeKey !== null && noRouteKey === routeKey;

  useEffect(() => {
    let alive = true;
    void (async () => {
      await Promise.resolve();
      if (!alive) return;
      if (trackedSubmissionStatus === "confirmed") {
        triggerHaptic("success");
        playSwapSound();
        setAmount("");
        setRoute(null);
        setStage("form");
        void refresh();
        return;
      }
      if (trackedSubmissionStatus === "failed") {
        setPendingSubmission(null);
        setError("Swap failed on-chain. Refresh the quote and retry when ready.");
        triggerHaptic("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, [refresh, trackedSubmissionStatus]);

  useEffect(() => {
    let alive = true;
    if (!valid || !sendAsset || !destAsset || !routeKey) {
      return;
    }

    const quotedRequestKey = routeKey;
    const quotedSendAmount = amount;
    const quotedSlippage = String(slippage);
    const quotedSendAssetKey = sendAsset.key;
    const quotedDestinationAssetKey = destAsset.key;

    const timer = setTimeout(async () => {
      setRoutingKey(quotedRequestKey);
      setNoRouteKey(null);
      setError(null);
      try {
        const found = await findStrictSendRoute({
          network,
          sendCode: sendAsset.code,
          sendIssuer: sendAsset.issuer,
          sendAmount: quotedSendAmount,
          destCode: destAsset.code,
          destIssuer: destAsset.issuer,
        });

        if (!alive) return;
        if (found) {
          const minVal = applySlippage(found.destinationAmount, quotedSlippage);
          setRoute(bindSwapQuote({
            requestKey: quotedRequestKey,
            sendAssetKey: quotedSendAssetKey,
            destinationAssetKey: quotedDestinationAssetKey,
            destinationAmount: found.destinationAmount,
            destinationMinimum: minVal,
            intermediates: found.intermediates,
            sendAmount: quotedSendAmount,
            slippage: quotedSlippage,
          }));
          setNoRouteKey(null);
        } else {
          setRoute(null);
          setNoRouteKey(quotedRequestKey);
        }
      } catch (cause) {
        if (alive) {
          setRoute(null);
          setNoRouteKey(null);
          setError(cause instanceof Error ? cause.message : "Unable to query Stellar DEX routes.");
        }
      } finally {
        if (alive) setRoutingKey(null);
      }
    }, 350);

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [routeKey, sendAsset, destAsset, amount, slippage, valid, network]);

  function flipAssets() {
    triggerHaptic("medium");
    const prevSend = sendKey;
    const prevDest = effectiveDestKey;
    if (!prevDest) return;
    setSendKey(prevDest);
    setDestKey(prevSend);
    setAmount("");
    setRoute(null);
    setError(null);
  }

  function handleAmountChange(val: string) {
    const clean = val.replace(/,/g, ".");
    setAmount(clean);
    setRoute(null);
    setError(null);
  }

  async function handleSwap() {
    if (pendingSubmission) return;
    const submissionQuote = guardCurrentSwapQuote(route, routeKey);
    if (!submissionQuote || !sendAsset || !destAsset) return;
    setBusy(true);
    setError(null);
    try {
      const result = await swap({
        sendCode: sendAsset.code,
        sendIssuer: sendAsset.issuer,
        sendAmount: submissionQuote.sendAmount,
        destCode: destAsset.code,
        destIssuer: destAsset.issuer,
        destMin: submissionQuote.destinationMinimum,
        intermediates: [...submissionQuote.intermediates],
      });
      setPendingSubmission(result);
      triggerHaptic(result.status === "status_unknown" ? "warning" : "medium");
    } catch (e) {
      triggerHaptic("error");
      setError(e instanceof Error ? e.message : "Swap failed.");
    } finally {
      setBusy(false);
    }
  }

  const quotedSendAmountNum = parseFloat(currentQuote?.sendAmount ?? "0");
  const exchangeRate =
    currentQuote && quotedSendAmountNum > 0
      ? (parseFloat(currentQuote.destinationAmount) / quotedSendAmountNum).toFixed(6)
      : null;

  const reverseExchangeRate =
    currentQuote && parseFloat(currentQuote.destinationAmount) > 0
      ? (quotedSendAmountNum / parseFloat(currentQuote.destinationAmount)).toFixed(6)
      : null;

  return (
    <div className="fade-up mx-auto w-full max-w-[520px] px-5 pb-[150px]">
      {/* Slim toolbar — the page title lives in the app chrome */}
      <div className="flex items-center justify-end pb-3 pt-2">
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

      {/* Slippage Settings (toggled by the toolbar gear) */}
      {showSettings && (
        <div className="panel-inset p-4 space-y-3 mb-3">
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
                  setRoute(null);
                  setError(null);
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
                    setRoute(null);
                    setError(null);
                  }
                }}
                className="input mono !h-11 !w-20 text-center text-base md:!h-7 sm:text-[12px]"
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

      {/* Centered trade stack */}
      <div className="space-y-3">
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
                    setAmount(sendAvailable);
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
                  setError(null);
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
                      setAmount(fractionOfStellarAmount(sendAvailable, Math.round(pct * 100), 100));
                    }}
                    className="rounded-lg bg-white/[0.06] px-2.5 py-1 text-[11px] font-medium text-neutral-300 hover:bg-white/[0.12]"
                  >
                    {pct === 1.0 ? "MAX" : `${pct * 100}%`}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Flip button — notched into the card seam */}
          <div className="relative z-10 -my-2.5 flex justify-center">
            <button
              type="button"
              onClick={flipAssets}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-neutral-900 text-white shadow-lg ring-4 ring-black transition-all duration-200 hover:bg-neutral-800 active:scale-90"
              aria-label="Invert Assets"
            >
              <IconSwap size={18} className="rotate-90" />
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
                ) : currentQuote ? (
                  fmtAmount(currentQuote.destinationAmount)
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
                  setError(null);
                }}
              />
            </div>
          </div>

          {error && <ErrorText message={error} />}
          {pendingSubmission && (
            <div className={`rounded-2xl border p-4 ${
              trackedSubmissionStatus === "status_unknown"
                ? "border-[#FF9F0A]/35 bg-[#FF9F0A]/10"
                : trackedSubmissionStatus === "confirmed"
                  ? "border-[#30D158]/30 bg-[#30D158]/10"
                  : "border-[#0A84FF]/30 bg-[#0A84FF]/10"
            }`}>
              <p className={`flex items-center gap-2 text-[13px] font-semibold ${
                trackedSubmissionStatus === "status_unknown"
                  ? "text-[#FF9F0A]"
                  : trackedSubmissionStatus === "confirmed"
                    ? "text-[#30D158]"
                    : "text-[#0A84FF]"
              }`}>
                {trackedSubmissionStatus === "status_unknown" && <IconAlert size={15} />}
                {trackedSubmissionStatus === "status_unknown"
                  ? "Swap submission status unknown"
                  : trackedSubmissionStatus === "confirmed"
                    ? "Swap confirmed"
                    : "Swap accepted — confirming"}
              </p>
              <p className="mt-1.5 text-[12px] leading-relaxed text-neutral-300">
                {trackedSubmissionStatus === "status_unknown"
                  ? "Horizon did not confirm acceptance. Do not resubmit blindly; the wallet is polling the canonical hash."
                  : trackedSubmissionStatus === "confirmed"
                    ? "The swap is confirmed on-chain."
                    : "Horizon accepted the swap and confirmation tracking continues."}
              </p>
              <p className="mt-2 break-all font-mono text-[10px] text-neutral-400">
                {pendingSubmission.network} · {pendingSubmission.hash}
              </p>
              {trackedSubmissionStatus === "confirmed" && (
                <Button
                  variant="ghost"
                  className="mt-3 w-full"
                  onClick={() => setPendingSubmission(null)}
                >
                  Start Another Swap
                </Button>
              )}
            </div>
          )}

          {/* Route Analytics — inline once a route is found */}
          {currentQuote && (
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
                  {fmtAmount(currentQuote.destinationMinimum)} {destAsset?.code}
                </span>
              </div>
              <div className="flex justify-between text-neutral-400">
                <span>Quote Source</span>
                <span className="font-medium text-neutral-200">Horizon strict-send path</span>
              </div>
              <div className="flex justify-between text-neutral-400">
                <span>Estimated Network Fee</span>
                <span className="mono text-neutral-300">{feeXlm} XLM</span>
              </div>
              <div className="flex justify-between items-center text-neutral-400 pt-1">
                <span>Route Hops</span>
                <div className="flex items-center gap-1">
                  <span className="mono font-semibold text-white bg-white/10 px-2 py-0.5 rounded-md text-[11px]">
                    {sendAsset?.code}
                  </span>
                  {currentQuote.intermediates.map((p, idx) => (
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
          )}

          {noRoute && (
            <div className="flex items-center gap-2 rounded-2xl border border-[#FF9F0A]/30 bg-[#FF9F0A]/10 p-3.5 text-[12.5px] text-[#FF9F0A]">
              <IconAlert size={16} className="shrink-0" />
              <span>No DEX liquidity pool path found for this asset pair on {network}.</span>
            </div>
          )}

          {stage === "review" && currentQuote && sendAsset && destAsset ? (
            <div className="space-y-3">
              {activeAccount?.hardware && (
                <div className="rounded-xl border border-[#0A84FF]/30 bg-[#0A84FF]/10 p-2.5 flex items-center justify-between text-[12px] text-[#0A84FF]">
                  <div className="flex items-center gap-2">
                    {activeAccount.hardware === "ledger" ? (
                      <IconLedger size={15} className="text-[#64D2FF]" />
                    ) : (
                      <IconTrezor size={15} className="text-emerald-400" />
                    )}
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
                      {currentQuote.intermediates.length > 0
                        ? `${currentQuote.intermediates.length} intermediate${currentQuote.intermediates.length > 1 ? "s" : ""}`
                        : "Direct path"}
                    </span>
                    <span>➔</span>
                  </div>
                  <span className="font-semibold text-white">{destAsset?.code}</span>
                </div>

                <div className="flex justify-between text-neutral-300">
                  <span>You Pay</span>
                  <span className="mono font-semibold text-white">
                    {currentQuote.sendAmount} {sendAsset?.code}
                  </span>
                </div>
                <div className="flex justify-between text-[#30D158]">
                  <span>Guaranteed Minimum</span>
                  <span className="mono font-semibold">
                    {fmtAmount(currentQuote.destinationMinimum)} {destAsset?.code}
                  </span>
                </div>
                {!sendAsset.isNative && sendAsset.issuer && (
                  <div className="flex items-start justify-between gap-4 text-neutral-400 text-[12px]">
                    <span className="shrink-0">Pay Asset Issuer</span>
                    <HashValue
                      full
                      value={sendAsset.issuer}
                      className="justify-end text-right text-[11.5px] text-neutral-300"
                    />
                  </div>
                )}
                {!destAsset.isNative && destAsset.issuer && (
                  <div className="flex items-start justify-between gap-4 text-neutral-400 text-[12px]">
                    <span className="shrink-0">Receive Asset Issuer</span>
                    <HashValue
                      full
                      value={destAsset.issuer}
                      className="justify-end text-right text-[11.5px] text-neutral-300"
                    />
                  </div>
                )}
                <div className="flex justify-between text-neutral-400 text-[12px]">
                  <span>Max Price Slippage</span>
                  <span>{currentQuote.slippage}%</span>
                </div>
                <div className="flex justify-between text-neutral-400 text-[12px]">
                  <span>Base Network Fee</span>
                  <span className="mono">{feeXlm} XLM</span>
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
                  disabled={busy || Boolean(pendingSubmission)}
                  onClick={() => void handleSwap()}
                >
                  {busy ? "Executing…" : "Confirm Swap"}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              className="!mt-6 w-full !h-12 text-[16px]"
              disabled={!currentQuote || busy || routing || Boolean(pendingSubmission)}
              onClick={() => {
                const reviewQuote = guardCurrentSwapQuote(route, routeKey);
                if (!reviewQuote) return;
                triggerHaptic("selection");
                setStage("review");
              }}
            >
              {routing ? "Finding Best Route…" : "Review Swap"}
            </Button>
          )}
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
    <Select
      size="sm"
      value={value}
      onChange={onChange}
      ariaLabel="Asset"
      preserveOptionLabels
      panelMinWidth={280}
      className="mono !rounded-2xl !py-2 !pl-3 !pr-2 text-[14px]"
      options={options.map((b) => ({
        value: b.key,
        label: b.code,
        sublabel: b.isNative
          ? `${fmtAmount(b.balance)} · Native`
          : `${fmtAmount(b.balance)} · ${formatTrezorAddress(b.issuer ?? "Unknown issuer")}`,
      }))}
    />
  );
}
