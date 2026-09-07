"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { Federation } from "@stellar/stellar-sdk";
import {
  useWalletActivity,
  useWalletContacts,
  useWalletIdentity,
  useWalletLedger,
  useWalletSubmission,
  useWalletTransactions,
} from "@/hooks/useWallet";
import {
  usePrivateBalanceRuntime,
} from "@/hooks/usePrivateBalanceRuntime";
import { isValidPaymentAddress } from "@/lib/vault";
import { NETWORKS } from "@/lib/stellar";
import { parseSep7PayUri, validateSep7PayRequest, type PayUriPayload } from "@/lib/payuri";
import { fmtAmount, isValidAmount, memoByteLength } from "@/lib/format";
import { formatTrezorAddress } from "@/lib/address-display";
import {
  amountToStroops,
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
  bindPublicPaymentReview,
  clearFederationMemoForDestinationChange,
  memoReviewPresentation,
  normalizeFederationMemo,
  requireCurrentPublicPaymentReview,
  resolveRequestedAsset,
  spendableAssetBalance,
  type PublicPaymentReview,
} from "@/lib/transaction-intent";
import { triggerHaptic } from "@/lib/haptics";
import {
  isPrivateReceiveAddressLike,
  isStealthMetaAddressLike,
} from "@/lib/private-address";
import type { SubmissionResult } from "@/lib/submission";
import type { SettlementSweepIntent } from "@/lib/merchant/settlement";
import {
  Button,
  CopyButton,
  ErrorText,
  HashValue,
  LoadingRegion,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  QrScannerBox,
  SegmentedControl,
  Select,
  Spinner,
  Tabs,
} from "./ui";
import { FiatValue } from "./FiatValue";
import { XlmFeeFiatValue } from "./XlmFeeFiatValue";
import {
  IconCheck,
  IconAlert,
  IconExternal,
  IconQrScan,
  IconShieldStellar,
  IconStar,
  IconUsers,
  IconWallet,
  IconTrezor,
  IconLedger,
} from "./icons";
import { IconInfo } from "./merchant/icons";

type Stage = "form" | "review" | "sending" | "cosign" | "done" | "status_unknown";
type MemoType = StellarMemoInput["type"];
type FeeTier = "normal" | "priority" | "urgent";
type StealthReview = Awaited<
  ReturnType<ReturnType<typeof useWalletTransactions>["prepareStealthPayment"]>
>;

const PrivateSend = dynamic(
  () => import("@/features/private-balance/components/SendPrivate").then(
    (module) => module.SendPrivate,
  ),
  {
    ssr: false,
    loading: () => <LoadingRegion label="Opening private payment" />,
  },
);
const PrivatePaymentAccessGate = dynamic(
  () => import("@/features/private-balance/components/PrivatePaymentAccessGate").then(
    (module) => module.PrivatePaymentAccessGate,
  ),
  {
    ssr: false,
    loading: () => <LoadingRegion label="Opening private payment" />,
  },
);

export type SendPrefill = PayUriPayload & {
  settlementIntent?: SettlementSweepIntent;
};

/** Header override an embedded flow reports so the shell shows stage-aware titles. */
export type SendHeader = { title: string; subtitle?: string; onBack?: () => void };

export function SendModal({
  open,
  onClose,
  prefill,
  initialMode = "public",
}: {
  open: boolean;
  onClose: () => void;
  prefill?: SendPrefill | null;
  initialMode?: "public" | "private";
}) {
  const [surfaceBusy, setSurfaceBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [header, setHeader] = useState<SendHeader | null>(null);
  const privateCloseHandler = useRef<(() => void) | null>(null);

  const setPrivateCloseHandler = useCallback((handler: (() => void) | null) => {
    privateCloseHandler.current = handler;
  }, []);

  const requestClose = useCallback(() => {
    const closePrivate = privateCloseHandler.current;
    if (closePrivate) {
      closePrivate();
      return;
    }
    onClose();
  }, [onClose]);

  return (
    <Modal
      open={open}
      onClose={requestClose}
      wide
      busy={surfaceBusy}
      busyReason="Wait for the payment to finish before closing."
      dirty={dirty}
    >
      <ModalHeader
        title={header?.title ?? "Send Payment"}
        subtitle={header ? header.subtitle : "Choose a public or private payment"}
        onBack={header?.onBack}
        onClose={requestClose}
      />
      <SendSurface
        initialMode={initialMode}
        prefill={prefill}
        surfaceBusy={surfaceBusy}
        onClose={onClose}
        onBusyChange={setSurfaceBusy}
        onDirtyChange={setDirty}
        onHeaderChange={setHeader}
        onPrivateCloseHandlerChange={setPrivateCloseHandler}
      />
    </Modal>
  );
}

// Mounted with the shell and unmounted after its exit, so every opening starts
// on the requested mode with a clean form.
function SendSurface({
  initialMode,
  prefill,
  surfaceBusy,
  onClose,
  onBusyChange,
  onDirtyChange,
  onHeaderChange,
  onPrivateCloseHandlerChange,
}: {
  initialMode: "public" | "private";
  prefill?: SendPrefill | null;
  surfaceBusy: boolean;
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
  onDirtyChange: (dirty: boolean) => void;
  onHeaderChange: (header: SendHeader | null) => void;
  onPrivateCloseHandlerChange: (handler: (() => void) | null) => void;
}) {
  const {
    availableAssets,
    requestRuntime,
  } = usePrivateBalanceRuntime();
  const [sendMode, setSendMode] = useState<"public" | "private">(initialMode);
  const [, startRuntimeTransition] = useTransition();
  const [privatePrefill, setPrivatePrefill] = useState<string | undefined>(undefined);
  const privateLeaveHandler = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    if (initialMode === "private") requestRuntime();
  }, [initialMode, requestRuntime]);

  const changeMode = (next: "public" | "private") => {
    if (next === sendMode || surfaceBusy) return;
    const leavePrivate = sendMode === "private" ? privateLeaveHandler.current?.() : null;
    setSendMode(next);
    if (next === "private") startRuntimeTransition(requestRuntime);
    if (leavePrivate) void leavePrivate.catch(() => undefined);
  };
  const openPrivateSend = (address: string) => {
    setPrivatePrefill(address);
    setSendMode("private");
    startRuntimeTransition(requestRuntime);
  };
  const panel = sendMode === "private" ? (
    <PrivatePaymentAccessGate action="send">
      <PrivateSend
        onClose={onClose}
        prefill={privatePrefill ? { recipient: privatePrefill } : undefined}
        showAssetSelector
        embedded
        onCloseHandlerChange={onPrivateCloseHandlerChange}
        onBeforeLeaveChange={(handler) => {
          privateLeaveHandler.current = handler;
        }}
        onWorkingChange={onBusyChange}
        onHeaderChange={onHeaderChange}
      />
    </PrivatePaymentAccessGate>
  ) : (
    <SendInner
      onClose={onClose}
      prefill={prefill}
      openPrivateSend={openPrivateSend}
      onBusyChange={onBusyChange}
      onDirtyChange={onDirtyChange}
      onHeaderChange={onHeaderChange}
    />
  );

  return (
    <Tabs
      value={sendMode}
      onChange={changeMode}
      ariaLabel="Send type"
      activationMode="manual"
      options={[
        { value: "public", label: "Public", disabled: surfaceBusy },
        { value: "private", label: "Private", disabled: surfaceBusy || availableAssets.length === 0 },
      ]}
      panelBusy={surfaceBusy}
      tabListClassName={availableAssets.length > 0 || sendMode === "private" ? "mx-4 mt-4 sm:mx-6" : "hidden"}
      panelClassName="min-h-56"
    >
      {panel}
    </Tabs>
  );
}

function SendInner({
  onClose,
  prefill,
  openPrivateSend,
  onBusyChange,
  onDirtyChange,
  onHeaderChange,
}: {
  onClose: () => void;
  prefill?: SendPrefill | null;
  openPrivateSend(address: string): void;
  onBusyChange(busy: boolean): void;
  onDirtyChange?(dirty: boolean): void;
  onHeaderChange?(header: SendHeader | null): void;
}) {
  const { network, activeAccount, accounts } = useWalletIdentity();
  const { balances, minimumBalanceXlm, recommendedBaseFeeStroops } = useWalletLedger();
  const { contacts } = useWalletContacts();
  const { activity } = useWalletActivity();
  const { submissionStatus } = useWalletSubmission();
  const {
    send,
    captureSigningContext,
    prepareStealthPayment,
    submitStealthPayment,
    prepareCosignPayment,
    cosignTransaction,
    refresh,
  } = useWalletTransactions();
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
  const publicReviewAuthorization = useRef<(() => void) | null>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const resultFocus = useRef(false);
  const confirmButtonRef = useCallback((node: HTMLButtonElement | null) => {
    if (!node) return;
    // Only hand off focus actually owned by this button when it disappears.
    return () => { resultFocus.current = document.activeElement === node; };
  }, []);
  useLayoutEffect(() => {
    const moved = () => { resultFocus.current = false; };
    document.addEventListener("focusin", moved);
    document.addEventListener("pointerdown", moved, true);
    return () => {
      document.removeEventListener("focusin", moved);
      document.removeEventListener("pointerdown", moved, true);
    };
  }, []);
  useLayoutEffect(() => {
    const heading = resultHeading.current;
    if (heading && resultFocus.current && document.activeElement === document.body && !heading.closest("[inert]")) {
      heading.focus({ preventScroll: true });
    }
    resultFocus.current = false;
  }, [stage]);
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
  const [stealthReview, setStealthReview] = useState<StealthReview | null>(null);
  const [publicReview, setPublicReview] = useState<PublicPaymentReview | null>(null);
  const [preparingReview, setPreparingReview] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [resolvingFed, setResolvingFed] = useState(false);
  const [fedResolvedAddr, setFedResolvedAddr] = useState<string | null>(null);
  const federationMemoAppliedRef = useRef(false);
  const amountInputId = useId();
  const amountErrorId = `${amountInputId}-error`;
  const destinationInputId = useId();
  const memoInputId = useId();
  const memoCounterId = `${memoInputId}-counter`;

  const [signerInfo, setSignerInfo] = useState<AccountSignerInfo | null>(null);
  const trackedSubmissionStatus = submission ? submissionStatus(submission) : null;
  const receiptNetwork = submission?.network ?? publicReview?.network ?? stealthReview?.network ?? network;

  useEffect(() => {
    onBusyChange(stage === "sending" || preparingReview);
    return () => onBusyChange(false);
  }, [onBusyChange, preparingReview, stage]);

  // Typed recipient or amount is unsaved input until the review is signed.
  const dirty = stage === "form" && (destination.trim() !== "" || amount.trim() !== "");
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  const backToForm = useCallback(() => {
    setPublicReview(null);
    setError(null);
    setStage("form");
  }, []);
  useLayoutEffect(() => {
    if (!onHeaderChange) return;
    onHeaderChange(sendStageHeader(stage, backToForm));
    return () => onHeaderChange(null);
  }, [backToForm, onHeaderChange, stage]);

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

  // Recent recipients derived from outgoing activity (most recent first)
  const recentRecipients = useMemo(() => {
    const seen = new Map<string, number>();
    for (const a of activity) {
      const cp = a.counterparty;
      if (!cp || a.direction !== "out") continue;
      if (isValidPaymentAddress(cp) && !seen.has(cp)) {
        seen.set(cp, new Date(a.createdAt).getTime());
      }
    }
    return [...seen.keys()].slice(0, 3);
  }, [activity]);

  const isFederation = destination.includes("*");
  // An skpay_/tskpay_ paste is a Private Payments recipient — a regular Stellar
  // payment can never reach it, so offer the one-tap handoff instead.
  const privateDestination = isPrivateReceiveAddressLike(destination);
  // A tsm1/ssm1 reusable handle is funded from the public account, but derives
  // a fresh one-time Stellar destination for every payment.
  const stealthDestination = isStealthMetaAddressLike(destination);

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
  const destOk = isValidPaymentAddress(effectiveDestination) || stealthDestination;
  const matchedContact: Contact | undefined = contacts.find(
    (c) => c.address === effectiveDestination,
  );

  const balance = selectedAsset?.balance ?? "0";

  const memoBytes = memoByteLength(memo);
  const memoOk = stealthDestination
    ? memo.trim() === ""
    : memoType === "text"
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
  const stealthAssetError = stealthDestination && selectedAsset && !selectedAsset.isNative
    ? "Reusable private recipients currently support XLM only. Choose XLM to continue."
    : null;
  const trustlineAuthorizationError =
    selectedAsset && !selectedAsset.isNative && selectedAsset.isAuthorized !== true
      ? selectedAsset.isAuthorizedToMaintainLiabilities
        ? `${selectedAsset.code} is authorized to maintain liabilities only and cannot be sent.`
        : `${selectedAsset.code} is frozen or not authorized by its issuer and cannot be sent.`
      : null;
  const sendError = effectiveError ?? stealthAssetError ?? trustlineAuthorizationError;
  const canReview =
    (destOk || Boolean(fedResolvedAddr)) &&
    amountOk &&
    memoOk &&
    !reserveBlocked &&
    !sendError &&
    !preparingReview;

  // Multisig: warn when our signature alone can't meet the medium threshold
  const myWeight =
    signerInfo && activeAccount
      ? (signerInfo.signers.find((s) => s.key === activeAccount.publicKey)?.weight ?? 0)
      : 1;
  const needsCosigners = signerInfo !== null && signerInfo.thresholds.med_threshold > myWeight;

  const reviewedTotalDebitXlm = stealthReview
    ? stroopsToAmount(BigInt(stealthReview.totalDebitStroops))
    : null;
  const reviewedAmount = stealthReview ? amount : publicReview?.amount ?? amount;
  const reviewedAsset = publicReview?.asset ?? selectedAsset;
  const reviewedBalance = publicReview?.asset.balanceBefore ?? balance;
  const reviewedDestination = stealthReview
    ? destination.trim()
    : publicReview?.destination ?? effectiveDestination;
  const reviewedSourcePublicKey = publicReview?.sourcePublicKey ?? activeAccount?.publicKey ?? "";
  const reviewedAccount = accounts.find((account) => account.publicKey === reviewedSourcePublicKey)
    ?? activeAccount;
  const reviewedContact = contacts.find((contact) => contact.address === reviewedDestination);
  const reviewedMemo = publicReview?.memo ?? (memo.trim()
    ? { type: memoType, value: memo.trim() }
    : undefined);
  const reviewMemo = reviewedMemo
    ? memoReviewPresentation(reviewedMemo.value, reviewedMemo.type)
    : null;
  const reviewNeedsCosigners = stealthReview
    ? needsCosigners
    : publicReview?.needsCosigners ?? needsCosigners;
  const reviewedFeeXlm = stealthReview
    ? stroopsToAmount(BigInt(stealthReview.networkFeeStroops))
    : publicReview
      ? stroopsToAmount(BigInt(publicReview.feeStroops))
      : feeXlm;
  const remainingBalance = reviewedTotalDebitXlm
    ? subtractStellarAmounts(reviewedBalance, [reviewedTotalDebitXlm])
    : isValidAmount(reviewedAmount)
      ? subtractStellarAmounts(
          reviewedBalance,
          [reviewedAmount, ...(reviewedAsset?.isNative ? [reviewedFeeXlm] : [])],
        )
      : reviewedBalance;

  async function handleReview() {
    if (!stealthDestination) {
      if (!selectedAsset || !activeAccount) return;
      try {
        publicReviewAuthorization.current = captureSigningContext();
      } catch {
        setError("Wallet context changed. Review the payment again before signing.");
        return;
      }
      const paymentMemo: StellarMemoInput | undefined = memo.trim()
        ? { type: memoType, value: memo.trim() }
        : undefined;
      setPublicReview(bindPublicPaymentReview({
        sourcePublicKey: activeAccount.publicKey,
        network,
        destination: effectiveDestination,
        amount,
        asset: {
          key: selectedAsset.key,
          code: selectedAsset.code,
          issuer: selectedAsset.issuer,
          isNative: selectedAsset.isNative,
          balanceBefore: selectedAsset.balance,
        },
        memo: paymentMemo,
        feeStroops,
        needsCosigners,
      }));
      setStealthReview(null);
      setStage("review");
      return;
    }
    if (!selectedAsset?.isNative || minimumBalanceXlm === null || !activeAccount) return;
    setPreparingReview(true);
    setError(null);
    try {
      setPublicReview(null);
      const review = await prepareStealthPayment({
        metaAddress: destination.trim(),
        amount,
        feeStroops,
      });
      const spendableBeforeTransactionCosts = spendableAssetBalance(
        selectedAsset,
        [minimumBalanceXlm],
      );
      const fullDebit = stroopsToAmount(BigInt(review.totalDebitStroops));
      if (compareStellarAmounts(fullDebit, spendableBeforeTransactionCosts) > 0) {
        throw new Error(
          `This payment needs ${fmtAmount(fullDebit)} XLM including the recipient reserve and network fee.`,
        );
      }
      setStealthReview(review);
      setStage("review");
    } catch (cause) {
      setStealthReview(null);
      setError(cause instanceof Error ? cause.message : "Could not prepare this private recipient.");
      triggerHaptic("error");
    } finally {
      setPreparingReview(false);
    }
  }

  async function handleConfirm() {
    if (!selectedAsset) return;
    setStage("sending");
    setError(null);
    try {
      if (stealthDestination) {
        if (
          !stealthReview ||
          stealthReview.metaAddress !== destination.trim() ||
          stealthReview.amountStroops !== amountToStroops(amount).toString() ||
          stealthReview.network !== network ||
          stealthReview.sourcePublicKey !== activeAccount?.publicKey
        ) {
          throw new Error("Payment details changed. Review the reusable recipient again.");
        }
        if (needsCosigners) {
          const outcome = await cosignTransaction(stealthReview.envelopeXdr, network);
          if (!outcome.submission) {
            setCosignXdr(outcome.xdr);
            setStage("cosign");
            triggerHaptic("success");
            return;
          }
          setHash(outcome.submission.hash);
          setSubmission(outcome.submission);
          if (outcome.submission.status === "status_unknown") {
            setStage("status_unknown");
            triggerHaptic("warning");
            return;
          }
        } else {
          const result = await submitStealthPayment(stealthReview);
          setHash(result.hash);
          setSubmission(result);
          if (result.status === "status_unknown") {
            setStage("status_unknown");
            triggerHaptic("warning");
            return;
          }
        }
        setStage("done");
        triggerHaptic("success");
        window.setTimeout(() => void refresh(), 4000);
        return;
      }
      const reviewed = requireCurrentPublicPaymentReview(publicReview, {
        sourcePublicKey: activeAccount?.publicKey ?? "",
        network,
      });
      const authorizeBeforeSigning = publicReviewAuthorization.current;
      if (!authorizeBeforeSigning) throw new Error("Review this payment before signing it.");
      authorizeBeforeSigning();
      if (reviewed.needsCosigners) {
        // Multi-sig account: collect our signature, share the envelope instead of submitting
        const result = await prepareCosignPayment({
          destination: reviewed.destination,
          amount: reviewed.amount,
          assetCode: reviewed.asset.code,
          issuer: reviewed.asset.issuer ?? undefined,
          memo: reviewed.memo,
          feeStroops: reviewed.feeStroops,
          authorizeBeforeSigning,
        });
        setCosignXdr(result.xdr);
        setStage("cosign");
        triggerHaptic("success");
        return;
      }
      const result = await send({
        destination: reviewed.destination,
        amount: reviewed.amount,
        assetCode: reviewed.asset.code,
        issuer: reviewed.asset.issuer ?? undefined,
        memo: reviewed.memo,
        feeStroops: reviewed.feeStroops,
        authorizeBeforeSigning,
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
    setStealthReview(null);
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
    if (isStealthMetaAddressLike(raw)) {
      setMemo("");
      setMemoType("text");
      federationMemoAppliedRef.current = false;
    }
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

  const knownSelected = reviewedAsset
    ? lookupKnownAsset(reviewedAsset.code, reviewedAsset.issuer, receiptNetwork)
    : null;

  return (
    <ModalBody>
        {stage === "done" ? (
          <div className="flex flex-col items-center py-4">
            <span className="flex h-16 w-16 items-center justify-center rounded-full border border-[#30D158]/30 bg-[#30D158]/10 text-[#30D158]">
              <IconCheck size={28} />
            </span>
            <h2 ref={resultHeading} tabIndex={-1} className="display-h mt-4 text-xl font-light text-white outline-none">
              {trackedSubmissionStatus === "confirmed" ? "Payment Confirmed" : "Payment Accepted"}
            </h2>
            <p className="mt-1 text-[13px] text-neutral-400">
              {trackedSubmissionStatus === "confirmed"
                ? "The payment is confirmed on-chain."
                : "Horizon accepted the transaction. Confirmation tracking continues in the dashboard."}
            </p>
            {hash && (
              <a
                className="chip mt-4 min-h-11"
                href={NETWORKS[receiptNetwork].explorerTxUrl(hash)}
                target="_blank"
                rel="noopener noreferrer"
              >
                View on Explorer <IconExternal size={11} />
              </a>
            )}
            <ModalFooter className="w-full" primary={<Button onClick={onClose}>Done</Button>} />
          </div>
        ) : stage === "status_unknown" ? (
          <div className="flex flex-col items-center py-4 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full border border-[#FF9F0A]/30 bg-[#FF9F0A]/10 text-[#FF9F0A]">
              <IconAlert size={28} />
            </span>
            <h2 ref={resultHeading} tabIndex={-1} className="display-h mt-4 text-xl font-light text-white outline-none">Submission Status Unknown</h2>
            <p className="mt-2 max-w-md text-[13px] leading-relaxed text-neutral-300">
              Horizon did not confirm whether it accepted this transaction. Do not resubmit blindly.
              The wallet will keep checking the canonical hash.
            </p>
            {hash && (
              <p className="mt-4 w-full break-all rounded-xl bg-white/[0.04] p-3 font-mono text-[10.5px] text-neutral-300">
                {receiptNetwork} · {hash}
              </p>
            )}
            <ModalFooter className="w-full" primary={<Button onClick={onClose}>Done</Button>} />
          </div>
        ) : stage === "cosign" ? (
          <div className="flex flex-col items-center py-2 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full border border-[#FF9F0A]/30 bg-[#FF9F0A]/10 text-[#FF9F0A]">
              <IconUsers size={26} />
            </span>
            <h2 ref={resultHeading} tabIndex={-1} className="display-h mt-4 text-xl font-light text-white outline-none">Awaiting Cosigners</h2>
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
              className="chip mt-3 min-h-11 w-full justify-center"
            />
            <p className="mt-2.5 text-[11px] leading-relaxed text-neutral-500">
              Cosigners open Multi-Sig Studio → Approvals, paste the envelope, and sign — it
              submits automatically once the threshold is met.
            </p>
            <ModalFooter className="w-full" primary={<Button onClick={onClose}>Done</Button>} />
          </div>
        ) : stage === "review" || stage === "sending" ? (
          <div>
            <div className="flex flex-col items-center pb-2">
              <p className="display-h text-[36px] text-white">
                {fmtAmount(reviewedAmount)}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <span
                  className="mono rounded-full px-2.5 py-1 text-[10px] font-bold"
                  style={
                    knownSelected
                      ? { background: knownSelected.color, color: "#fff" }
                      : reviewedAsset?.isNative
                        ? { background: "#fdda24", color: "#0d0d0d" }
                        : { background: "rgba(255,255,255,0.08)", color: "#fff" }
                  }
                >
                  {reviewedAsset?.code}
                </span>
                {knownSelected && (
                  <span className="text-[12px] text-neutral-400">{knownSelected.name}</span>
                )}
              </div>
              <FiatValue
                amount={reviewedAmount}
                code={reviewedAsset?.code ?? "XLM"}
                issuer={reviewedAsset?.issuer ?? undefined}
                isNative={reviewedAsset?.isNative}
                className="mt-2 text-[13px] text-neutral-400"
              />
            </div>

            <div className="panel-inset mt-6 divide-y divide-white/[0.08] px-4">
              <Row label="To">
                <HashValue
                  value={reviewedDestination}
                  className="justify-end text-[12px] text-white"
                />
              </Row>
              {stealthReview && (
                <Row label="One-time account">
                  <HashValue
                    value={stealthReview.destinationPublicKey}
                    className="justify-end text-[12px] text-neutral-300"
                  />
                </Row>
              )}
              {isFederation && (
                <Row label="Federation">
                  <span className="text-[13px] text-white">{destination}</span>
                </Row>
              )}
              {reviewedContact && (
                <Row label="Contact">
                  <span className="text-[13px] text-white">{reviewedContact.name}</span>
                </Row>
              )}
              {!reviewedAsset?.isNative && (
                <Row label="Issuer">
                  <HashValue
                    value={reviewedAsset?.issuer ?? ""}
                    className="justify-end text-[12px] text-neutral-300"
                  />
                </Row>
              )}
              {reviewMemo && (
                <Row label={reviewMemo.label}>
                  <span className="text-[13px] text-white">{reviewMemo.value}</span>
                </Row>
              )}
              {stealthReview && (
                <Row label="Recipient reserve">
                  <span className="mono text-[13px] text-neutral-300">
                    {stroopsToAmount(BigInt(stealthReview.reserveStroops))} XLM
                  </span>
                </Row>
              )}
              {stealthReview && (
                <Row label="Sweep fee buffer">
                  <span className="flex flex-col items-end text-[13px] text-neutral-300">
                    <span className="mono">
                      {stroopsToAmount(BigInt(stealthReview.sweepFeeBufferStroops))} XLM
                    </span>
                    <XlmFeeFiatValue
                      amount={stroopsToAmount(BigInt(stealthReview.sweepFeeBufferStroops))}
                    />
                  </span>
                </Row>
              )}
              {stealthReview && (
                <Row label="Announcement">
                  <span className="mono text-[13px] text-neutral-300">
                    {stroopsToAmount(BigInt(stealthReview.announcementStroops))} XLM
                  </span>
                </Row>
              )}
              <Row label="Network Fee">
                <span className="flex flex-col items-end text-[13px] text-neutral-300">
                  <span className="mono">
                    {reviewedFeeXlm} XLM <span className="text-[11px] text-neutral-500">({stealthReview?.networkFeeStroops ?? publicReview?.feeStroops ?? feeStroops} stroops)</span>
                  </span>
                  <XlmFeeFiatValue amount={reviewedFeeXlm} />
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
                <span className="mono">{fmtAmount(reviewedBalance)} {reviewedAsset?.code}</span>
              </div>
              <div className="flex justify-between text-[#FF453A]">
                <span>Transfer Amount</span>
                <span className="mono">−{fmtAmount(reviewedAmount)} {reviewedAsset?.code}</span>
              </div>
              {reviewedAsset?.isNative && (
                <div className="flex justify-between text-neutral-400">
                  <span>Network Gas Fee</span>
                  <span className="flex flex-col items-end">
                    <span className="mono">−{reviewedFeeXlm} XLM</span>
                    <XlmFeeFiatValue amount={reviewedFeeXlm} />
                  </span>
                </div>
              )}
              {stealthReview && (
                <>
                  <div className="flex justify-between text-neutral-400">
                    <span>Recipient Reserve</span>
                    <span className="mono">
                      −{stroopsToAmount(BigInt(stealthReview.reserveStroops))} XLM
                    </span>
                  </div>
                  <div className="flex justify-between text-neutral-400">
                    <span>Private Announcement</span>
                    <span className="mono">
                      −{stroopsToAmount(BigInt(stealthReview.announcementStroops))} XLM
                    </span>
                  </div>
                  <div className="flex justify-between text-neutral-400">
                    <span>Sweep Fee Buffer</span>
                    <span className="flex flex-col items-end">
                      <span className="mono">
                        −{stroopsToAmount(BigInt(stealthReview.sweepFeeBufferStroops))} XLM
                      </span>
                      <XlmFeeFiatValue
                        amount={stroopsToAmount(BigInt(stealthReview.sweepFeeBufferStroops))}
                      />
                    </span>
                  </div>
                </>
              )}
              <div className="border-t border-white/10 pt-1.5 flex justify-between font-semibold text-white">
                <span>Balance After</span>
                <span className="mono">{remainingBalance} {reviewedAsset?.code}</span>
              </div>
            </div>

            {stealthReview && (
              <div className="mt-3 rounded-2xl border border-[#5E5CE6]/30 bg-[#5E5CE6]/10 p-3.5 text-[11.5px] leading-relaxed text-neutral-300">
                <p className="font-semibold text-white">Fresh address for this payment</p>
                <p className="mt-1">
                  The reusable recipient is not placed on-chain. This public funding transaction
                  permanently reveals your account, the amount, and its timing. Later activity can
                  be private after the recipient moves the funds into Private Balance.
                </p>
                <p className="mt-1 text-neutral-400">
                  The funded sweep buffer covers the wallet&apos;s full reviewed Private Balance fee
                  cap. If the one-time account cannot preserve its reserve and that fee budget, the
                  recipient wallet refuses before signing.
                </p>
              </div>
            )}

            {/* Multi-sig cosigner requirement warning */}
            {reviewNeedsCosigners && (
              <div className="mt-3 flex items-start gap-2.5 rounded-2xl border border-[#FF9F0A]/30 bg-[#FF9F0A]/10 p-3.5 text-[12px] leading-relaxed text-[#FF9F0A]">
                <IconUsers size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>
                  <strong>Multi-signature account.</strong> Your signature weight ({myWeight}) is
                  below the required threshold ({signerInfo?.thresholds.med_threshold}). Additional
                  signatures are needed before this transaction reaches the ledger.
                </span>
              </div>
            )}

            {/* Hardware Security Badge */}
            {reviewedAccount?.hardware && (
              <div className="panel-inset mt-3 p-3 flex items-center justify-between bg-[#0A84FF]/[0.08] border border-[#0A84FF]/30 text-[12px]">
                <div className="flex items-center gap-2 text-[#0A84FF]">
                  {reviewedAccount.hardware === "ledger" ? (
                    <IconLedger size={16} className="text-[#64D2FF]" />
                  ) : (
                    <IconTrezor size={16} className="text-emerald-400" />
                  )}
                  <span className="font-semibold">
                    Confirm &amp; Sign on {reviewedAccount.hardware === "ledger" ? "Ledger" : "Trezor"} Hardware Device
                  </span>
                </div>
                <span className="mono text-[11px] text-neutral-400">
                  {reviewedAccount.path ?? "Path unavailable"}
                </span>
              </div>
            )}

            {/* Hardware signing pending hint */}
            {stage === "sending" && reviewedAccount?.hardware && (
              <div className="mt-3 flex items-center gap-2.5 rounded-2xl border border-[#FF9F0A]/30 bg-[#FF9F0A]/10 p-3 text-[12px] leading-relaxed text-[#FF9F0A]">
                <Spinner size={13} />
                <span>
                  Waiting for your {reviewedAccount.hardware === "ledger" ? "Ledger" : "Trezor"}{" "}
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


            {sendError && (
              <div className="mt-4">
                <ErrorText message={sendError} />
              </div>
            )}

            <ModalFooter
              primary={
                <Button
                  ref={confirmButtonRef}
                  loading={stage === "sending"}
                  focusableWhenDisabled
                  loadingLabel={reviewNeedsCosigners ? "Signing transaction" : "Sending payment"}
                  disabled={stage === "sending"}
                  onClick={() => void handleConfirm()}
                >
                  {reviewNeedsCosigners ? "Sign & Share for Approval" : "Confirm Send"}
                </Button>
              }
            />
          </div>
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
                <span className="field-label">Asset</span>
                  <Select
                    value={effectiveAssetKey}
                    onChange={(value) => {
                      setUsePendingPrefillAsset(false);
                      setAssetKey(value);
                      setStealthReview(null);
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
                    <label htmlFor={amountInputId} className="field-label !pb-0">Amount</label>
                    {selectedAsset && (
                      <button
                        type="button"
                        onClick={() => {
                          setStealthReview(null);
                          setAmount(maxSendable);
                        }}
                        className="min-h-11 rounded-lg px-2 text-[12px] font-medium text-[#0A84FF]"
                      >
                        Max: {fmtAmount(maxSendable)} {selectedAsset.code}
                      </button>
                    )}
                  </div>
                  <input
                    id={amountInputId}
                    type="text"
                    inputMode="decimal"
                    enterKeyHint="next"
                    autoComplete="off"
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => {
                      setAmount(e.target.value.replace(/,/g, "."));
                      setStealthReview(null);
                    }}
                    className="input mono text-base sm:text-[15px]"
                    aria-invalid={reserveBlocked || undefined}
                    aria-describedby={reserveBlocked ? amountErrorId : undefined}
                  />
                  <FiatValue
                    amount={amount}
                    code={selectedAsset?.code ?? "XLM"}
                    issuer={selectedAsset?.issuer}
                    isNative={selectedAsset?.isNative}
                    className="mt-1 block text-[11.5px] text-neutral-500"
                  />
                  {reserveBlocked && (
                    <p id={amountErrorId} role="alert" className="mt-1 text-[11.5px] text-[#FF453A]">
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
                      setStealthReview(null);
                      setAmount(String(val));
                    }}
                    className="min-h-11 rounded-xl bg-white/[0.06] px-3.5 text-[12px] font-medium text-neutral-300 hover:bg-white/[0.12]"
                  >
                    {val}
                  </button>
                ))}
                {selectedAsset && (
                  <button
                    type="button"
                    onClick={() => {
                      setStealthReview(null);
                      setAmount(maxSendable);
                    }}
                    className="min-h-11 rounded-xl border border-[#0A84FF]/30 bg-[#0A84FF]/15 px-3.5 text-[12px] font-bold text-accent-2"
                  >
                    MAX
                  </button>
                )}
              </div>
              {/* Destination */}
              <div>
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 pb-1">
                  <label htmlFor={destinationInputId} className="field-label !pb-0">Recipient Address or Federation</label>
                  <button
                    type="button"
                    aria-expanded={showScanner}
                    onClick={() => setShowScanner((s) => !s)}
                    className="flex min-h-11 items-center gap-1 rounded-lg px-2 text-[12px] font-medium text-[#0A84FF]"
                  >
                    <IconQrScan size={13} />
                    <span>{showScanner ? "Hide QR Input" : "Paste QR Payload"}</span>
                  </button>
                </div>
                <input
                  id={destinationInputId}
                  type="text"
                  placeholder="G…, user*domain.com, or tsm…"
                  value={destination}
                  onChange={(e) => handleDestinationChange(e.target.value)}
                  className="input mono text-base sm:text-[13px]"
                  spellCheck={false}
                  autoCapitalize="none"
                  autoComplete="off"
                  enterKeyHint="next"
                />

                {/* Private-address handoff card */}
                {privateDestination && (
                  <div className="fade-up mt-2 rounded-2xl border border-[#0A84FF]/30 bg-[#0A84FF]/10 p-3.5">
                    <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-white">
                      <IconShieldStellar size={16} className="shrink-0 text-[#0A84FF]" />
                      <span>This is a private address</span>
                    </p>
                    <p className="mt-1 text-[11.5px] leading-relaxed text-neutral-300">
                      Regular payments can&rsquo;t reach it. Continue in Private Payments and
                      the amount and recipient stay encrypted.
                    </p>
                    <Button
                      className="mt-2.5 w-full"
                      onClick={() => openPrivateSend(destination.trim())}
                    >
                      Send Privately
                    </Button>
                  </div>
                )}

                {stealthDestination && (
                  <div className="fade-up mt-2 rounded-2xl border border-[#5E5CE6]/30 bg-[#5E5CE6]/10 p-3.5">
                    <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-white">
                      <IconShieldStellar size={16} className="shrink-0 text-[#BF5AF2]" />
                      <span>Reusable private recipient</span>
                    </p>
                    <p className="mt-1 text-[11.5px] leading-relaxed text-neutral-300">
                      A fresh one-time Stellar account is created for this payment. The reusable
                      handle is not written to the ledger; the sender, amount, and timing remain public.
                    </p>
                  </div>
                )}

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
                          onClick={() => handleDestinationChange(acc.publicKey)}
                          className="chip min-h-11 border border-[#0A84FF]/25 bg-[#0A84FF]/10 font-medium text-neutral-200 hover:text-white"
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
                          onClick={() => handleDestinationChange(c.address)}
                          className={`chip min-h-11 transition-[background-color,color,border-color,box-shadow] ${
                            c.favorite
                              ? "border border-[#FFD60A]/30 bg-[#FFD60A]/15 font-medium text-white"
                              : "text-neutral-300 hover:text-white"
                          }`}
                        >
                          {c.favorite && <IconStar size={11} className="shrink-0 text-[#FFD60A]" />}
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
                        onClick={() => handleDestinationChange(addr)}
                        className="chip min-h-11 text-neutral-300 hover:text-white"
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
                  <p className="mono mt-1 flex items-center gap-1 text-[11px] text-[#30D158]">
                    <IconCheck size={11} className="shrink-0" aria-hidden="true" />
                    <span className="truncate">Resolved: {fedResolvedAddr}</span>
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
                  }}
                />
              )}

              {/* Fee Tier Selector with Live Surge Stats */}
              <div>
                <span className="field-label">Speed / Network Fee</span>
                <SegmentedControl
                  ariaLabel="Speed and network fee"
                  value={feeTier}
                  onChange={(val) => {
                    setStealthReview(null);
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
                <p className="pt-1 text-[11px] text-neutral-500">
                  Selected {feeXlm} XLM · <XlmFeeFiatValue amount={feeXlm} />
                </p>
              </div>

              {/* Memo & Preset Tags */}
              {stealthDestination ? (
                <div className="panel-inset p-3.5 text-[11.5px] leading-relaxed text-neutral-300">
                  <p className="font-semibold text-white">Memo managed automatically</p>
                  <p className="mt-1">
                    StellarKey uses the transaction memo to announce the one-time account securely.
                  </p>
                </div>
              ) : <div>
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 pb-1">
                  <div className="flex items-center gap-2">
                    <label htmlFor={memoInputId} className="field-label !pb-0">Memo (Optional)</label>
                    {memoType === "text" && (
                      <span
                        id={memoCounterId}
                        className={`mono text-[10.5px] font-medium ${
                          memoBytes > 28 ? "text-[#FF453A] font-bold" : memoBytes > 20 ? "text-[#FF9F0A]" : "text-neutral-500"
                        }`}
                      >
                        {memoBytes}/28 bytes
                      </span>
                    )}
                  </div>
                  <div role="group" aria-label="Memo type" className="flex gap-1">
                    {(["text", "id", "hash", "return"] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        aria-pressed={memoType === t}
                        onClick={() => setMemoType(t)}
                        className={`min-h-11 rounded-lg px-2 text-[12px] capitalize ${
                          memoType === t ? "font-semibold text-white" : "text-neutral-500"
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
                <input
                  id={memoInputId}
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
                  autoComplete="off"
                  inputMode={memoType === "id" ? "numeric" : undefined}
                  enterKeyHint="done"
                  aria-describedby={memoType === "text" ? memoCounterId : undefined}
                  aria-invalid={memoType === "text" && memoBytes > 28 ? true : undefined}
                  className={`input text-base sm:text-[13px] ${memoBytes > 28 && memoType === "text" ? "!ring-2 !ring-[#FF453A]" : ""}`}
                />
                {memoType === "text" && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-[12px] text-neutral-500">Presets:</span>
                    {["Payment", "Invoice", "Gift", "Tip"].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        aria-pressed={memo === preset}
                        onClick={() => setMemo(preset)}
                        className={`min-h-11 rounded-lg px-3 text-[12px] font-medium transition-colors ${
                          memo === preset ? "bg-[#0A84FF] font-semibold text-white" : "bg-white/[0.06] text-neutral-400 hover:text-white"
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                )}
                {!memo.trim() && (
                  <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-neutral-400">
                    <IconInfo size={13} className="mt-px shrink-0" aria-hidden="true" />
                    <span>Sending to an exchange (Binance, Coinbase, etc.)? Enter a Memo ID to prevent lost funds.</span>
                  </p>
                )}
              </div>}

              {sendError && <ErrorText message={sendError} />}
              <ModalFooter
                primary={
                  <Button
                    disabled={!canReview}
                    loading={preparingReview}
                    loadingLabel="Preparing transfer review"
                    onClick={() => void handleReview()}
                  >
                    Review Transfer
                  </Button>
                }
              />
          </div>
        )}
    </ModalBody>
  );
}

/** Stage-aware header the shell renders; the form keeps the shell's default. */
function sendStageHeader(stage: Stage, backToForm: () => void): SendHeader | null {
  switch (stage) {
    case "form":
      return null;
    case "review":
      return {
        title: "Send Payment",
        subtitle: "Review before signing · Step 2 of 2",
        onBack: backToForm,
      };
    case "sending":
      return { title: "Send Payment", subtitle: "Signing and sending…", onBack: backToForm };
    case "cosign":
      return { title: "Signature Collected", subtitle: "Share the envelope with a cosigner" };
    case "status_unknown":
      return { title: "Payment Status", subtitle: "Tracking the canonical hash" };
    case "done":
      return { title: "Payment Sent" };
  }
}

/** Favourite marker on contact chips; `./icons` has no star glyph yet. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 text-[13px]">
      <span className="shrink-0 pt-px text-neutral-400">{label}</span>
      <span className="min-w-0 text-right">{children}</span>
    </div>
  );
}
