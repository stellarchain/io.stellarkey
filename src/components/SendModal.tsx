"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Federation } from "@stellar/stellar-sdk";
import { useWallet } from "@/hooks/useWallet";
import { isValidPublicAddress } from "@/lib/vault";
import { NETWORKS } from "@/lib/stellar";
import { parseSep7PayUri, validateSep7PayRequest, type PayUriPayload } from "@/lib/payuri";
import { fmtAmount, isValidAmount, memoByteLength } from "@/lib/format";
import { formatTrezorAddress } from "@/lib/address-display";
import {
  compareStellarAmounts,
  subtractStellarAmounts,
  stroopsToAmount,
  type StellarMemoInput,
} from "@/lib/stellar-domain";
import { lookupKnownAsset } from "@/lib/assets";
import {
  fetchFeeStats,
  fetchAccountSignerInfo,
  selectRecommendedBaseFee,
  type AccountSignerInfo,
  type FeeStats,
} from "@/lib/api";
import type { Contact } from "@/lib/contacts";
import {
  clearFederationMemoForDestinationChange,
  memoReviewPresentation,
  normalizeFederationMemo,
  resolveRequestedAsset,
  spendableAssetBalance,
} from "@/lib/transaction-intent";
import { triggerHaptic } from "@/lib/haptics";
import type { SubmissionResult } from "@/lib/submission";
import type { SettlementSweepIntent } from "@/lib/merchant/settlement";
import { Button, CopyButton, ErrorText, HashValue, Modal, ModalHeader, QrScannerBox, SegmentedControl, Select, Spinner } from "./ui";
import { FiatValue } from "./FiatValue";
import {
  IconCheck,
  IconAlert,
  IconExternal,
  IconQrScan,
  IconUsers,
  IconWallet,
  IconTrezor,
  IconLedger,
} from "./icons";

type Stage = "form" | "review" | "sending" | "cosign" | "done" | "status_unknown";
type MemoType = StellarMemoInput["type"];
type FeeTier = "normal" | "priority" | "urgent";

export type SendPrefill = PayUriPayload & {
  settlementIntent?: SettlementSweepIntent;
};

export function SendModal({
  open,
  onClose,
  prefill,
}: {
  open: boolean;
  onClose: () => void;
  prefill?: SendPrefill | null;
}) {
  if (!open) return null;
  return <SendInner onClose={onClose} prefill={prefill} />;
}

function SendInner({
  onClose,
  prefill,
}: {
  onClose: () => void;
  prefill?: SendPrefill | null;
}) {
  const { balances, minimumBalanceXlm, recommendedBaseFeeStroops, send, prepareCosignPayment, network, refresh, contacts, activeAccount, accounts, activity, submissionStatus } = useWallet();
  const prefillError = prefill
    ? validateSep7PayRequest(prefill, NETWORKS[network].networkPassphrase)
    : null;
  const acceptedPrefill = prefillError ? null : prefill;
  const prefillHasAssetIdentity = Boolean(
    acceptedPrefill?.assetCode || acceptedPrefill?.assetIssuer,
  );
  const requestedPrefillAsset = acceptedPrefill && prefillHasAssetIdentity && balances !== null
    ? resolveRequestedAsset(acceptedPrefill, balances)
    : prefillHasAssetIdentity
      ? { assetKey: null, error: null }
    : { assetKey: "native", error: null };
  const [stage, setStage] = useState<Stage>("form");
  const [destination, setDestination] = useState(acceptedPrefill?.destination ?? "");
  const [amount, setAmount] = useState(
    acceptedPrefill?.amount && isValidAmount(acceptedPrefill.amount) ? acceptedPrefill.amount : "",
  );
  const [assetKey, setAssetKey] = useState(requestedPrefillAsset.assetKey ?? "");
  const [usePendingPrefillAsset, setUsePendingPrefillAsset] = useState(true);
  const [memoType, setMemoType] = useState<MemoType>(acceptedPrefill?.memoType ?? "text");
  const [memo, setMemo] = useState(acceptedPrefill?.memo ?? "");
  const [feeTier, setFeeTier] = useState<FeeTier>("normal");
  const [liveFeeSelection, setLiveFeeSelection] = useState<{
    network: typeof network;
    stats: FeeStats;
  } | null>(null);
  const liveFeeStats = liveFeeSelection?.network === network ? liveFeeSelection.stats : null;
  const [error, setError] = useState<string | null>(prefillError);
  const [hash, setHash] = useState<string | null>(null);
  const [submission, setSubmission] = useState<SubmissionResult | null>(null);
  const [cosignXdr, setCosignXdr] = useState<string | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  const [resolvingFed, setResolvingFed] = useState(false);
  const [fedResolvedAddr, setFedResolvedAddr] = useState<string | null>(null);
  const federationMemoAppliedRef = useRef(false);

  const [signerInfo, setSignerInfo] = useState<AccountSignerInfo | null>(null);
  const trackedSubmissionStatus = submission ? submissionStatus(submission) : null;

  useEffect(() => {
    let alive = true;
    void (async () => {
      await Promise.resolve();
      if (!alive) return;
      if (trackedSubmissionStatus === "confirmed") {
        setStage("done");
        return;
      }
      if (trackedSubmissionStatus === "failed") {
        setSubmission(null);
        setHash(null);
        setStage("review");
        setError("Transaction failed on-chain. Review the details and retry when ready.");
        triggerHaptic("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, [trackedSubmissionStatus]);

  // Fetch live fee surge stats on mount
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const stats = await fetchFeeStats(network);
        if (alive && stats) setLiveFeeSelection({ network, stats });
      } catch {
        // The provider-selected bounded fallback remains authoritative.
      }
    })();
    return () => {
      alive = false;
    };
  }, [network]);

  // Fetch account signer config to detect multi-sig requirements
  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!activeAccount) return;
      const info = await fetchAccountSignerInfo(activeAccount.publicKey, network);
      if (alive) setSignerInfo(info);
    })();
    return () => {
      alive = false;
    };
  }, [activeAccount, network]);

  const options = useMemo(() => balances ?? [], [balances]);
  const pendingPrefillAsset =
    usePendingPrefillAsset && !assetKey && acceptedPrefill && prefillHasAssetIdentity
      ? balances === null
        ? { assetKey: null, error: null }
        : resolveRequestedAsset(acceptedPrefill, options)
      : null;
  const effectiveAssetKey = assetKey || pendingPrefillAsset?.assetKey || "";
  const selectedAsset = useMemo(
    () => options.find((b) => b.key === effectiveAssetKey) ?? null,
    [options, effectiveAssetKey],
  );
  const settlementIntent = prefill?.settlementIntent ?? null;
  const settlementContextError = settlementIntent
    ? settlementIntent.network !== network
      ? `Switch to ${settlementIntent.network} to review this merchant settlement handoff.`
      : settlementIntent.sourceAccount !== activeAccount?.publicKey
        ? "Switch to the merchant receiving account to review this settlement handoff."
        : null
    : null;
  const effectiveError = error ?? pendingPrefillAsset?.error ?? settlementContextError;
  const reviewMemo = memoReviewPresentation(memo, memoType);

  // Recent recipients derived from outgoing activity (most recent first)
  const recentRecipients = useMemo(() => {
    const seen = new Map<string, number>();
    for (const a of activity) {
      const cp = a.counterparty;
      if (!cp || a.direction !== "out") continue;
      if (isValidPublicAddress(cp) && !seen.has(cp)) {
        seen.set(cp, new Date(a.createdAt).getTime());
      }
    }
    return [...seen.keys()].slice(0, 3);
  }, [activity]);

  const isFederation = destination.includes("*");

  // Handle federation address check (e.g. user*domain.com) asynchronously
  useEffect(() => {
    let alive = true;
    if (!isFederation || destination.trim().length < 5) return;

    const timer = window.setTimeout(async () => {
      setResolvingFed(true);
      try {
        const res = await Federation.Server.resolve(destination.trim());
        if (alive && res?.account_id) {
          setFedResolvedAddr(res.account_id);
          if (res.memo) {
            const nextMemo = normalizeFederationMemo(res.memo, res.memo_type);
            setMemo(nextMemo.memo);
            setMemoType(nextMemo.memoType);
            federationMemoAppliedRef.current = nextMemo.federationBound;
          }
        }
      } catch (cause) {
        if (alive) {
          setFedResolvedAddr(null);
          setError(
            cause instanceof Error
              ? cause.message
              : "Unable to resolve this federation address.",
          );
        }
      } finally {
        if (alive) setResolvingFed(false);
      }
    }, 600);

    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [destination, isFederation]);

  const effectiveDestination = (isFederation && fedResolvedAddr) ? fedResolvedAddr : destination.trim();
  const destOk = isValidPublicAddress(effectiveDestination);
  const matchedContact: Contact | undefined = contacts.find(
    (c) => c.address === effectiveDestination,
  );

  const balance = selectedAsset?.balance ?? "0";

  const memoBytes = memoByteLength(memo);
  const memoOk =
    memoType === "text"
      ? memoBytes <= 28
      : memoType === "id"
        ? /^\d+$/.test(memo.trim()) || memo.trim() === ""
        : memoType === "hash" || memoType === "return"
          ? /^[0-9a-fA-F]{64}$/.test(memo.trim()) || memo.trim() === ""
          : true;

  const normalStroops = recommendedBaseFeeStroops;
  const priorityStroops = selectRecommendedBaseFee(
    null,
    Math.max(200, (liveFeeStats?.p90AcceptedFee ?? recommendedBaseFeeStroops) * 2),
  );
  const urgentStroops = selectRecommendedBaseFee(
    null,
    Math.max(500, (liveFeeStats?.p99AcceptedFee ?? recommendedBaseFeeStroops) * 3),
  );
  const feeStroops = feeTier === "urgent" ? urgentStroops : feeTier === "priority" ? priorityStroops : normalStroops;
  const feeXlm = stroopsToAmount(BigInt(feeStroops));
  const maxSendable = selectedAsset?.isNative
    ? minimumBalanceXlm === null
      ? "0"
      : spendableAssetBalance(selectedAsset, [minimumBalanceXlm, feeXlm])
    : selectedAsset
      ? spendableAssetBalance(selectedAsset)
      : "0";
  const amountOk =
    isValidAmount(amount) &&
    selectedAsset !== null &&
    compareStellarAmounts(amount, maxSendable) <= 0;

  const reserveBlocked =
    selectedAsset?.isNative === true &&
    isValidAmount(amount) &&
    compareStellarAmounts(amount, maxSendable) > 0;
  const canReview =
    (destOk || Boolean(fedResolvedAddr)) &&
    amountOk &&
    memoOk &&
    !reserveBlocked &&
    !effectiveError;

  // Multisig: warn when our signature alone can't meet the medium threshold
  const myWeight =
    signerInfo && activeAccount
      ? (signerInfo.signers.find((s) => s.key === activeAccount.publicKey)?.weight ?? 0)
      : 1;
  const needsCosigners = signerInfo !== null && signerInfo.thresholds.med_threshold > myWeight;

  const remainingBalance = isValidAmount(amount)
    ? subtractStellarAmounts(balance, [amount, ...(selectedAsset?.isNative ? [feeXlm] : [])])
    : balance;

  async function handleConfirm() {
    if (!selectedAsset) return;
    setStage("sending");
    setError(null);
    try {
      const paymentMemo: StellarMemoInput | undefined = memo.trim()
        ? { type: memoType, value: memo.trim() }
        : undefined;
      if (needsCosigners) {
        // Multi-sig account: collect our signature, share the envelope instead of submitting
        const result = await prepareCosignPayment({
          destination: effectiveDestination,
          amount,
          assetCode: selectedAsset.code,
          issuer: selectedAsset.issuer,
          memo: paymentMemo,
          feeStroops,
        });
        setCosignXdr(result.xdr);
        setStage("cosign");
        triggerHaptic("success");
        return;
      }
      const result = await send({
        destination: effectiveDestination,
        amount,
        assetCode: selectedAsset.code,
        issuer: selectedAsset.issuer,
        memo: paymentMemo,
        feeStroops,
      });
      setHash(result.hash);
      setSubmission(result);
      if (result.status === "status_unknown") {
        setStage("status_unknown");
        triggerHaptic("warning");
        return;
      }
      setStage("done");
      triggerHaptic("success");
      window.setTimeout(() => void refresh(), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Transaction failed.");
      setStage("review");
      triggerHaptic("error");
    }
  }

  function handleDestinationChange(raw: string) {
    setUsePendingPrefillAsset(false);
    const nextMemo = clearFederationMemoForDestinationChange({
      memo,
      memoType,
      federationBound: federationMemoAppliedRef.current,
    });
    setMemo(nextMemo.memo);
    setMemoType(nextMemo.memoType);
    federationMemoAppliedRef.current = nextMemo.federationBound;
    setDestination(raw);
    setFedResolvedAddr(null);
    setResolvingFed(false);
    setError(null);
    const parsed = parseSep7PayUri(raw);
    if (parsed?.destination) {
      const validationError = validateSep7PayRequest(
        parsed,
        NETWORKS[network].networkPassphrase,
      );
      if (validationError) {
        setError(validationError);
        return;
      }
      setDestination(parsed.destination);
      if (parsed.amount && isValidAmount(parsed.amount)) setAmount(parsed.amount);
      if (parsed.memo) {
        setMemo(parsed.memo);
        setMemoType(parsed.memoType ?? "text");
      }
      const requested = resolveRequestedAsset(parsed, options);
      setAssetKey(requested.assetKey ?? "");
      if (requested.error) {
        setError(requested.error);
        return;
      }
      triggerHaptic("medium");
    }
  }

  const knownSelected = selectedAsset
    ? lookupKnownAsset(selectedAsset.code, selectedAsset.issuer, network)
    : null;

  return (
    <Modal
      open
      onClose={onClose}
      dismissable
      wide
    >
      <ModalHeader
        title={
          stage === "done"
            ? trackedSubmissionStatus === "confirmed" ? "Payment Confirmed" : "Payment Accepted"
            : stage === "status_unknown"
              ? "Payment Status Unknown"
            : stage === "cosign"
              ? "Awaiting Cosigners"
              : stage === "review" || stage === "sending"
                ? "Review Transfer"
                : "Send Payment"
        }
        subtitle={
          stage === "done"
            ? trackedSubmissionStatus === "confirmed"
              ? `Confirmed on Stellar ${NETWORKS[network].label}`
              : `Accepted on Stellar ${NETWORKS[network].label} — confirming on-chain`
            : stage === "status_unknown"
              ? `Tracking the canonical hash on Stellar ${NETWORKS[network].label}`
            : stage === "cosign"
              ? "Signed — share the envelope to collect signatures"
              : stage === "review" || stage === "sending"
                ? "Verify details before broadcasting"
                : `Transfer assets on Stellar ${NETWORKS[network].label}`
        }
        onClose={onClose}
      />
      <div className="p-4 sm:p-6">
        {stage === "done" ? (
          <div className="flex flex-col items-center py-4">
            <span className="flex h-16 w-16 items-center justify-center rounded-full border border-[#30D158]/30 bg-[#30D158]/10 text-[#30D158]">
              <IconCheck size={28} />
            </span>
            <p className="display-h mt-4 text-xl font-light text-white">
              {trackedSubmissionStatus === "confirmed" ? "Payment Confirmed" : "Payment Accepted"}
            </p>
            <p className="mt-1 text-[13px] text-neutral-400">
              {trackedSubmissionStatus === "confirmed"
                ? "The payment is confirmed on-chain."
                : "Horizon accepted the transaction. Confirmation tracking continues in the dashboard."}
            </p>
            {hash && (
              <a
                className="chip mt-4"
                href={NETWORKS[network].explorerTxUrl(hash)}
                target="_blank"
                rel="noopener noreferrer"
              >
                View on Explorer <IconExternal size={11} />
              </a>
            )}
            <Button variant="ghost" className="mt-6 w-full" onClick={onClose}>
              Done
            </Button>
          </div>
        ) : stage === "status_unknown" ? (
          <div className="flex flex-col items-center py-4 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full border border-[#FF9F0A]/30 bg-[#FF9F0A]/10 text-[#FF9F0A]">
              <IconAlert size={28} />
            </span>
            <p className="display-h mt-4 text-xl font-light text-white">Submission Status Unknown</p>
            <p className="mt-2 max-w-md text-[13px] leading-relaxed text-neutral-300">
              Horizon did not confirm whether it accepted this transaction. Do not resubmit blindly.
              The wallet will keep checking the canonical hash.
            </p>
            {hash && (
              <p className="mt-4 w-full break-all rounded-xl bg-white/[0.04] p-3 font-mono text-[10.5px] text-neutral-300">
                {network} · {hash}
              </p>
            )}
            <Button variant="ghost" className="mt-6 w-full" onClick={onClose}>
              Close and Keep Tracking
            </Button>
          </div>
        ) : stage === "cosign" ? (
          <div className="flex flex-col items-center py-2 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full border border-[#FF9F0A]/30 bg-[#FF9F0A]/10 text-[#FF9F0A]">
              <IconUsers size={26} />
            </span>
            <p className="display-h mt-4 text-xl font-light text-white">Awaiting Cosigners</p>
            <p className="mt-1 max-w-[340px] text-[13px] leading-relaxed text-neutral-400">
              Your signature is collected (weight {myWeight} of{" "}
              {signerInfo?.thresholds.med_threshold ?? 0} needed). Share this envelope with a
              cosigner to complete the payment.
            </p>
            <div className="mono mt-4 max-h-28 w-full select-all overflow-y-auto break-all rounded-xl bg-black/40 p-3 text-left text-[10.5px] leading-relaxed text-neutral-300">
              {cosignXdr}
            </div>
            <CopyButton
              value={cosignXdr ?? ""}
              label="Copy Envelope XDR"
              className="chip mt-3 w-full justify-center"
            />
            <p className="mt-2.5 text-[11px] leading-relaxed text-neutral-500">
              Cosigners open Multi-Sig Studio → Approvals, paste the envelope, and sign — it
              submits automatically once the threshold is met.
            </p>
            <Button variant="ghost" className="mt-4 w-full" onClick={onClose}>
              Done
            </Button>
          </div>
        ) : stage === "review" || stage === "sending" ? (
          <>
            <div className="flex flex-col items-center pb-2">
              <p className="display-h text-[36px] text-white">
                {fmtAmount(amount)}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <span
                  className="mono rounded-full px-2.5 py-1 text-[10px] font-bold"
                  style={
                    knownSelected
                      ? { background: knownSelected.color, color: "#fff" }
                      : selectedAsset?.isNative
                        ? { background: "#fdda24", color: "#0d0d0d" }
                        : { background: "rgba(255,255,255,0.08)", color: "#fff" }
                  }
                >
                  {selectedAsset?.code}
                </span>
                {knownSelected && (
                  <span className="text-[12px] text-neutral-400">{knownSelected.name}</span>
                )}
              </div>
              <FiatValue
                amount={amount}
                code={selectedAsset?.code ?? "XLM"}
                issuer={selectedAsset?.issuer}
                isNative={selectedAsset?.isNative}
                className="mt-2 text-[13px] text-neutral-400"
              />
            </div>

            <div className="panel-inset mt-6 divide-y divide-white/[0.08] px-4">
              <Row label="To">
                <HashValue
                  value={effectiveDestination}
                  className="justify-end text-[12px] text-white"
                />
              </Row>
              {isFederation && (
                <Row label="Federation">
                  <span className="text-[13px] text-white">{destination}</span>
                </Row>
              )}
              {matchedContact && (
                <Row label="Contact">
                  <span className="text-[13px] text-white">{matchedContact.name}</span>
                </Row>
              )}
              {!selectedAsset?.isNative && (
                <Row label="Issuer">
                  <HashValue
                    value={selectedAsset?.issuer ?? ""}
                    className="justify-end text-[12px] text-neutral-300"
                  />
                </Row>
              )}
              {reviewMemo && (
                <Row label={reviewMemo.label}>
                  <span className="text-[13px] text-white">{reviewMemo.value}</span>
                </Row>
              )}
              <Row label="Network Fee">
                <span className="mono text-[13px] text-neutral-300">
                  {feeXlm} XLM <span className="text-[11px] text-neutral-500">({feeStroops} stroops)</span>
                </span>
              </Row>
              <Row label="Transaction Valid For">
                <span className="mono text-[12.5px] text-neutral-300">
                  180 seconds
                </span>
              </Row>
            </div>

            {/* Pre-Flight Balance Delta Simulator */}
            <div className="panel-inset mt-3 p-3.5 space-y-1.5 text-[12px]">
              <p className="text-[10.5px] font-semibold uppercase tracking-wider text-neutral-400">
                Pre-Flight Balance Simulation
              </p>
              <div className="flex justify-between text-neutral-300">
                <span>Balance Before</span>
                <span className="mono">{fmtAmount(balance)} {selectedAsset?.code}</span>
              </div>
              <div className="flex justify-between text-[#FF453A]">
                <span>Transfer Amount</span>
                <span className="mono">−{fmtAmount(amount)} {selectedAsset?.code}</span>
              </div>
              {selectedAsset?.isNative && (
                <div className="flex justify-between text-neutral-400">
                  <span>Network Gas Fee</span>
                  <span className="mono">−{feeXlm} XLM</span>
                </div>
              )}
              <div className="border-t border-white/10 pt-1.5 flex justify-between font-semibold text-white">
                <span>Balance After</span>
                <span className="mono">{remainingBalance} {selectedAsset?.code}</span>
              </div>
            </div>

            {/* Multi-sig cosigner requirement warning */}
            {needsCosigners && (
              <div className="mt-3 flex items-start gap-2.5 rounded-2xl border border-[#FF9F0A]/30 bg-[#FF9F0A]/10 p-3.5 text-[12px] leading-relaxed text-[#FF9F0A]">
                <span className="shrink-0 text-[16px]">✍️</span>
                <span>
                  <strong>Multi-signature account.</strong> Your signature weight ({myWeight}) is
                  below the required threshold ({signerInfo?.thresholds.med_threshold}). Additional
                  signatures are needed before this transaction reaches the ledger.
                </span>
              </div>
            )}

            {/* Hardware Security Badge */}
            {activeAccount?.hardware && (
              <div className="panel-inset mt-3 p-3 flex items-center justify-between bg-[#0A84FF]/[0.08] border border-[#0A84FF]/30 text-[12px]">
                <div className="flex items-center gap-2 text-[#0A84FF]">
                  {activeAccount.hardware === "ledger" ? (
                    <IconLedger size={16} className="text-[#64D2FF]" />
                  ) : (
                    <IconTrezor size={16} className="text-emerald-400" />
                  )}
                  <span className="font-semibold">
                    Confirm &amp; Sign on {activeAccount.hardware === "ledger" ? "Ledger" : "Trezor"} Hardware Device
                  </span>
                </div>
                <span className="mono text-[11px] text-neutral-400">
                  {activeAccount.path ?? "m/44'/148'/0'"}
                </span>
              </div>
            )}

            {/* Hardware signing pending hint */}
            {stage === "sending" && activeAccount?.hardware && (
              <div className="mt-3 flex items-center gap-2.5 rounded-2xl border border-[#FF9F0A]/30 bg-[#FF9F0A]/10 p-3 text-[12px] leading-relaxed text-[#FF9F0A]">
                <Spinner size={13} />
                <span>
                  Waiting for your {activeAccount.hardware === "ledger" ? "Ledger" : "Trezor"}{" "}
                  — review and confirm the transaction on the device.
                </span>
              </div>
            )}

            {/* Transaction Safety Shield Verification */}
            <div className="panel-inset mt-3 p-3 flex items-center justify-between gap-3 bg-[#30D158]/[0.06] border border-[#30D158]/20 text-[12px]">
              <div className="flex shrink-0 items-center gap-2 text-[#30D158]">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#30D158]/20">
                  <IconCheck size={12} />
                </span>
                <span className="font-semibold whitespace-nowrap">Constructed Locally</span>
              </div>
              <span className="text-[11px] text-neutral-400 max-[420px]:hidden">Ed25519 · Non-Custodial</span>
            </div>


            {effectiveError && (
              <div className="mt-4">
                <ErrorText message={effectiveError} />
              </div>
            )}

            <div className="mt-6 grid grid-cols-2 gap-3">
              <Button
                variant="ghost"
                disabled={stage === "sending"}
                onClick={() => {
                  triggerHaptic("selection");
                  setStage("form");
                }}
              >
                Back
              </Button>
              <Button
                loading={stage === "sending"}
                disabled={stage === "sending"}
                onClick={() => void handleConfirm()}
              >
                {stage === "sending"
                  ? needsCosigners
                    ? "Signing…"
                    : "Sending…"
                  : needsCosigners
                    ? "Sign & Share for Approval"
                    : "Confirm Send"}
              </Button>
            </div>
          </>
        ) : (
          <div className="space-y-4">
            {settlementIntent && (
              <div className="rounded-2xl border border-[#0A84FF]/30 bg-[#0A84FF]/10 p-3.5">
                <p className="text-[12.5px] font-semibold text-white">Merchant settlement handoff</p>
                <p className="mt-1 text-[11.5px] leading-relaxed text-neutral-300">
                  Rule context {settlementIntent.contextId}. Destination, asset, and exact amount
                  were carried here for review; no transaction has been signed.
                </p>
              </div>
            )}
                            {/* Asset picker and Amount Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Asset picker */}
                <div>
                  <label className="field-label">Asset</label>
                  <Select
                    value={effectiveAssetKey}
                    onChange={(value) => {
                      setUsePendingPrefillAsset(false);
                      setAssetKey(value);
                      setError(null);
                    }}
                    ariaLabel="Asset"
                    options={options.map((b) => ({
                      value: b.key,
                      label: b.code,
                      sublabel: `Balance: ${fmtAmount(b.balance)}`,
                    }))}
                  />
                </div>

                {/* Amount */}
                <div>
                  <div className="flex items-center justify-between pb-1">
                    <label className="field-label !pb-0">Amount</label>
                    {selectedAsset && (
                      <button
                        type="button"
                        onClick={() => {
                          triggerHaptic("selection");
                          setAmount(maxSendable);
                        }}
                        className="text-[12px] font-medium text-[#0A84FF] hover:underline"
                      >
                        Max: {fmtAmount(maxSendable)} {selectedAsset.code}
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value.replace(/,/g, "."))}
                    className="input mono text-base sm:text-[15px]"
                  />
                  <FiatValue
                    amount={amount}
                    code={selectedAsset?.code ?? "XLM"}
                    issuer={selectedAsset?.issuer}
                    isNative={selectedAsset?.isNative}
                    className="mt-1 block text-[11.5px] text-neutral-500"
                  />
                  {reserveBlocked && (
                    <p className="mt-1 text-[11.5px] text-[#FF453A]">
                      Exceeds reserve ({fmtAmount(maxSendable)} XLM).
                    </p>
                  )}
                </div>
              </div>

              {/* Quick Amount Chips */}
              <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
                {[10, 25, 50, 100].map((val) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => {
                      triggerHaptic("selection");
                      setAmount(String(val));
                    }}
                    className="rounded-lg bg-white/[0.06] px-2.5 py-1 text-[11.5px] font-medium text-neutral-300 hover:bg-white/[0.12]"
                  >
                    {val}
                  </button>
                ))}
                {selectedAsset && (
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic("selection");
                      setAmount(maxSendable);
                    }}
                    className="rounded-lg bg-[#0A84FF]/15 border border-[#0A84FF]/30 px-2.5 py-1 text-[11.5px] font-bold text-[#0A84FF]"
                  >
                    MAX
                  </button>
                )}
              </div>
              {/* Destination */}
              <div>
                <div className="flex items-center justify-between pb-1">
                  <label className="field-label !pb-0">Recipient Address or Federation</label>
                  <button
                    type="button"
                    onClick={() => setShowScanner((s) => !s)}
                    className="text-[12px] font-medium text-[#0A84FF] hover:underline flex items-center gap-1"
                  >
                    <IconQrScan size={13} />
                    <span>{showScanner ? "Hide QR Input" : "Paste QR Payload"}</span>
                  </button>
                </div>
                <input
                  type="text"
                  placeholder="G... or user*domain.com"
                  value={destination}
                  onChange={(e) => handleDestinationChange(e.target.value)}
                  className="input mono text-base sm:text-[13px]"
                  spellCheck={false}
                  autoComplete="off"
                />

                {/* Transfer to My Accounts (Internal Wallet Transfer) */}
                {accounts.length > 1 && !destination && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-neutral-400 font-semibold flex items-center gap-1">
                      <IconWallet size={11} className="text-[#0A84FF]" />
                      <span>My accounts:</span>
                    </span>
                    {accounts
                      .filter((a) => a.id !== activeAccount?.id)
                      .map((acc) => (
                        <button
                          key={acc.id}
                          type="button"
                          onClick={() => {
                            triggerHaptic("selection");
                            handleDestinationChange(acc.publicKey);
                          }}
                          className="chip !py-0.5 !px-2 text-[11.5px] text-neutral-200 hover:text-white bg-[#0A84FF]/10 border border-[#0A84FF]/25 font-medium flex items-center gap-1"
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-[#0A84FF]" />
                          <span>{acc.label}</span>
                        </button>
                      ))}
                  </div>
                )}
                {contacts.length > 0 && !destination && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-neutral-500 font-medium">Quick contact:</span>
                    {contacts
                      .slice()
                      .sort((a, b) => (a.favorite && !b.favorite ? -1 : !a.favorite && b.favorite ? 1 : 0))
                      .slice(0, 5)
                      .map((c) => (
                        <button
                          key={c.address}
                          type="button"
                          onClick={() => {
                            triggerHaptic("selection");
                            handleDestinationChange(c.address);
                          }}
                          className={`chip !py-0.5 !px-2 text-[11.5px] flex items-center gap-1 transition-all ${
                            c.favorite
                              ? "bg-[#FFD60A]/15 border border-[#FFD60A]/30 text-white font-medium"
                              : "text-neutral-300 hover:text-white"
                          }`}
                        >
                          {c.favorite && <span className="text-[#FFD60A] text-[10px]">★</span>}
                          <span>{c.name}</span>
                        </button>
                      ))}
                  </div>
                )}
                {recentRecipients.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-neutral-500">Recent:</span>
                    {recentRecipients.map((addr) => (
                      <button
                        key={addr}
                        type="button"
                        onClick={() => {
                          triggerHaptic("selection");
                          handleDestinationChange(addr);
                        }}
                        className="chip !py-0.5 !px-2 text-[11.5px] text-neutral-300 hover:text-white"
                      >
                        {formatTrezorAddress(addr)}
                      </button>
                    ))}
                  </div>
                )}
                {resolvingFed && (
                  <p className="mt-1 text-[11px] text-[#0A84FF]">Resolving federation address…</p>
                )}
                {fedResolvedAddr && (
                  <p className="mt-1 mono text-[11px] text-[#30D158] truncate">
                    ✓ Resolved: {fedResolvedAddr}
                  </p>
                )}
                {matchedContact && (
                  <p className="mt-1 text-[11px] text-neutral-400">
                    Contact: <span className="text-white font-medium">{matchedContact.name}</span>
                  </p>
                )}
              </div>

              {showScanner && (
                <QrScannerBox
                  onScan={(text) => {
                    handleDestinationChange(text);
                    setShowScanner(false);
                    triggerHaptic("success");
                  }}
                />
              )}

              {/* Fee Tier Selector with Live Surge Stats */}
              <div>
                <label className="field-label">Speed / Network Fee</label>
                <SegmentedControl
                  value={feeTier}
                  onChange={(val) => {
                    triggerHaptic("selection");
                    setFeeTier(val as FeeTier);
                  }}
                  options={[
                    { value: "normal", label: "Normal" },
                    { value: "priority", label: "Priority" },
                    { value: "urgent", label: "Urgent" },
                  ]}
                />
                <p className="flex items-center gap-1.5 pt-1.5 text-[11px] text-neutral-500">
                  {liveFeeStats && (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#30D158]" />
                  )}
                  <span className="mono">
                    Normal {normalStroops} · Priority {priorityStroops} · Urgent {urgentStroops} stroops
                  </span>
                </p>
              </div>

              {/* Memo & Preset Tags */}
              <div>
                <div className="flex items-center justify-between pb-1">
                  <div className="flex items-center gap-2">
                    <label className="field-label !pb-0">Memo (Optional)</label>
                    {memoType === "text" && (
                      <span
                        className={`mono text-[10.5px] font-medium ${
                          memoBytes > 28 ? "text-[#FF453A] font-bold" : memoBytes > 20 ? "text-[#FF9F0A]" : "text-neutral-500"
                        }`}
                      >
                        {memoBytes}/28 bytes
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2 text-[11px]">
                    {(["text", "id", "hash", "return"] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => {
                          triggerHaptic("selection");
                          setMemoType(t);
                        }}
                        className={`capitalize ${
                          memoType === t ? "text-white font-semibold" : "text-neutral-500"
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
                <input
                  type="text"
                  placeholder={
                    memoType === "text"
                      ? "Max 28 bytes"
                      : memoType === "id"
                        ? "Numeric 64-bit integer"
                        : "64-char hex hash"
                  }
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  className={`input text-base sm:text-[13px] ${memoBytes > 28 && memoType === "text" ? "!ring-2 !ring-[#FF453A]" : ""}`}
                />
                {memoType === "text" && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-[10.5px] text-neutral-500">Presets:</span>
                    {[
                      { label: "⚡ Payment", val: "Payment" },
                      { label: "🧾 Invoice", val: "Invoice" },
                      { label: "🎁 Gift", val: "Gift" },
                      { label: "☕ Tip", val: "Tip" },
                    ].map((p) => (
                      <button
                        key={p.val}
                        type="button"
                        onClick={() => {
                          triggerHaptic("selection");
                          setMemo(p.val);
                        }}
                        className={`rounded-md bg-white/[0.06] px-2 py-0.5 text-[10.5px] font-medium transition-colors ${
                          memo === p.val ? "bg-[#0A84FF] text-white font-semibold" : "text-neutral-400 hover:text-white"
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                )}
                {!memo.trim() && (
                  <p className="mt-1.5 text-[11px] text-neutral-400">
                    💡 Sending to an exchange (Binance, Coinbase, etc.)? Enter a Memo ID to prevent lost funds.
                  </p>
                )}
              </div>

              <Button
                className="!mt-6 w-full"
                disabled={!canReview}
                onClick={() => {
                  triggerHaptic("selection");
                  setStage("review");
                }}
              >
                Review Transfer
              </Button>
              {effectiveError && <ErrorText message={effectiveError} />}
          </div>
        )}
      </div>
    </Modal>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 text-[13px]">
      <span className="shrink-0 pt-px text-neutral-400">{label}</span>
      <span className="min-w-0 text-right">{children}</span>
    </div>
  );
}
