"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import { useToast } from "./Toast";
import { fetchAccountSignerInfo, type AccountSignerInfo } from "@/lib/api";
import { isValidPublicAddress } from "@/lib/vault";
import {
  hasAdditionalSignerCapacity,
  totalWeight,
  explainTransaction,
  type CosignOutcome,
  type MultisigConfigOutcome,
  type TxExplanation,
} from "@/lib/multisig";
import { triggerHaptic } from "@/lib/haptics";
import {
  EXACT_REVIEW_VALUE_CLASS,
  reviewedEnvelopeForSigning,
} from "@/lib/transaction-review";
import {
  approvalSubmissionGuard,
  configSubmissionAfterResolution,
  type SubmissionResult,
} from "@/lib/submission";
import {
  Avatar,
  Button,
  CopyButton,
  ErrorText,
  HashValue,
  Modal,
  ModalHeader,
  Notice,
  SegmentedControl,
  Spinner,
} from "./ui";
import {
  IconAlert,
  IconCheck,
  IconShield,
  IconTrash,
  IconUserPlus,
  IconUsers,
} from "./icons";

type Tab = "overview" | "configure" | "approvals";

interface CosignerDraft {
  key: string;
  weight: number;
}

interface ApprovalReviewBinding {
  xdr: string;
  network: "mainnet" | "testnet";
  explanation: TxExplanation;
}

interface SignerInfoBinding {
  accountPublicKey: string;
  network: "mainnet" | "testnet";
  info: AccountSignerInfo | null;
}

export function MultiSigStudioModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;
  return <StudioInner onClose={onClose} />;
}

function StudioInner({ onClose }: { onClose: () => void }) {
  const {
    activeAccount,
    network,
    contacts,
    applyMultisigConfig,
    disableMultisig,
    cosignTransaction,
    submissionStatus,
    envelopeSubmissionStatus,
    pendingTxs,
  } = useWallet();
  const { toast } = useToast();

  const [tab, setTab] = useState<Tab>("overview");
  const [infoBinding, setInfoBinding] = useState<SignerInfoBinding | null>(null);
  const signerInfoRequestGeneration = useRef(0);
  const signerInfoIdentity = `${activeAccount?.publicKey ?? ""}:${network}`;
  const signerInfoIdentityRef = useRef(signerInfoIdentity);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Configure state
  const [ownWeight, setOwnWeight] = useState(1);
  const [cosigners, setCosigners] = useState<CosignerDraft[]>([]);
  const [newKey, setNewKey] = useState("");
  const [preset, setPreset] = useState<"any" | "majority" | "all" | "custom">("majority");
  const [customLow, setCustomLow] = useState(2);
  const [customMed, setCustomMed] = useState(2);
  const [customHigh, setCustomHigh] = useState(2);
  const [reviewing, setReviewing] = useState(false);
  const [disableConfirm, setDisableConfirm] = useState(false);
  const [configSubmission, setConfigSubmission] = useState<SubmissionResult | null>(null);
  const [configOutcome, setConfigOutcome] = useState<MultisigConfigOutcome | null>(null);

  // Approvals state
  const [xdrInput, setXdrInput] = useState("");
  const [reviewBinding, setReviewBinding] = useState<ApprovalReviewBinding | null>(null);
  const [reviewClockMs, setReviewClockMs] = useState(() => Date.now());
  const [outcome, setOutcome] = useState<CosignOutcome | null>(null);
  const trackedConfigStatus = configSubmission ? submissionStatus(configSubmission) : null;
  const trackedCosignStatus = outcome?.submission
    ? submissionStatus(outcome.submission)
    : null;
  const trackedEnvelopeStatus = envelopeSubmissionStatus(xdrInput, network);
  const approvalGuardMessage = approvalSubmissionGuard(trackedEnvelopeStatus);
  // Pending recovery handles intentionally carry no account authority. Until
  // Horizon resolves a config transaction, conservatively lock signer changes
  // for this network rather than guess which account a restored handle owns.
  const pendingMultisigConfig = pendingTxs.some(
    (transaction) =>
      transaction.network === network &&
      (transaction.label === "Multi-sig update" || transaction.label === "Multi-sig disabled"),
  );
  const configLocked = Boolean(configSubmission) || pendingMultisigConfig;
  const [networkConfirmed, setNetworkConfirmed] = useState(false);
  const reviewRequestGeneration = useRef(0);
  const review = reviewedEnvelopeForSigning(reviewBinding, xdrInput, network)
    ? reviewBinding?.explanation ?? null
    : null;
  const reviewExpired = Boolean(
    review?.expiresAt !== undefined && review.expiresAt * 1000 <= reviewClockMs,
  );
  const reviewExpiryLabel = review?.expiresAt === undefined
    ? ""
    : reviewExpired
      ? "Expired"
      : `in ~${Math.max(1, Math.round((review.expiresAt * 1000 - reviewClockMs) / 60000))} min`;

  useEffect(() => {
    reviewRequestGeneration.current += 1;
  }, [network]);

  useEffect(() => {
    signerInfoIdentityRef.current = signerInfoIdentity;
  }, [signerInfoIdentity]);

  useEffect(() => {
    if (review?.expiresAt === undefined) return;
    const timer = window.setInterval(() => setReviewClockMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [review?.expiresAt]);

  const loadInfo = useCallback(async () => {
    if (!activeAccount) return;
    const requestedAccountPublicKey = activeAccount.publicKey;
    const requestedNetwork = network;
    const requestedIdentity = `${requestedAccountPublicKey}:${requestedNetwork}`;
    if (requestedIdentity !== signerInfoIdentityRef.current) return;
    const requestGeneration = ++signerInfoRequestGeneration.current;
    let result: AccountSignerInfo | null = null;
    try {
      result = await fetchAccountSignerInfo(requestedAccountPublicKey, requestedNetwork);
    } catch {
      // Network and malformed-response failures share the same fail-closed UI state.
    }
    if (
      requestGeneration !== signerInfoRequestGeneration.current ||
      requestedIdentity !== signerInfoIdentityRef.current
    ) {
      return;
    }
    setInfoBinding({
      accountPublicKey: requestedAccountPublicKey,
      network: requestedNetwork,
      info: result,
    });
  }, [activeAccount, network]);

  const loadInfoRef = useRef(loadInfo);
  useEffect(() => {
    loadInfoRef.current = loadInfo;
  }, [loadInfo]);

  useEffect(() => {
    void loadInfoRef.current();
    return () => {
      signerInfoRequestGeneration.current += 1;
    };
  }, [loadInfo]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      await Promise.resolve();
      if (!alive) return;
      if (trackedConfigStatus === "confirmed") {
        setConfigSubmission((current) =>
          configSubmissionAfterResolution(current, trackedConfigStatus));
        setConfigOutcome(null);
        setTab("overview");
        void loadInfoRef.current();
        return;
      }
      if (trackedConfigStatus === "failed") {
        setConfigSubmission((current) =>
          configSubmissionAfterResolution(current, trackedConfigStatus));
        setError("Multi-sig configuration failed on-chain. Review it and retry when ready.");
        triggerHaptic("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, [trackedConfigStatus]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      await Promise.resolve();
      if (!alive || trackedEnvelopeStatus !== "failed") return;
      setOutcome(null);
      setError("Co-signed transaction failed on-chain. Review the envelope before retrying.");
      triggerHaptic("error");
    })();
    return () => {
      alive = false;
    };
  }, [trackedEnvelopeStatus]);

  const infoBindingIsCurrent = Boolean(
    activeAccount &&
      infoBinding &&
      infoBinding.accountPublicKey === activeAccount.publicKey &&
      infoBinding.network === network,
  );
  const info = infoBindingIsCurrent ? infoBinding?.info ?? null : null;
  const infoLoading = !infoBindingIsCurrent;
  const signerInfoUnavailable = !infoLoading && !info;
  const ownKey = activeAccount?.publicKey ?? "";
  const existingCosigners = useMemo(
    () => (info?.signers ?? []).filter((s) => s.key !== ownKey),
    [info, ownKey],
  );
  const isMultisig = existingCosigners.length > 0;
  const total = info ? totalWeight(info.signers) : 1;
  const required = info?.thresholds.med_threshold ?? 1;

  /** Seed the Configure form from the on-chain state. */
  function openConfigure() {
    if (configLocked) {
      setError("A multi-sig configuration is still being tracked. Wait for its final status before changing signers again.");
      return;
    }
    if (!info) {
      setError("Signer configuration must be verified before it can be changed.");
      return;
    }
    triggerHaptic("selection");
    setOwnWeight(info.signers.find((s) => s.key === ownKey)?.weight ?? 1);
    setCosigners(
      existingCosigners.map((s) => ({ key: s.key, weight: s.weight })),
    );
    setReviewing(false);
    setError(null);
    setTab("configure");
  }

  function addCosigner(key: string) {
    const k = key.trim();
    if (!hasAdditionalSignerCapacity(cosigners.length)) {
      setError("A Stellar account can have at most 20 additional signers.");
      return;
    }
    if (!isValidPublicAddress(k)) {
      setError("Enter a valid Stellar address (starts with G).");
      return;
    }
    if (k === ownKey) {
      setError("That's this device's own key — it's already a signer.");
      return;
    }
    if (cosigners.some((c) => c.key === k)) {
      setError("That signer is already in the list.");
      return;
    }
    triggerHaptic("selection");
    setCosigners((prev) => [...prev, { key: k, weight: 1 }]);
    setNewKey("");
    setError(null);
  }

  const draftTotal = ownWeight + totalWeight(cosigners);

  const thresholds = useMemo(() => {
    if (preset === "any") return { low: 1, medium: 1, high: draftTotal };
    if (preset === "all") return { low: draftTotal, medium: draftTotal, high: draftTotal };
    if (preset === "majority") {
      const m = Math.floor(draftTotal / 2) + 1;
      return { low: m, medium: m, high: m };
    }
    return { low: customLow, medium: customMed, high: customHigh };
  }, [preset, draftTotal, customLow, customMed, customHigh]);

  const configValid =
    cosigners.length > 0 &&
    thresholds.low <= thresholds.medium &&
    thresholds.medium <= thresholds.high &&
    thresholds.high <= draftTotal;

  async function handleApply() {
    if (configLocked) return;
    setBusy(true);
    setError(null);
    try {
      const result = await applyMultisigConfig({
        signers: [{ key: ownKey, weight: ownWeight }, ...cosigners],
        low: thresholds.low,
        medium: thresholds.medium,
        high: thresholds.high,
      });
      triggerHaptic(
        result.submission?.status === "status_unknown"
          ? "warning"
          : result.submission?.status === "confirmed"
            ? "success"
            : "medium",
      );
      setConfigOutcome(result.submission ? null : result);
      setConfigSubmission(result.submission);
      setReviewing(false);
    } catch (e) {
      triggerHaptic("error");
      setError(e instanceof Error ? e.message : "Configuration failed.");
      setReviewing(false);
    } finally {
      setBusy(false);
    }
  }

  async function handleDisable() {
    if (configLocked) return;
    setBusy(true);
    setError(null);
    try {
      const result = await disableMultisig();
      triggerHaptic(
        result.submission?.status === "status_unknown"
          ? "warning"
          : result.submission?.status === "confirmed"
            ? "success"
            : "medium",
      );
      setDisableConfirm(false);
      setConfigOutcome(result.submission ? null : result);
      setConfigSubmission(result.submission);
    } catch (e) {
      triggerHaptic("error");
      setError(e instanceof Error ? e.message : "Failed to disable multi-sig.");
    } finally {
      setBusy(false);
    }
  }

  async function handleReview() {
    const reviewedXdr = xdrInput.trim();
    const reviewedNetwork = network;
    const guard = approvalSubmissionGuard(
      envelopeSubmissionStatus(reviewedXdr, reviewedNetwork),
    );
    if (guard) {
      setError(guard);
      triggerHaptic("warning");
      return;
    }
    const requestGeneration = ++reviewRequestGeneration.current;
    setBusy(true);
    setError(null);
    setOutcome(null);
    try {
      const explanation = await explainTransaction(reviewedXdr, reviewedNetwork);
      if (requestGeneration !== reviewRequestGeneration.current) return;
      setReviewClockMs(Date.now());
      setReviewBinding({ xdr: reviewedXdr, network: reviewedNetwork, explanation });
      setNetworkConfirmed(false);
      triggerHaptic("selection");
    } catch (e) {
      if (requestGeneration !== reviewRequestGeneration.current) return;
      triggerHaptic("error");
      setError(e instanceof Error ? e.message : "Could not decode the envelope.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCosign() {
    const reviewedXdr = reviewedEnvelopeForSigning(reviewBinding, xdrInput, network);
    if (!review || !reviewedXdr || !reviewBinding) {
      setReviewBinding(null);
      setNetworkConfirmed(false);
      setError("The envelope or selected network changed. Review it again before signing.");
      return;
    }
    const guard = approvalSubmissionGuard(
      envelopeSubmissionStatus(reviewedXdr, reviewBinding.network),
    );
    if (guard) {
      setError(guard);
      triggerHaptic("warning");
      return;
    }
    setBusy(true);
    setError(null);
    setOutcome(null);
    try {
      const result = await cosignTransaction(
        reviewedXdr,
        networkConfirmed ? reviewBinding.network : null,
      );
      setOutcome(result);
      setReviewBinding(null);
      triggerHaptic(
        result.submission?.status === "status_unknown"
          ? "warning"
          : result.submission
            ? "success"
            : "selection",
      );
      if (!result.submission) {
        toast("Signature added — share the updated envelope", "info");
      }
    } catch (e) {
      triggerHaptic("error");
      setError(e instanceof Error ? e.message : "Co-signing failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!activeAccount) return null;

  return (
    <Modal open onClose={onClose} wide dismissable={!busy}>
      <ModalHeader
        title="Multi-Sig Studio"
        subtitle={`Shared control for ${activeAccount.label} · ${network === "testnet" ? "Testnet" : "Mainnet"}`}
        onClose={busy ? undefined : onClose}
      />
      <div className="p-4 sm:p-6">
        <SegmentedControl<Tab>
          value={tab}
          onChange={(t) => {
            triggerHaptic("selection");
            setTab(t);
            setError(null);
          }}
          options={[
            { value: "overview", label: "Overview" },
            { value: "configure", label: "Configure", disabled: !info },
            { value: "approvals", label: "Approvals" },
          ]}
        />

        {/* ============================== OVERVIEW ============================== */}
        {tab === "overview" && (
          <div className="mt-5 space-y-4">
            {infoLoading ? (
              <div className="flex justify-center py-10">
                <Spinner size={22} />
              </div>
            ) : signerInfoUnavailable ? (
              <div className="space-y-3">
                <Notice tone="warn">
                  <strong>Signer configuration unavailable.</strong> This account may be
                  unfunded, Horizon may be unavailable, or the returned signer data could not be
                  verified. Configuration remains disabled until valid on-chain state is loaded.
                </Notice>
                <Button className="w-full" disabled>
                  Configuration Unavailable
                </Button>
              </div>
            ) : (
              <>
                {/* Scheme hero */}
                <div className="panel-inset flex flex-col items-center p-5 text-center">
                  <span
                    className={`flex h-12 w-12 items-center justify-center rounded-2xl ${
                      isMultisig
                        ? "bg-[#30D158]/12 text-[#30D158]"
                        : "bg-white/[0.06] text-neutral-400"
                    }`}
                  >
                    {isMultisig ? <IconUsers size={22} /> : <IconShield size={22} />}
                  </span>
                  <p className="display-h mt-3 text-[34px] font-light text-white">
                    {isMultisig ? (
                      <>
                        {required}
                        <span className="text-neutral-500"> of </span>
                        {total}
                      </>
                    ) : (
                      "1 of 1"
                    )}
                  </p>
                  <p className="mt-1 text-[12.5px] text-neutral-400">
                    {isMultisig
                      ? "signature weight required per transaction"
                      : "single-signature account — full control on this device"}
                  </p>
                  {isMultisig && info && (
                    <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5 text-[10.5px] font-semibold">
                      <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-neutral-300">
                        Low {info.thresholds.low_threshold}
                      </span>
                      <span className="rounded-full bg-[#0A84FF]/15 px-2.5 py-1 text-[#0A84FF]">
                        Med {info.thresholds.med_threshold} · payments
                      </span>
                      <span className="rounded-full bg-[#FF9F0A]/12 px-2.5 py-1 text-[#FF9F0A]">
                        High {info.thresholds.high_threshold} · settings
                      </span>
                    </div>
                  )}
                </div>

                {/* Signers */}
                <div>
                  <p className="px-1 pb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                    Authorized Signers ({info?.signers.length ?? 1})
                  </p>
                  <div className="list-group">
                    {(info?.signers ?? []).map((s, i) => (
                      <div
                        key={s.key}
                        className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? "ios-sep" : ""}`}
                      >
                        <Avatar
                          seed={s.key}
                          size={34}
                          label={s.key === ownKey ? "★" : String(i + 1)}
                        />
                        <div className="min-w-0 flex-1">
                          <HashValue
                            value={s.key}
                            className="text-[12.5px] text-neutral-200"
                          />
                          {s.key === ownKey && (
                            <span className="mt-0.5 inline-block rounded-md bg-[#30D158]/15 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-[#30D158]">
                              This device
                            </span>
                          )}
                        </div>
                        <span className="mono shrink-0 rounded-lg bg-[#0A84FF]/15 px-2 py-0.5 text-[11px] font-bold text-[#0A84FF]">
                          w{s.weight}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {!isMultisig && (
                  <Notice>
                    Multi-sig requires every payment to gather enough signatures — ideal for
                    treasury accounts, shared team wallets, or a second-device backup key.
                  </Notice>
                )}

                {pendingMultisigConfig && !configSubmission && (
                  <Notice>
                    A multi-sig configuration is still being tracked on this network. Signer
                    changes stay locked until its final status is known.
                  </Notice>
                )}

                <Button className="w-full" disabled={configLocked} onClick={openConfigure}>
                  {isMultisig ? "Edit Configuration" : "Set Up Multi-Sig"}
                </Button>
                {isMultisig &&
                  (disableConfirm ? (
                    <div className="rounded-2xl border border-[#FF453A]/30 bg-[#FF453A]/10 p-3.5">
                      <p className="flex items-start gap-2 text-[12px] leading-relaxed text-[#FF453A]">
                        <IconAlert size={14} className="mt-0.5 shrink-0" />
                        This removes every cosigner and restores single-signature control to
                        this device. Continue?
                      </p>
                      <div className="mt-3 grid grid-cols-2 gap-3">
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() => setDisableConfirm(false)}
                        >
                          Cancel
                        </Button>
                        <Button
                          variant="danger"
                          loading={busy}
                          disabled={busy || configLocked}
                          onClick={() => void handleDisable()}
                        >
                          Disable Multi-Sig
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={configLocked}
                      onClick={() => {
                        triggerHaptic("warning");
                        setDisableConfirm(true);
                      }}
                      className="w-full text-center text-[12px] font-medium text-neutral-500 transition-colors hover:text-[#FF453A] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Disable multi-sig for this account
                    </button>
                  ))}
              </>
            )}
          </div>
        )}

        {/* ============================== CONFIGURE ============================== */}
        {tab === "configure" && !info && (
          <div className="mt-5">
            {infoLoading ? (
              <div className="flex justify-center py-10">
                <Spinner size={22} />
              </div>
            ) : (
              <Notice tone="warn">
                Signer configuration unavailable. Return to Overview and wait until valid
                on-chain signer state can be verified.
              </Notice>
            )}
          </div>
        )}

        {tab === "configure" && info && (
          <div className="mt-5 space-y-5">
            {reviewing ? (
              <>
                <div className="panel-inset divide-y divide-white/[0.08] px-4 text-[13px]">
                  <div className="flex items-center justify-between gap-4 py-2.5">
                    <span className="shrink-0 text-neutral-400">Approval scheme</span>
                    <span className="text-right font-semibold text-white">
                      weight {thresholds.medium} of {draftTotal}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-4 py-2.5">
                    <span className="shrink-0 text-neutral-400">Signers</span>
                    <span className="text-right text-white">
                      You (w{ownWeight}) + {cosigners.length} cosigner
                      {cosigners.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-4 py-2.5">
                    <span className="shrink-0 text-neutral-400">Thresholds (L/M/H)</span>
                    <span className="mono text-right text-neutral-300">
                      {thresholds.low} / {thresholds.medium} / {thresholds.high}
                    </span>
                  </div>
                </div>
                <Notice tone="warn">
                  Applied as one atomic transaction. Settings changes afterwards will require
                  weight {thresholds.high} of signatures.
                </Notice>
                {error && <ErrorText message={error} />}
                <div className="grid grid-cols-2 gap-3">
                  <Button variant="ghost" disabled={busy} onClick={() => setReviewing(false)}>
                    Back
                  </Button>
                  <Button loading={busy} disabled={busy} onClick={() => void handleApply()}>
                    Apply Configuration
                  </Button>
                </div>
              </>
            ) : (
              <>
                {/* Signers editor */}
                <div>
                  <p className="px-1 pb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                    Signers & Weights
                  </p>
                  <div className="list-group">
                    {/* Own key */}
                    <div className="flex items-center gap-3 px-4 py-3">
                      <Avatar seed={ownKey} size={30} label="★" />
                      <div className="min-w-0 flex-1">
                        <HashValue
                          value={ownKey}
                          className="text-[12px] text-neutral-200"
                        />
                        <span className="mt-0.5 inline-block rounded-md bg-[#30D158]/15 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-[#30D158]">
                          This device
                        </span>
                      </div>
                      <WeightInput value={ownWeight} onChange={setOwnWeight} />
                    </div>
                    {cosigners.map((c, i) => (
                      <div
                        key={c.key}
                        className="ios-sep flex items-center gap-3 px-4 py-3"
                      >
                        <Avatar seed={c.key} size={30} label={String(i + 1)} />
                        <div className="min-w-0 flex-1">
                          <HashValue
                            value={c.key}
                            className="text-[12px] text-neutral-200"
                          />
                        </div>
                        <WeightInput
                          value={c.weight}
                          onChange={(w) =>
                            setCosigners((prev) =>
                              prev.map((p) => (p.key === c.key ? { ...p, weight: w } : p)),
                            )
                          }
                        />
                        <button
                          type="button"
                          onClick={() => {
                            triggerHaptic("selection");
                            setCosigners((prev) => prev.filter((p) => p.key !== c.key));
                          }}
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-[#FF453A]/10 hover:text-[#FF453A]"
                          aria-label="Remove signer"
                        >
                          <IconTrash size={13} />
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* Add signer */}
                  <div className="mt-2.5 flex gap-2">
                    <input
                      className="input mono flex-1 text-base sm:text-[12.5px]"
                      placeholder="Cosigner address (G...)"
                      value={newKey}
                      disabled={!hasAdditionalSignerCapacity(cosigners.length)}
                      spellCheck={false}
                      autoComplete="off"
                      onChange={(e) => setNewKey(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") addCosigner(newKey);
                      }}
                    />
                    <Button
                      variant="secondary"
                      className="!h-10 shrink-0 !px-3.5 text-[12.5px]"
                      disabled={!hasAdditionalSignerCapacity(cosigners.length)}
                      onClick={() => addCosigner(newKey)}
                    >
                      <IconUserPlus size={14} /> Add
                    </Button>
                  </div>
                  {contacts.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] text-neutral-500">From contacts:</span>
                      {contacts.slice(0, 5).map((c) => (
                        <button
                          key={c.address}
                          type="button"
                          disabled={!hasAdditionalSignerCapacity(cosigners.length)}
                          onClick={() => addCosigner(c.address)}
                          className="chip !py-0.5 !px-2 text-[11.5px] text-neutral-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {c.name}
                        </button>
                      ))}
                    </div>
                  )}
                  {!hasAdditionalSignerCapacity(cosigners.length) && (
                    <p className="mt-2 px-1 text-[11.5px] text-[#FF9F0A]">
                      Stellar permits at most 20 additional account signers.
                    </p>
                  )}
                </div>

                {/* Threshold presets */}
                <div>
                  <p className="px-1 pb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                    Approval Threshold
                  </p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {(
                      [
                        { id: "any", label: "Any one", hint: "weight 1" },
                        {
                          id: "majority",
                          label: "Majority",
                          hint: `weight ${Math.floor(draftTotal / 2) + 1}`,
                        },
                        { id: "all", label: "Unanimous", hint: `weight ${draftTotal}` },
                        { id: "custom", label: "Custom", hint: "L/M/H" },
                      ] as const
                    ).map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          triggerHaptic("selection");
                          setPreset(p.id);
                        }}
                        className={`rounded-2xl border px-3 py-2.5 text-left transition-all active:scale-[0.98] ${
                          preset === p.id
                            ? "border-[#0A84FF]/50 bg-[#0A84FF]/[0.08]"
                            : "border-white/[0.08] bg-white/[0.03] hover:border-white/[0.16]"
                        }`}
                      >
                        <span
                          className={`block text-[13px] font-semibold ${preset === p.id ? "text-white" : "text-neutral-300"}`}
                        >
                          {p.label}
                        </span>
                        <span className="mt-0.5 block text-[11px] text-neutral-500">
                          {p.hint}
                        </span>
                      </button>
                    ))}
                  </div>
                  {preset === "custom" && (
                    <div className="mt-2.5 grid grid-cols-3 gap-2">
                      {(
                        [
                          ["Low", customLow, setCustomLow],
                          ["Medium · payments", customMed, setCustomMed],
                          ["High · settings", customHigh, setCustomHigh],
                        ] as const
                      ).map(([label, val, setter]) => (
                        <div key={label}>
                          <label className="mb-1 block text-[10.5px] font-medium text-neutral-500">
                            {label}
                          </label>
                          <input
                            type="number"
                            min={0}
                            max={draftTotal}
                            value={val}
                            onChange={(e) =>
                              setter(
                                Math.max(0, Math.min(255, parseInt(e.target.value, 10) || 0)),
                              )
                            }
                            className="input mono !h-11 text-center text-base md:!h-9 sm:text-[13px]"
                          />
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="mt-2 px-1 text-[11.5px] text-neutral-500">
                    Payments will require collected signature weight ≥{" "}
                    <span className="font-semibold text-white">{thresholds.medium}</span> out of{" "}
                    {draftTotal}.
                  </p>
                </div>

                {error && <ErrorText message={error} />}

                <Button
                  className="w-full"
                  disabled={!configValid || busy || configLocked}
                  onClick={() => {
                    triggerHaptic("selection");
                    setReviewing(true);
                  }}
                >
                  Review Configuration
                </Button>
                {cosigners.length === 0 && (
                  <p className="-mt-2 text-center text-[11.5px] text-neutral-500">
                    Add at least one cosigner to enable multi-sig.
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {/* ============================== APPROVALS ============================== */}
        {tab === "approvals" && (
          <div className="mt-5 space-y-4">
            {!review && !outcome && (
              <>
                {/* How co-signing works */}
                <div className="panel-inset flex items-center justify-between gap-2 p-4 text-center">
                  {["Create & sign", "Share envelope", "Cosign & submit"].map((label, i) => (
                    <div key={label} className="flex flex-1 items-center gap-2">
                      <div className="flex-1">
                        <span className="mx-auto flex h-7 w-7 items-center justify-center rounded-full bg-[#0A84FF]/15 text-[12px] font-bold text-[#0A84FF]">
                          {i + 1}
                        </span>
                        <p className="mt-1.5 text-[11px] font-medium text-neutral-300">{label}</p>
                      </div>
                      {i < 2 && <span className="text-neutral-600">→</span>}
                    </div>
                  ))}
                </div>

                <div>
                  <label className="field-label">Shared Transaction Envelope (XDR)</label>
                  <textarea
                    rows={4}
                    placeholder="AAAAAG… paste the partially-signed envelope from the creator"
                    value={xdrInput}
                    onChange={(e) => {
                      reviewRequestGeneration.current += 1;
                      setXdrInput(e.target.value);
                      setReviewBinding(null);
                      setOutcome(null);
                      setNetworkConfirmed(false);
                      setError(null);
                    }}
                    className="input mono resize-none text-base sm:text-[12px]"
                    spellCheck={false}
                  />
                </div>

                {error && <ErrorText message={error} />}

                {approvalGuardMessage && !error && (
                  <Notice tone="warn">{approvalGuardMessage}</Notice>
                )}

                <Button
                  className="w-full"
                  loading={busy}
                  disabled={!xdrInput.trim() || busy || Boolean(approvalGuardMessage)}
                  onClick={() => void handleReview()}
                >
                  Review Transaction
                </Button>
              </>
            )}

            {/* ---------- Transaction explanation review (before signing) ---------- */}
            {review && !outcome && (
              <>
                {review.hasDangerOps && (
                  <Notice tone="warn">
                    <strong>High-risk transaction.</strong> It can change who controls the
                    account or move all funds. Read every operation carefully before signing.
                  </Notice>
                )}
                {reviewExpired && (
                  <Notice tone="warn">This envelope has expired — it will be rejected on submission.</Notice>
                )}
                {!review.signable && (
                  <Notice tone="warn">
                    <strong>This envelope cannot be signed here.</strong>{" "}
                    {review.blockingReasons.join(" ")}
                  </Notice>
                )}

                {/* Meta */}
                <div className="panel-inset divide-y divide-white/[0.08] px-4 text-[12.5px]">
                  <div className="flex items-center justify-between gap-4 py-2.5">
                    <span className="shrink-0 text-neutral-400">Selected network</span>
                    <span className="font-semibold text-white">{review.networkLabel}</span>
                  </div>
                  <div className="flex items-start justify-between gap-4 py-2.5">
                    <span className="shrink-0 text-neutral-400">Source account</span>
                    <span
                      className={`${EXACT_REVIEW_VALUE_CLASS} mono text-right text-[11.5px] text-neutral-200`}
                    >
                      {review.source}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-4 py-2.5">
                    <span className="shrink-0 text-neutral-400">Network fee</span>
                    <span className="mono text-neutral-300">{review.feeXlm} XLM</span>
                  </div>
                  <div className="flex items-center justify-between gap-4 py-2.5">
                    <span className="shrink-0 text-neutral-400">Minimum time</span>
                    <span className="mono text-right text-neutral-300">
                      {review.timeBounds?.minTime ?? "None"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-4 py-2.5">
                    <span className="shrink-0 text-neutral-400">Maximum time</span>
                    <span className="mono text-right text-neutral-300">
                      {review.timeBounds?.maxTime ?? "No expiry"}
                    </span>
                  </div>
                  {review.memoText && (
                    <div className="flex items-start justify-between gap-4 py-2.5">
                      <span className="shrink-0 text-neutral-400">Memo</span>
                      <span
                        className={`${EXACT_REVIEW_VALUE_CLASS} mono text-right text-neutral-200`}
                      >
                        {review.memoText}
                      </span>
                    </div>
                  )}
                  {review.expiresAt !== undefined && (
                    <div className="flex items-center justify-between gap-4 py-2.5">
                      <span className="shrink-0 text-neutral-400">Expires</span>
                      <span className={`mono ${reviewExpired ? "text-[#FF453A]" : "text-neutral-300"}`}>
                        {reviewExpiryLabel}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-4 py-2.5">
                    <span className="shrink-0 text-neutral-400">Signatures collected</span>
                    <span className="mono text-white">
                      {review.collectedWeight} / {review.requiredWeight} weight
                    </span>
                  </div>
                  {review.authorizations.map((authorization) => (
                    <div key={authorization.source} className="space-y-1 py-2.5">
                      <div className="flex items-start justify-between gap-4">
                        <span className="shrink-0 text-neutral-400">Required source</span>
                        <span
                          className={`${EXACT_REVIEW_VALUE_CLASS} mono text-right text-[11.5px] text-neutral-200`}
                        >
                          {authorization.source}
                        </span>
                      </div>
                      <p className="text-right font-mono text-[11px] text-neutral-500">
                        {authorization.collectedWeight} / {authorization.requiredWeight} weight
                      </p>
                    </div>
                  ))}
                </div>

                {/* Operations in plain English */}
                <div className="space-y-2">
                  {review.operations.map((op, i) => (
                    <div
                      key={i}
                      className={`rounded-2xl border p-3.5 ${
                        op.risk === "danger"
                          ? "border-[#FF453A]/30 bg-[#FF453A]/[0.06]"
                          : op.risk === "warn"
                            ? "border-[#FF9F0A]/25 bg-[#FF9F0A]/[0.05]"
                            : "border-white/[0.08] bg-white/[0.03]"
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-[11px] font-bold text-neutral-300">
                          {i + 1}
                        </span>
                        <p className="min-w-0 flex-1 truncate text-[13px] font-semibold text-white">
                          {op.title}
                        </p>
                        {op.risk !== "none" && (
                          <span
                            className={`shrink-0 rounded-md px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide ${
                              op.risk === "danger"
                                ? "bg-[#FF453A]/15 text-[#FF453A]"
                                : "bg-[#FF9F0A]/15 text-[#FF9F0A]"
                            }`}
                          >
                            {op.risk === "danger" ? "High risk" : "Review"}
                          </span>
                        )}
                      </div>
                      <div className="mt-2 space-y-1.5">
                        {op.lines.map((l, j) => (
                          <div key={j} className="flex items-start justify-between gap-3 text-[12px]">
                            <span className="shrink-0 text-neutral-500">{l.label}</span>
                            {l.kind === "address" ? (
                              <span
                                className={`${EXACT_REVIEW_VALUE_CLASS} mono text-right text-[11.5px] text-neutral-200`}
                              >
                                {l.value}
                              </span>
                            ) : l.kind === "mono" ? (
                              <span
                                className={`${EXACT_REVIEW_VALUE_CLASS} mono text-right text-neutral-200`}
                              >
                                {l.value}
                              </span>
                            ) : (
                              <span
                                className={`${EXACT_REVIEW_VALUE_CLASS} text-right text-neutral-300`}
                              >
                                {l.value}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-white/[0.1] bg-white/[0.03] p-3.5 text-[12px] leading-relaxed text-neutral-300">
                  <input
                    type="checkbox"
                    checked={networkConfirmed}
                    onChange={(event) => setNetworkConfirmed(event.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-[#0A84FF]"
                  />
                  <span>
                    I confirm this envelope should execute on <strong>{review.networkLabel}</strong>.
                    XDR does not encode its network; the selected network changes the signed hash.
                  </span>
                </label>

                {error && <ErrorText message={error} />}

                <div className="grid grid-cols-2 gap-3">
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      reviewRequestGeneration.current += 1;
                      setReviewBinding(null);
                      setNetworkConfirmed(false);
                    }}
                  >
                    Back
                  </Button>
                  <Button
                    loading={busy}
                    disabled={busy || !networkConfirmed || !review.signable || reviewExpired}
                    onClick={() => void handleCosign()}
                  >
                    Sign as {activeAccount.label}
                  </Button>
                </div>
              </>
            )}

            {outcome && !outcome.submission && (
              <div className="panel-inset space-y-3 p-4">
                <div className="flex items-center justify-between text-[12.5px]">
                  <span className="text-neutral-400">
                    Collected weight{outcome.addedSignature ? " (yours added)" : ""}
                  </span>
                  <span className="mono font-semibold text-white">
                    {outcome.collectedWeight} / {outcome.requiredWeight}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-[#0A84FF] transition-all"
                    style={{
                      width: `${Math.min(100, (outcome.collectedWeight / Math.max(1, outcome.requiredWeight)) * 100)}%`,
                    }}
                  />
                </div>
                <p className="text-[11.5px] leading-relaxed text-neutral-500">
                  Still needs more signatures. Share the updated envelope with the next
                  cosigner:
                </p>
                <CopyButton
                  value={outcome.xdr}
                  label="Copy Updated Envelope"
                  className="chip w-full justify-center"
                />
              </div>
            )}

            {outcome?.submission && (
              <div className="flex flex-col items-center py-3 text-center">
                <span className={`flex h-12 w-12 items-center justify-center rounded-full border ${
                  trackedCosignStatus === "status_unknown"
                    ? "border-[#FF9F0A]/30 bg-[#FF9F0A]/10 text-[#FF9F0A]"
                    : "border-[#30D158]/30 bg-[#30D158]/10 text-[#30D158]"
                }`}>
                  {trackedCosignStatus === "status_unknown"
                    ? <IconAlert size={22} />
                    : <IconCheck size={22} />}
                </span>
                <p className="display-h mt-3 text-lg font-light text-white">
                  {trackedCosignStatus === "status_unknown"
                    ? "Submission Status Unknown"
                    : trackedCosignStatus === "confirmed"
                      ? "Threshold Met — Confirmed"
                      : "Threshold Met — Accepted"}
                </p>
                <p className="mt-1 text-[12.5px] text-neutral-400">
                  {outcome.operationCount} operation{outcome.operationCount === 1 ? "" : "s"} ·
                  weight {outcome.collectedWeight} of {outcome.requiredWeight}
                </p>
                {trackedCosignStatus === "status_unknown" && (
                  <p className="mt-2 max-w-md text-[12px] leading-relaxed text-[#FF9F0A]">
                    Horizon did not confirm acceptance. Do not resubmit blindly or share this
                    envelope for another submission; canonical hash tracking is active.
                  </p>
                )}
                <p className="mt-2 break-all font-mono text-[10px] text-neutral-500">
                  {outcome.submission.network} · {outcome.submission.hash}
                </p>
              </div>
            )}

          </div>
        )}

        {configOutcome && (
          <div className="mt-5 space-y-3 rounded-2xl border border-[#FF9F0A]/25 bg-[#FF9F0A]/[0.06] p-4">
            <p className="text-[13px] font-semibold text-[#FF9F0A]">
              Additional approval required
            </p>
            <p className="text-[11.5px] leading-relaxed text-neutral-400">
              The current high threshold is {configOutcome.requiredWeight}; this device supplied
              weight {configOutcome.collectedWeight}. Share this atomic configuration envelope
              with another current signer, then import it under Approvals.
            </p>
            <CopyButton
              value={configOutcome.xdr}
              label="Copy Configuration Envelope"
              className="chip w-full justify-center"
            />
          </div>
        )}

        {configSubmission && (
          <div className={`mt-5 rounded-2xl border p-3.5 text-[12.5px] ${
            trackedConfigStatus === "status_unknown"
              ? "border-[#FF9F0A]/30 bg-[#FF9F0A]/10 text-[#FF9F0A]"
              : "border-[#30D158]/25 bg-[#30D158]/10 text-[#30D158]"
          }`}>
            <p className="flex items-center gap-2.5 font-semibold">
              {trackedConfigStatus === "status_unknown"
                ? <IconAlert size={15} className="shrink-0" />
                : <IconCheck size={15} className="shrink-0" />}
              {trackedConfigStatus === "status_unknown"
                ? "Configuration status unknown"
                : trackedConfigStatus === "confirmed"
                  ? "Configuration confirmed"
                  : "Configuration accepted — confirming"}
            </p>
            {trackedConfigStatus === "status_unknown" && (
              <p className="mt-1.5 leading-relaxed text-neutral-300">
                Do not resubmit blindly. The wallet is tracking this canonical transaction hash.
              </p>
            )}
            <p className="mt-2 break-all font-mono text-[10px] text-neutral-500">
              {configSubmission.network} · {configSubmission.hash}
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}

function WeightInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (w: number) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1 rounded-lg bg-white/[0.06] p-0.5">
      <button
        type="button"
        className="flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30"
        disabled={value <= 1}
        onClick={() => onChange(Math.max(1, value - 1))}
        aria-label="Decrease weight"
      >
        −
      </button>
      <span className="mono w-6 text-center text-[12.5px] font-semibold text-white">
        {value}
      </span>
      <button
        type="button"
        className="flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30"
        disabled={value >= 255}
        onClick={() => onChange(Math.min(255, value + 1))}
        aria-label="Increase weight"
      >
        +
      </button>
    </div>
  );
}
