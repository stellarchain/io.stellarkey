"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import { useToast } from "./Toast";
import { fetchAccountSignerInfo, type AccountSignerInfo } from "@/lib/api";
import { isValidPublicAddress } from "@/lib/vault";
import { totalWeight, explainTransaction, type CosignOutcome, type TxExplanation } from "@/lib/multisig";
import { triggerHaptic } from "@/lib/haptics";
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
  } = useWallet();
  const { toast } = useToast();

  const [tab, setTab] = useState<Tab>("overview");
  const [info, setInfo] = useState<AccountSignerInfo | null>(null);
  const [infoLoading, setInfoLoading] = useState(true);
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
  const [configured, setConfigured] = useState(false);

  // Approvals state
  const [xdrInput, setXdrInput] = useState("");
  const [review, setReview] = useState<TxExplanation | null>(null);
  const [reviewExpired, setReviewExpired] = useState(false);
  const [reviewExpiryLabel, setReviewExpiryLabel] = useState("");
  const [outcome, setOutcome] = useState<CosignOutcome | null>(null);

  const loadInfo = useCallback(async () => {
    if (!activeAccount) return;
    // Both setStates land after the await — safe for react-hooks/set-state-in-effect
    const result = await fetchAccountSignerInfo(activeAccount.publicKey, network);
    setInfo(result);
    setInfoLoading(false);
  }, [activeAccount, network]);

  const loadInfoRef = useRef(loadInfo);
  useEffect(() => {
    loadInfoRef.current = loadInfo;
  }, [loadInfo]);

  useEffect(() => {
    void loadInfoRef.current();
  }, [loadInfo]);

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
    triggerHaptic("selection");
    setOwnWeight(info?.signers.find((s) => s.key === ownKey)?.weight ?? 1);
    setCosigners(
      existingCosigners.map((s) => ({ key: s.key, weight: s.weight })),
    );
    setReviewing(false);
    setError(null);
    setTab("configure");
  }

  function addCosigner(key: string) {
    const k = key.trim();
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
    setBusy(true);
    setError(null);
    try {
      await applyMultisigConfig({
        signers: [{ key: ownKey, weight: ownWeight }, ...cosigners],
        low: thresholds.low,
        medium: thresholds.medium,
        high: thresholds.high,
      });
      triggerHaptic("success");
      setConfigured(true);
      setReviewing(false);
      await loadInfo();
    } catch (e) {
      triggerHaptic("error");
      setError(e instanceof Error ? e.message : "Configuration failed.");
      setReviewing(false);
    } finally {
      setBusy(false);
    }
  }

  async function handleDisable() {
    setBusy(true);
    setError(null);
    try {
      await disableMultisig();
      triggerHaptic("success");
      setDisableConfirm(false);
      setConfigured(true);
      await loadInfo();
    } catch (e) {
      triggerHaptic("error");
      setError(e instanceof Error ? e.message : "Failed to disable multi-sig.");
    } finally {
      setBusy(false);
    }
  }

  async function handleReview() {
    setBusy(true);
    setError(null);
    setOutcome(null);
    try {
      const explanation = await explainTransaction(xdrInput.trim(), network);
      // Expiry is computed once here — Date.now() is not allowed during render
      const now = Date.now();
      const expired =
        explanation.expiresAt !== undefined && explanation.expiresAt * 1000 < now;
      setReviewExpired(expired);
      setReviewExpiryLabel(
        explanation.expiresAt === undefined
          ? ""
          : expired
            ? "Expired"
            : `in ~${Math.max(1, Math.round((explanation.expiresAt * 1000 - now) / 60000))} min`,
      );
      setReview(explanation);
      triggerHaptic("selection");
    } catch (e) {
      triggerHaptic("error");
      setError(e instanceof Error ? e.message : "Could not decode the envelope.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCosign() {
    setBusy(true);
    setError(null);
    setOutcome(null);
    try {
      const result = await cosignTransaction(xdrInput.trim());
      setOutcome(result);
      setReview(null);
      triggerHaptic(result.submitted ? "success" : "selection");
      if (!result.submitted) {
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
      <div className="p-6">
        <SegmentedControl<Tab>
          value={tab}
          onChange={(t) => {
            triggerHaptic("selection");
            setTab(t);
            setError(null);
          }}
          options={[
            { value: "overview", label: "Overview" },
            { value: "configure", label: "Configure" },
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
                            head={6}
                            tail={6}
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

                <Button className="w-full" onClick={openConfigure}>
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
                          disabled={busy}
                          onClick={() => void handleDisable()}
                        >
                          Disable Multi-Sig
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic("warning");
                        setDisableConfirm(true);
                      }}
                      className="w-full text-center text-[12px] font-medium text-neutral-500 transition-colors hover:text-[#FF453A]"
                    >
                      Disable multi-sig for this account
                    </button>
                  ))}
              </>
            )}
          </div>
        )}

        {/* ============================== CONFIGURE ============================== */}
        {tab === "configure" && (
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
                          head={6}
                          tail={6}
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
                            head={6}
                            tail={6}
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
                      className="input mono flex-1 text-[12.5px]"
                      placeholder="Cosigner address (G...)"
                      value={newKey}
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
                          onClick={() => addCosigner(c.address)}
                          className="chip !py-0.5 !px-2 text-[11.5px] text-neutral-300 hover:text-white"
                        >
                          {c.name}
                        </button>
                      ))}
                    </div>
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
                            className="input mono !h-9 text-center text-[13px]"
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
                  disabled={!configValid || busy}
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
                      setXdrInput(e.target.value);
                      setReview(null);
                      setOutcome(null);
                      setError(null);
                    }}
                    className="input mono resize-none text-[12px]"
                    spellCheck={false}
                  />
                </div>

                {error && <ErrorText message={error} />}

                <Button
                  className="w-full"
                  loading={busy}
                  disabled={!xdrInput.trim() || busy}
                  onClick={() => void handleReview()}
                >
                  Review Transaction
                </Button>
              </>
            )}

            {/* ---------- Transaction explanation review (before signing) ---------- */}
            {review && !outcome && (
              <>
                {review.networkMismatch && (
                  <Notice tone="warn">
                    This envelope targets a different network than the one you are on. Do not
                    sign it here.
                  </Notice>
                )}
                {review.hasDangerOps && (
                  <Notice tone="warn">
                    <strong>High-risk transaction.</strong> It can change who controls the
                    account or move all funds. Read every operation carefully before signing.
                  </Notice>
                )}
                {reviewExpired && (
                  <Notice tone="warn">This envelope has expired — it will be rejected on submission.</Notice>
                )}

                {/* Meta */}
                <div className="panel-inset divide-y divide-white/[0.08] px-4 text-[12.5px]">
                  <div className="flex items-center justify-between gap-4 py-2.5">
                    <span className="shrink-0 text-neutral-400">Source account</span>
                    <HashValue value={review.source} head={6} tail={6} className="text-[12px] text-neutral-200" />
                  </div>
                  <div className="flex items-center justify-between gap-4 py-2.5">
                    <span className="shrink-0 text-neutral-400">Network fee</span>
                    <span className="mono text-neutral-300">{review.feeXlm} XLM</span>
                  </div>
                  {review.memoText && (
                    <div className="flex items-center justify-between gap-4 py-2.5">
                      <span className="shrink-0 text-neutral-400">Memo</span>
                      <span className="truncate text-neutral-200">{review.memoText}</span>
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
                          <div key={j} className="flex items-center justify-between gap-3 text-[12px]">
                            <span className="shrink-0 text-neutral-500">{l.label}</span>
                            {l.kind === "address" ? (
                              <HashValue value={l.value} head={5} tail={5} className="text-[11.5px] text-neutral-200" />
                            ) : l.kind === "mono" ? (
                              <span className="mono truncate text-neutral-200">{l.value}</span>
                            ) : (
                              <span className="truncate text-right text-neutral-300">{l.value}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                {error && <ErrorText message={error} />}

                <div className="grid grid-cols-2 gap-3">
                  <Button variant="ghost" disabled={busy} onClick={() => setReview(null)}>
                    Back
                  </Button>
                  <Button loading={busy} disabled={busy} onClick={() => void handleCosign()}>
                    Sign as {activeAccount.label}
                  </Button>
                </div>
              </>
            )}

            {outcome && !outcome.submitted && (
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

            {outcome?.submitted && (
              <div className="flex flex-col items-center py-3 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full border border-[#30D158]/30 bg-[#30D158]/10 text-[#30D158]">
                  <IconCheck size={22} />
                </span>
                <p className="display-h mt-3 text-lg font-light text-white">
                  Threshold Met — Submitted
                </p>
                <p className="mt-1 text-[12.5px] text-neutral-400">
                  {outcome.operationCount} operation{outcome.operationCount === 1 ? "" : "s"} ·
                  weight {outcome.collectedWeight} of {outcome.requiredWeight}
                </p>
              </div>
            )}

          </div>
        )}

        {/* Success overlay after configure/disable */}
        {configured && (
          <div className="mt-5 flex items-center gap-2.5 rounded-2xl border border-[#30D158]/25 bg-[#30D158]/10 p-3.5 text-[12.5px] text-[#30D158]">
            <IconCheck size={15} className="shrink-0" />
            Configuration applied. Balances and signers refresh automatically.
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
