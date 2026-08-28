"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  useWalletIdentity,
  useWalletLedger,
  useWalletSubmission,
  useWalletTransactions,
} from "@/hooks/useWallet";
import { fmtAmount, isValidAmount, normalizeAmount } from "@/lib/format";
import { formatTrezorAddress } from "@/lib/address-display";
import { findStrictReceiveRoute, findStrictSendRoute } from "@/lib/swap";
import { networkFeeXlm } from "@/lib/api";
import {
  applySlippage,
  applySlippageCeiling,
  compareStellarAmounts,
  fractionOfStellarAmount,
} from "@/lib/stellar-domain";
import type { AssetBalance } from "@/lib/types";
import {
  bindSwapQuote,
  guardCurrentSwapQuote,
  spendableAssetBalance,
  swapReceiptAssetIdentity,
  swapRequestKey,
  type BoundSwapQuote,
  type SwapReceiptAssetIdentity,
  type SwapExecutionMode,
} from "@/lib/transaction-intent";
import { triggerHaptic } from "@/lib/haptics";
import { playSwapSound } from "@/lib/sounds";
import type { SubmissionLifecycleStatus, SubmissionResult } from "@/lib/submission";
import { assetKey as merchantAssetKey } from "@/lib/merchant/charge";
import type { SettlementSwapIntent } from "@/lib/merchant/settlement";
import { Button, ErrorText, HashValue, NetworkBadge, Select, Spinner } from "./ui";
import {
  IconAlert,
  IconCheck,
  IconLedger,
  IconSliders,
  IconSwap,
  IconTrezor,
} from "./icons";

interface SubmittedSwap {
  readonly quote: BoundSwapQuote;
  readonly sendAsset: SwapReceiptAssetIdentity;
  readonly destinationAsset: SwapReceiptAssetIdentity;
  readonly submission: Readonly<SubmissionResult>;
}

interface SwapPageProps {
  prefill?: SettlementSwapIntent | null;
  onDone?: () => void;
  onViewActivity?: () => void;
}

export function SwapPage({
  prefill = null,
  onDone,
  onViewActivity,
}: SwapPageProps) {
  const { network, activeAccount } = useWalletIdentity();
  const { balances, minimumBalanceXlm, recommendedBaseFeeStroops } = useWalletLedger();
  const { submissionStatus } = useWalletSubmission();
  const { swap, refresh } = useWalletTransactions();
  const [sendKey, setSendKey] = useState(() =>
    prefill ? merchantAssetKey(prefill.sourceAsset) : "native",
  );
  const [destKey, setDestKey] = useState(() =>
    prefill ? merchantAssetKey(prefill.destinationAsset) : "",
  );
  const [payAmount, setPayAmount] = useState(prefill?.amount ?? "");
  const [receiveAmount, setReceiveAmount] = useState("");
  const [amountSide, setAmountSide] = useState<"pay" | "receive">("pay");
  const [slippage, setSlippage] = useState<number>(
    prefill ? prefill.maxSlippageBps / 100 : 0.5,
  );
  const [showSettings, setShowSettings] = useState(false);
  const [invertRate, setInvertRate] = useState(false);
  const [stage, setStage] = useState<"form" | "review" | "status" | "success">("form");
  const [route, setRoute] = useState<BoundSwapQuote | null>(null);
  const [routingKey, setRoutingKey] = useState<string | null>(null);
  const [noRouteKey, setNoRouteKey] = useState<string | null>(null);
  const [quoteAttempt, setQuoteAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingSubmission, setPendingSubmission] = useState<SubmissionResult | null>(null);
  const [submittedSwap, setSubmittedSwap] = useState<SubmittedSwap | null>(null);
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
  const quoteMode: SwapExecutionMode = amountSide === "pay" ? "strict-send" : "strict-receive";
  const exactAmount = amountSide === "pay" ? payAmount : receiveAmount;
  const valid =
    isValidAmount(exactAmount) &&
    sendAsset !== null &&
    destAsset !== null &&
    (quoteMode === "strict-receive" || compareStellarAmounts(exactAmount, sendAvailable) <= 0) &&
    sendAsset.key !== destAsset?.key &&
    (!prefill ||
      (prefill.network === network && prefill.sourceAccount === activeAccount?.publicKey));

  const routeKey =
    valid && sendAsset && destAsset
      ? swapRequestKey({
          network,
          sendAssetKey: sendAsset.key,
          destinationAssetKey: destAsset.key,
          mode: quoteMode,
          exactAmount,
          slippage: String(slippage),
        })
      : null;
  const currentQuote = guardCurrentSwapQuote(route, routeKey);
  const routing = routeKey !== null && routingKey === routeKey;
  const noRoute = routeKey !== null && noRouteKey === routeKey;
  const quotedSpendLimit = currentQuote?.mode === "strict-receive"
    ? currentQuote.sendMaximum
    : currentQuote?.sendAmount ?? null;
  const quoteExceedsBalance = quotedSpendLimit !== null
    && compareStellarAmounts(quotedSpendLimit, sendAvailable) > 0;

  useEffect(() => {
    let alive = true;
    void (async () => {
      await Promise.resolve();
      if (!alive) return;
      if (trackedSubmissionStatus === "confirmed") {
        triggerHaptic("success");
        playSwapSound();
        setStage("success");
        void refresh();
        return;
      }
      if (trackedSubmissionStatus === "failed") {
        setPendingSubmission(null);
        setSubmittedSwap(null);
        setRoute(null);
        setNoRouteKey(null);
        setQuoteAttempt((attempt) => attempt + 1);
        setStage("form");
        setError("Swap failed on-chain. The wallet is refreshing the quote before you retry.");
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
    const quotedMode = quoteMode;
    const quotedExactAmount = exactAmount;
    const quotedSlippage = String(slippage);
    const quotedSendAssetKey = sendAsset.key;
    const quotedDestinationAssetKey = destAsset.key;

    const timer = setTimeout(async () => {
      setRoutingKey(quotedRequestKey);
      setNoRouteKey(null);
      try {
        const found = quotedMode === "strict-send"
          ? await findStrictSendRoute({
              network,
              sendCode: sendAsset.code,
              sendIssuer: sendAsset.issuer,
              sendAmount: quotedExactAmount,
              destCode: destAsset.code,
              destIssuer: destAsset.issuer,
            })
          : await findStrictReceiveRoute({
              network,
              sendCode: sendAsset.code,
              sendIssuer: sendAsset.issuer,
              destinationAmount: quotedExactAmount,
              destCode: destAsset.code,
              destIssuer: destAsset.issuer,
            });

        if (!alive) return;
        if (found) {
          setRoute("destinationAmount" in found
            ? bindSwapQuote({
                mode: "strict-send",
                requestKey: quotedRequestKey,
                sendAssetKey: quotedSendAssetKey,
                destinationAssetKey: quotedDestinationAssetKey,
                destinationAmount: found.destinationAmount,
                destinationMinimum: applySlippage(found.destinationAmount, quotedSlippage),
                intermediates: found.intermediates,
                sendAmount: quotedExactAmount,
                slippage: quotedSlippage,
              })
            : bindSwapQuote({
                mode: "strict-receive",
                requestKey: quotedRequestKey,
                sendAssetKey: quotedSendAssetKey,
                destinationAssetKey: quotedDestinationAssetKey,
                destinationAmount: quotedExactAmount,
                sendAmount: found.sourceAmount,
                sendMaximum: applySlippageCeiling(found.sourceAmount, quotedSlippage),
                intermediates: found.intermediates,
                slippage: quotedSlippage,
              }));
          setNoRouteKey(null);
          setError(null);
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
  }, [routeKey, sendAsset, destAsset, exactAmount, quoteMode, slippage, valid, network, quoteAttempt]);

  function invalidateQuoteForEdit() {
    setRoute(null);
    setNoRouteKey(null);
    setError(null);
    setStage((current) => current === "review" ? "form" : current);
  }

  function flipAssets() {
    triggerHaptic("medium");
    const prevSend = sendKey;
    const prevDest = effectiveDestKey;
    if (!prevDest) return;
    setSendKey(prevDest);
    setDestKey(prevSend);
    setPayAmount("");
    setReceiveAmount("");
    setAmountSide("pay");
    invalidateQuoteForEdit();
  }

  function handleAmountChange(side: "pay" | "receive", val: string) {
    const clean = val.replace(/,/g, ".");
    setAmountSide(side);
    if (side === "pay") {
      setPayAmount(clean);
      setReceiveAmount("");
    } else {
      setReceiveAmount(clean);
      setPayAmount("");
    }
    invalidateQuoteForEdit();
  }

  async function handleSwap() {
    if (pendingSubmission) return;
    const submissionQuote = guardCurrentSwapQuote(route, routeKey);
    if (!submissionQuote || !sendAsset || !destAsset) return;
    setBusy(true);
    setError(null);
    try {
      const common = {
        sendCode: sendAsset.code,
        sendIssuer: sendAsset.issuer,
        destCode: destAsset.code,
        destIssuer: destAsset.issuer,
        intermediates: [...submissionQuote.intermediates],
      };
      const result = submissionQuote.mode === "strict-receive"
        ? await swap({
            ...common,
            mode: "strict-receive",
            sendMax: submissionQuote.sendMaximum,
            destinationAmount: submissionQuote.destinationAmount,
          })
        : await swap({
            ...common,
            mode: "strict-send",
            sendAmount: submissionQuote.sendAmount,
            destMin: submissionQuote.destinationMinimum,
          });
      setSubmittedSwap(Object.freeze({
        quote: submissionQuote,
        sendAsset: swapReceiptAssetIdentity(sendAsset),
        destinationAsset: swapReceiptAssetIdentity(destAsset),
        submission: Object.freeze({ ...result }),
      }));
      setPendingSubmission(result);
      setStage(result.status === "confirmed" ? "success" : "status");
      triggerHaptic(result.status === "status_unknown" ? "warning" : "medium");
    } catch (e) {
      triggerHaptic("error");
      setRoute(null);
      setNoRouteKey(null);
      setStage("form");
      setQuoteAttempt((attempt) => attempt + 1);
      setError(e instanceof Error ? e.message : "Swap failed. Refreshing the quote before retry.");
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
  const displayedPayAmount = amountSide === "pay"
    ? payAmount
    : currentQuote ? normalizeAmount(currentQuote.sendAmount) : "";
  const displayedReceiveAmount = amountSide === "receive"
    ? receiveAmount
    : currentQuote ? normalizeAmount(currentQuote.destinationAmount) : "";

  function resetSwap() {
    setPayAmount("");
    setReceiveAmount("");
    setAmountSide("pay");
    setRoute(null);
    setRoutingKey(null);
    setNoRouteKey(null);
    setPendingSubmission(null);
    setSubmittedSwap(null);
    setError(null);
    setStage("form");
    window.scrollTo({ top: 0 });
  }

  if ((stage === "status" || stage === "success") && submittedSwap) {
    return (
      <SwapResultView
        receipt={submittedSwap}
        status={stage === "success" ? "confirmed" : trackedSubmissionStatus}
        feeXlm={feeXlm}
        onDone={() => {
          triggerHaptic("selection");
          if (onDone) onDone();
          else resetSwap();
        }}
        onViewActivity={() => {
          triggerHaptic("selection");
          if (onViewActivity) onViewActivity();
        }}
        onSwapAgain={() => {
          triggerHaptic("selection");
          resetSwap();
        }}
      />
    );
  }

  return (
    <div className="fade-up mx-auto w-full max-w-[520px] min-w-0 px-0 pb-0">
      {/* Compact context bar — the page title lives in the app chrome */}
      <div className="flex min-w-0 items-center justify-between gap-3 pb-3">
        <div className="min-w-0">
          <p className="text-[12.5px] font-semibold text-neutral-200">Edit either amount</p>
          <p className="text-[11px] text-neutral-500">The other side updates from the live route</p>
        </div>
        <button
          type="button"
          onClick={() => {
            triggerHaptic("selection");
            setShowSettings((s) => !s);
          }}
          className={`flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[11.5px] font-semibold transition-colors ${
            showSettings
              ? "border-[#0A84FF]/45 bg-[#0A84FF]/15 text-[#64D2FF]"
              : "border-white/10 bg-white/[0.055] text-neutral-300 hover:bg-white/[0.1] hover:text-white"
          }`}
          aria-label="Slippage Settings"
        >
          <IconSliders size={14} />
          <span>Slippage {slippage}%</span>
        </button>
      </div>

      {prefill && (
        <div className="mb-3 rounded-2xl border border-[#5E5CE6]/35 bg-[#5E5CE6]/10 p-3.5">
          <p className="text-[12.5px] font-semibold text-white">Merchant settlement handoff</p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-neutral-300">
            Rule context {prefill.contextId}. The exact amount and assets were carried here for
            review; no transaction has been signed.
          </p>
          {(prefill.network !== network || prefill.sourceAccount !== activeAccount?.publicKey) && (
            <p className="mt-2 text-[11.5px] font-semibold text-[#FF9F0A]">
              Switch back to the handoff&rsquo;s {prefill.network} receiving account to continue.
            </p>
          )}
        </div>
      )}

      {/* Slippage Settings (toggled by the toolbar gear) */}
      {showSettings && (
        <div className="panel-inset p-4 space-y-3 mb-3">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-semibold text-white">Slippage Tolerance</span>
            <span className="text-[12px] font-medium text-[#0A84FF]">{slippage}%</span>
          </div>
          <div role="group" aria-label="Slippage presets" className="grid grid-cols-4 gap-2">
            {[0.1, 0.5, 1.0, 3.0].map((val) => (
              <button
                key={val}
                type="button"
                aria-pressed={slippage === val}
                onClick={() => {
                  triggerHaptic("selection");
                  setSlippage(val);
                  invalidateQuoteForEdit();
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
            <label htmlFor="swap-custom-slippage" className="text-[11.5px] text-neutral-400">
              Custom:
            </label>
            <div className="flex items-center gap-1">
              <input
                id="swap-custom-slippage"
                type="number"
                aria-label="Custom slippage percentage"
                step="0.1"
                min="0.05"
                max="10"
                placeholder={String(slippage)}
                value={slippage}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  if (!Number.isNaN(val) && val > 0 && val <= 20) {
                    setSlippage(val);
                    invalidateQuoteForEdit();
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
          <SwapAmountCard
            label="You pay"
            amountLabel="You pay amount"
            assetLabel="You pay asset"
            amount={displayedPayAmount}
            exact={amountSide === "pay"}
            routing={routing && amountSide === "receive"}
            assetOptions={options}
            assetKey={sendKey}
            onAmountChange={(value) => handleAmountChange("pay", value)}
            onAssetChange={(key) => {
              setSendKey(key);
              if (key === effectiveDestKey) {
                setDestKey(options.find((balance) => balance.key !== key)?.key ?? "");
              }
              invalidateQuoteForEdit();
            }}
            balance={sendAsset ? `Available ${fmtAmount(sendAvailable)} ${sendAsset.code}` : null}
            onBalanceClick={sendAsset
              ? () => {
                  triggerHaptic("selection");
                  handleAmountChange("pay", sendAvailable);
                }
              : undefined}
          >
            {sendAsset && (
              <div className="grid grid-cols-4 gap-1.5 pt-1">
                {[0.25, 0.5, 0.75, 1.0].map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => {
                      triggerHaptic("selection");
                      handleAmountChange(
                        "pay",
                        fractionOfStellarAmount(sendAvailable, Math.round(pct * 100), 100),
                      );
                    }}
                    className="min-h-9 rounded-xl bg-white/[0.06] px-1.5 py-1 text-[11px] font-semibold text-neutral-300 transition-colors hover:bg-white/[0.12] hover:text-white"
                  >
                    {pct === 1.0 ? "MAX" : `${pct * 100}%`}
                  </button>
                ))}
              </div>
            )}
          </SwapAmountCard>

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

          <SwapAmountCard
            label="You receive"
            amountLabel="You receive amount"
            assetLabel="You receive asset"
            amount={displayedReceiveAmount}
            exact={amountSide === "receive"}
            routing={routing && amountSide === "pay"}
            assetOptions={options.filter((balance) => balance.key !== sendKey)}
            assetKey={effectiveDestKey}
            onAmountChange={(value) => handleAmountChange("receive", value)}
            onAssetChange={(key) => {
              setDestKey(key);
              invalidateQuoteForEdit();
            }}
            balance={destAsset ? `Balance ${fmtAmount(destAsset.balance)} ${destAsset.code}` : null}
          />

          {quoteExceedsBalance && quotedSpendLimit && sendAsset && (
            <div className="flex items-start gap-2 rounded-2xl border border-[#FF9F0A]/30 bg-[#FF9F0A]/10 p-3.5 text-[12.5px] text-[#FFB340]">
              <IconAlert size={16} className="mt-0.5 shrink-0" />
              <span className="min-w-0 break-words">
                This quote can spend up to {fmtAmount(quotedSpendLimit)} {sendAsset.code}, but only {fmtAmount(sendAvailable)} is available.
              </span>
            </div>
          )}

          {error && <ErrorText message={error} />}

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
                className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] gap-3 text-left text-neutral-400 transition-colors hover:text-white"
              >
                <span>Rate (Tap to flip)</span>
                <span className="mono min-w-0 break-words text-right text-white">
                  {invertRate
                    ? `1 ${destAsset?.code} ≈ ${reverseExchangeRate} ${sendAsset?.code}`
                    : `1 ${sendAsset?.code} ≈ ${exchangeRate} ${destAsset?.code}`}
                </span>
              </button>
              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] gap-3 text-neutral-400">
                <span>{currentQuote.mode === "strict-send" ? "Minimum received" : "Maximum paid"}</span>
                <span className="mono min-w-0 break-words text-right text-white">
                  {currentQuote.mode === "strict-send"
                    ? `${fmtAmount(currentQuote.destinationMinimum)} ${destAsset?.code}`
                    : `${fmtAmount(currentQuote.sendMaximum)} ${sendAsset?.code}`}
                </span>
              </div>
              <div className="flex flex-wrap justify-between gap-2 text-neutral-400">
                <span>Quote Source</span>
                <span className="font-medium text-neutral-200">
                  Horizon {currentQuote.mode} path
                </span>
              </div>
              <div className="flex flex-wrap justify-between gap-2 text-neutral-400">
                <span>Estimated Network Fee</span>
                <span className="mono text-neutral-300">{feeXlm} XLM</span>
              </div>
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 pt-1 text-neutral-400">
                <span>Route Hops</span>
                <div className="flex min-w-0 flex-wrap items-center justify-end gap-1">
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

                <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] gap-3 text-neutral-300">
                  <span>You Pay</span>
                  <span className="mono min-w-0 break-words text-right font-semibold text-white">
                    {fmtAmount(currentQuote.sendAmount)} {sendAsset?.code}
                  </span>
                </div>
                <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] gap-3 text-[#30D158]">
                  <span>You Receive</span>
                  <span className="mono min-w-0 break-words text-right font-semibold">
                    {fmtAmount(currentQuote.destinationAmount)} {destAsset?.code}
                  </span>
                </div>
                <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] gap-3 text-[12px] text-neutral-400">
                  <span>{currentQuote.mode === "strict-send" ? "Minimum received" : "Maximum paid"}</span>
                  <span className="mono min-w-0 break-words text-right text-neutral-200">
                    {currentQuote.mode === "strict-send"
                      ? `${fmtAmount(currentQuote.destinationMinimum)} ${destAsset?.code}`
                      : `${fmtAmount(currentQuote.sendMaximum)} ${sendAsset?.code}`}
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

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
              disabled={!currentQuote || quoteExceedsBalance || busy || routing || Boolean(pendingSubmission)}
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

function SwapResultView({
  receipt,
  status,
  feeXlm,
  onDone,
  onViewActivity,
  onSwapAgain,
}: {
  receipt: SubmittedSwap;
  status: SubmissionLifecycleStatus | null;
  feeXlm: string;
  onDone: () => void;
  onViewActivity: () => void;
  onSwapAgain: () => void;
}) {
  const { quote, sendAsset, destinationAsset, submission } = receipt;
  const isConfirmed = status === "confirmed";
  const isUncertain = status === "status_unknown";
  const routeLabel = quote.intermediates.length === 0
    ? "Direct Stellar DEX path"
    : `${quote.intermediates.length} intermediate ${quote.intermediates.length === 1 ? "asset" : "assets"}`;

  if (!isConfirmed) {
    return (
      <section
        aria-live="polite"
        className="fade-up mx-auto w-full max-w-[520px] min-w-0 overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.045] p-5 text-center sm:p-7"
      >
        <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full border ${
          isUncertain
            ? "border-[#FF9F0A]/35 bg-[#FF9F0A]/10 text-[#FFB340]"
            : "border-[#0A84FF]/35 bg-[#0A84FF]/10 text-[#64D2FF]"
        }`}>
          {isUncertain ? <IconAlert size={25} /> : <Spinner size={24} />}
        </div>
        <p className={`mt-5 text-[11px] font-bold uppercase tracking-[0.12em] ${
          isUncertain ? "text-[#FFB340]" : "text-[#64D2FF]"
        }`}>
          {isUncertain ? "Status check in progress" : "Submitted to Stellar"}
        </p>
        <h2 className="mt-1.5 text-[25px] font-bold tracking-[-0.025em] text-white">
          {isUncertain ? "Checking swap status" : "Confirming your swap"}
        </h2>
        <p className="mx-auto mt-2 max-w-[390px] text-[13px] leading-relaxed text-neutral-400">
          {isUncertain
            ? "Horizon did not return a definitive submission result. Do not resubmit blindly; the wallet is checking the canonical transaction hash."
            : "The transaction was accepted and the wallet is waiting for its on-chain confirmation."}
        </p>

        <div className="mt-6 rounded-2xl border border-white/[0.08] bg-black/20 p-4 text-left">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <span className="text-[12px] text-neutral-400">Swap</span>
            <span className="mono min-w-0 break-words text-right text-[13px] font-semibold text-white">
              {fmtAmount(quote.sendAmount)} {sendAsset.code} → {fmtAmount(quote.destinationAmount)} {destinationAsset.code}
            </span>
          </div>
          <ReceiptAssetIssuer label="Pay asset issuer" asset={sendAsset} />
          <ReceiptAssetIssuer label="Receive asset issuer" asset={destinationAsset} />
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-white/[0.07] pt-3">
            <span className="text-[12px] text-neutral-400">Network</span>
            <NetworkBadge network={submission.network} />
          </div>
          <div className="mt-3 border-t border-white/[0.07] pt-3">
            <p className="text-[11px] text-neutral-500">Transaction hash</p>
            <HashValue
              full
              value={submission.hash}
              className="mt-1 w-full text-[10.5px] leading-relaxed text-neutral-300"
            />
          </div>
        </div>

        <Button variant="secondary" className="mt-5 w-full" onClick={onViewActivity}>
          View activity
        </Button>
      </section>
    );
  }

  const paidLabel = quote.mode === "strict-receive" ? "Quoted debit" : "Paid";
  const receivedLabel = quote.mode === "strict-send" ? "Quoted credit" : "Received";
  const protectionLabel = quote.mode === "strict-send" ? "Minimum received" : "Maximum paid";
  const protectionValue = quote.mode === "strict-send"
    ? `${fmtAmount(quote.destinationMinimum)} ${destinationAsset.code}`
    : `${fmtAmount(quote.sendMaximum)} ${sendAsset.code}`;

  return (
    <section
      aria-labelledby="swap-complete-heading"
      className="fade-up mx-auto w-full max-w-[520px] min-w-0 overflow-hidden rounded-[28px] border border-[#30D158]/20 bg-white/[0.045] shadow-[0_24px_80px_-42px_rgba(48,209,88,0.65)]"
    >
      <div className="relative overflow-hidden border-b border-white/[0.08] px-5 pb-6 pt-7 text-center sm:px-7 sm:pt-8">
        <div aria-hidden="true" className="absolute left-1/2 top-0 h-36 w-36 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#30D158]/15 blur-3xl" />
        <div className="relative mx-auto flex h-[72px] w-[72px] items-center justify-center rounded-full border border-[#30D158]/35 bg-[#30D158]/15 text-[#30D158] shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_12px_32px_-18px_rgba(48,209,88,0.9)]">
          <IconCheck size={34} className="stroke-[2.5]" />
        </div>
        <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.14em] text-[#30D158]">
          Confirmed
        </p>
        <h2 id="swap-complete-heading" className="mt-1 text-[28px] font-bold tracking-[-0.03em] text-white">
          Swap complete
        </h2>
        <p className="mono mt-3 min-w-0 break-words text-[clamp(1.8rem,9vw,2.45rem)] font-bold leading-none tracking-[-0.04em] text-white">
          {quote.mode === "strict-receive" ? "+" : "≈ +"}{fmtAmount(quote.destinationAmount)} {destinationAsset.code}
        </p>
        <p className="mt-2 text-[12.5px] text-neutral-400">
          Confirmed on Stellar {submission.network === "mainnet" ? "Mainnet" : "Testnet"}
        </p>
      </div>

      <div className="space-y-4 p-4 sm:p-5">
        <div className="overflow-hidden rounded-2xl border border-white/[0.09] bg-black/20">
          <div className="flex min-w-0 items-center justify-between gap-3 px-4 py-3.5">
            <div className="min-w-0">
              <p className="text-[12px] text-neutral-400">{paidLabel}</p>
              {quote.mode === "strict-receive" && (
                <p className="mt-0.5 text-[10.5px] text-neutral-500">Final debit may be lower</p>
              )}
            </div>
            <p className="mono min-w-0 break-words text-right text-[16px] font-semibold text-[#FF6961]">
              {quote.mode === "strict-receive" ? "≈ −" : "−"}{fmtAmount(quote.sendAmount)} {sendAsset.code}
            </p>
          </div>
          <div className="flex min-w-0 items-center justify-between gap-3 border-t border-white/[0.08] px-4 py-3.5">
            <div className="min-w-0">
              <p className="text-[12px] text-neutral-400">{receivedLabel}</p>
              {quote.mode === "strict-send" && (
                <p className="mt-0.5 text-[10.5px] text-neutral-500">Final credit may be higher</p>
              )}
            </div>
            <p className="mono min-w-0 break-words text-right text-[16px] font-semibold text-[#30D158]">
              {quote.mode === "strict-send" ? "≈ +" : "+"}{fmtAmount(quote.destinationAmount)} {destinationAsset.code}
            </p>
          </div>
        </div>

        {(sendAsset.issuer || destinationAsset.issuer) && (
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] px-4">
            <ReceiptAssetIssuer label="Pay asset issuer" asset={sendAsset} />
            <ReceiptAssetIssuer label="Receive asset issuer" asset={destinationAsset} />
          </div>
        )}

        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <span className="text-[12px] text-neutral-400">Protection</span>
            <span className="mono min-w-0 break-words text-right text-[12.5px] font-semibold text-white">
              {protectionLabel} · {protectionValue}
            </span>
          </div>
          <div className="mt-3 flex min-w-0 items-center justify-between gap-3 border-t border-white/[0.07] pt-3">
            <span className="text-[12px] text-neutral-400">Route</span>
            <span className="min-w-0 break-words text-right text-[12.5px] font-medium text-neutral-200">
              {routeLabel}
            </span>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-white/[0.07] pt-3">
            <span className="text-[12px] text-neutral-400">Estimated network fee</span>
            <span className="mono text-[12.5px] text-neutral-200">{feeXlm} XLM</span>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-white/[0.07] pt-3">
            <span className="text-[12px] text-neutral-400">Network</span>
            <NetworkBadge network={submission.network} />
          </div>
          <div className="mt-3 border-t border-white/[0.07] pt-3">
            <p className="text-[11px] text-neutral-500">Transaction hash</p>
            <HashValue
              full
              value={submission.hash}
              className="mt-1 w-full text-[10.5px] leading-relaxed text-neutral-300"
            />
          </div>
        </div>

        <Button className="w-full !h-12 text-[15px]" onClick={onDone}>
          Done
        </Button>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <Button variant="secondary" onClick={onViewActivity}>View activity</Button>
          <Button variant="ghost" onClick={onSwapAgain}>Swap again</Button>
        </div>
      </div>
    </section>
  );
}

function ReceiptAssetIssuer({
  label,
  asset,
}: {
  label: string;
  asset: SwapReceiptAssetIdentity;
}) {
  if (!asset.issuer) return null;
  return (
    <div className="flex min-w-0 items-start justify-between gap-3 border-t border-white/[0.07] py-3 first:border-t-0">
      <span className="shrink-0 text-[11px] text-neutral-500">{label}</span>
      <HashValue
        full
        value={asset.issuer}
        className="min-w-0 justify-end text-right text-[10.5px] leading-relaxed text-neutral-300"
      />
    </div>
  );
}

function SwapAmountCard({
  label,
  amountLabel,
  assetLabel,
  amount,
  exact,
  routing,
  assetOptions,
  assetKey,
  onAmountChange,
  onAssetChange,
  balance,
  onBalanceClick,
  children,
}: {
  label: string;
  amountLabel: string;
  assetLabel: string;
  amount: string;
  exact: boolean;
  routing: boolean;
  assetOptions: AssetBalance[];
  assetKey: string;
  onAmountChange: (value: string) => void;
  onAssetChange: (key: string) => void;
  balance: string | null;
  onBalanceClick?: () => void;
  children?: ReactNode;
}) {
  return (
    <section
      className={`min-w-0 space-y-2.5 rounded-[22px] border p-3.5 transition-colors sm:p-4 ${
        exact
          ? "border-[#0A84FF]/35 bg-[#0A84FF]/[0.07]"
          : "border-white/[0.08] bg-white/[0.055]"
      }`}
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.08em] text-neutral-400">
          {label}
          <span className={`rounded-full px-1.5 py-0.5 text-[9px] tracking-normal ${
            exact ? "bg-[#0A84FF]/15 text-[#64D2FF]" : "bg-white/[0.07] text-neutral-400"
          }`}>
            {exact ? "Exact" : "Quoted"}
          </span>
        </span>
        {balance && (onBalanceClick ? (
          <button
            type="button"
            onClick={onBalanceClick}
            className="min-w-0 break-words text-right text-[11.5px] font-medium text-[#64D2FF] hover:underline"
          >
            {balance}
          </button>
        ) : (
          <span className="min-w-0 break-words text-right text-[11.5px] text-neutral-400">
            {balance}
          </span>
        ))}
      </div>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2.5">
        <input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          aria-label={amountLabel}
          placeholder={routing ? "Quoting…" : "0.0"}
          value={amount}
          onChange={(event) => onAmountChange(event.target.value)}
          className="min-w-0 w-full bg-transparent text-[clamp(1.75rem,9vw,2.25rem)] font-bold leading-none tracking-[-0.035em] text-white outline-none placeholder:text-neutral-600 sm:text-[36px]"
        />
        <div className="max-w-[148px] shrink-0 sm:max-w-[180px]">
          <AssetSelect
            options={assetOptions}
            value={assetKey}
            ariaLabel={assetLabel}
            onChange={onAssetChange}
          />
        </div>
      </div>
      {children}
    </section>
  );
}

function AssetSelect({
  options,
  value,
  ariaLabel,
  onChange,
}: {
  options: AssetBalance[];
  value: string;
  ariaLabel: string;
  onChange: (key: string) => void;
}) {
  return (
    <Select
      size="sm"
      value={value}
      onChange={onChange}
      ariaLabel={ariaLabel}
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
