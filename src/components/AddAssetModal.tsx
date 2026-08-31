"use client";

import { useEffect, useId, useMemo, useState } from "react";
import {
  useWalletIdentity,
  useWalletLedger,
  useWalletSubmission,
  useWalletTransactions,
} from "@/hooks/useWallet";
import { isValidPublicAddress } from "@/lib/vault";
import { formatTrezorAddress } from "@/lib/address-display";
import { lookupKnownAsset, POPULAR_ASSETS, type KnownAsset } from "@/lib/assets";
import { networkFeeXlm } from "@/lib/api";
import { triggerHaptic } from "@/lib/haptics";
import type { SubmissionResult } from "@/lib/submission";
import {
  addTrustlineSelection,
  MAX_TRUSTLINE_SELECTIONS,
  toggleTrustlineSelection,
} from "@/lib/transaction-intent";
import { Button, ErrorText, Modal, ModalHeader } from "./ui";
import {
  IconCheck,
  IconLedger,
  IconPlus,
  IconSearch,
  IconTrezor,
} from "./icons";

export function AddAssetPublicPanel({
  onClose,
  onBusyChange,
  embedded = false,
}: {
  onClose: () => void;
  onBusyChange(busy: boolean): void;
  embedded?: boolean;
}) {
  const { network, activeAccount } = useWalletIdentity();
  const { balances, recommendedBaseFeeStroops } = useWalletLedger();
  const { submissionStatus } = useWalletSubmission();
  const { trustAssets, refresh } = useWalletTransactions();
  const [search, setSearch] = useState("");
  const [code, setCode] = useState("");
  const [issuer, setIssuer] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingSubmission, setPendingSubmission] = useState<SubmissionResult | null>(null);
  const searchInputId = useId();
  const assetCodeInputId = useId();
  const issuerInputId = useId();
  const [error, setError] = useState<string | null>(null);
  // Multi-select: queued trustlines added atomically in ONE transaction
  const [selected, setSelected] = useState<Array<{ code: string; issuer: string }>>([]);
  const trackedSubmissionStatus = pendingSubmission ? submissionStatus(pendingSubmission) : null;
  const selectedFeeXlm = networkFeeXlm(
    recommendedBaseFeeStroops,
    Math.min(selected.length, MAX_TRUSTLINE_SELECTIONS),
  );

  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      await Promise.resolve();
      if (!alive) return;
      if (trackedSubmissionStatus === "confirmed") {
        triggerHaptic("success");
        void refresh();
        onClose();
        return;
      }
      if (trackedSubmissionStatus === "failed") {
        setPendingSubmission(null);
        setError("Trustline transaction failed on-chain. Review the selection and retry.");
        triggerHaptic("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, [onClose, refresh, trackedSubmissionStatus]);

  const existingAssets = useMemo(
    () => new Set((balances ?? []).filter((b) => b.issuer).map((b) => `${b.code.toUpperCase()}:${b.issuer}`)),
    [balances],
  );

  const filteredPopular = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return POPULAR_ASSETS;
    return POPULAR_ASSETS.filter(
      (a) =>
        a.code.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        (a.anchorDomain ?? "").toLowerCase().includes(q),
    );
  }, [search]);

  function handleSelectPopular(asset: KnownAsset) {
    triggerHaptic("selection");
    const iss =
      (network === "mainnet" ? asset.mainnetIssuer : (asset.testnetIssuer ?? asset.mainnetIssuer)) ?? "";
    // Codes in the directory can be mixed-case (e.g. "yXLM"); the queue stores
    // them uppercased, so the dedupe key must be normalized the same way.
    const update = toggleTrustlineSelection(selected, {
      code: asset.code.toUpperCase(),
      issuer: iss,
    });
    setSelected(update.selected);
    setError(update.error);
  }

  function queueCustom() {
    triggerHaptic("medium");
    const c = code.trim().toUpperCase();
    const iss = issuer.trim();
    if (!/^[A-Z0-9]{1,12}$/.test(c) || !isValidPublicAddress(iss)) {
      setError("Enter a valid asset code and issuer first.");
      return;
    }
    const update = addTrustlineSelection(selected, { code: c, issuer: iss });
    setSelected(update.selected);
    if (update.error) {
      setError(update.error);
      return;
    }
    setError(null);
    setCode("");
    setIssuer("");
  }

  async function handleAddBatch() {
    if (pendingSubmission) return;
    // Defensive dedupe before submit
    const seen = new Set<string>();
    const unique = selected.filter((s) => {
      const k = `${s.code}:${s.issuer}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    if (unique.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = await trustAssets(unique);
      setPendingSubmission(result);
      triggerHaptic(result.status === "status_unknown" ? "warning" : "medium");
    } catch (e) {
      triggerHaptic("error");
      setError(e instanceof Error ? e.message : "Batch trustline failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {!embedded && <ModalHeader
        title="Add Assets"
        subtitle="Select one or more — all added in a single atomic transaction"
        onClose={onClose}
      />}
      <div className="p-4 sm:p-6">
        {/* Search */}
        <div className="search-field mb-4 flex items-center gap-2">
          <IconSearch size={15} className="text-neutral-400 shrink-0" />
          <label htmlFor={searchInputId} className="sr-only">Search verified assets</label>
          <input
            id={searchInputId}
            placeholder="Search popular tokens (USDC, EURC, AQUA, BTC...)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-transparent text-base text-white outline-none placeholder:text-neutral-500 sm:text-[13.5px]"
          />
        </div>

        {/* Verified assets grid */}
        <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
          Verified Stellar Assets
        </p>
        <div className="grid max-h-[180px] grid-cols-2 gap-2.5 overflow-y-auto pr-0.5 sm:grid-cols-3">
          {filteredPopular.map((asset) => {
            const iss =
              (network === "mainnet"
                ? asset.mainnetIssuer
                : (asset.testnetIssuer ?? asset.mainnetIssuer)) ?? "";
            const alreadyAdded = existingAssets.has(`${asset.code.toUpperCase()}:${iss}`);
            const isSelected = selected.some(
              (s) => `${s.code}:${s.issuer}` === `${asset.code.toUpperCase()}:${iss}`,
            );
            const available = Boolean(iss);

            return (
              <button
                key={`${asset.code}:${iss}`}
                type="button"
                disabled={alreadyAdded || !available || busy}
                onClick={() => handleSelectPopular(asset)}
                className={`flex items-center justify-between rounded-2xl border p-2.5 text-left transition-[background-color,border-color,color,opacity] ${
                  alreadyAdded
                    ? "cursor-not-allowed border-white/5 bg-white/[0.02] opacity-50"
                    : isSelected
                      ? "border-[#0A84FF] bg-[#0A84FF]/15 text-white"
                      : "border-white/10 bg-white/[0.04] text-neutral-300 hover:border-white/20 hover:text-white"
                }`}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="mono flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white shadow-inner"
                    style={{ background: asset.color }}
                  >
                    {asset.code.slice(0, 2)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-white">{asset.code}</p>
                    <p className="truncate text-[10.5px] text-neutral-400">{asset.name}</p>
                  </div>
                </div>
                {alreadyAdded ? (
                  <IconCheck size={14} className="shrink-0 text-[#30D158]" />
                ) : isSelected ? (
                  <IconCheck size={14} className="shrink-0 text-[#0A84FF]" />
                ) : (
                  <IconPlus size={14} className="shrink-0 text-neutral-400" />
                )}
              </button>
            );
          })}
        </div>

        {/* Custom asset row */}
        <div className="mt-4 flex gap-2 border-t border-white/[0.08] pt-4">
          <label htmlFor={assetCodeInputId} className="sr-only">Custom asset code</label>
          <input
            id={assetCodeInputId}
            className="input !h-11 w-[110px] shrink-0 uppercase text-base md:!h-9 sm:text-[13px]"
            placeholder="CODE"
            maxLength={12}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <label htmlFor={issuerInputId} className="sr-only">Custom asset issuer address</label>
          <input
            id={issuerInputId}
            className="input mono !h-11 min-w-0 flex-1 text-base md:!h-9 sm:text-[12.5px]"
            placeholder="Issuer G..."
            value={issuer}
            onChange={(e) => setIssuer(e.target.value)}
          />
          <Button
            variant="secondary"
            className="!h-11 shrink-0 !px-3 !text-[12px] md:!h-9"
            disabled={!/^[A-Z0-9]{1,12}$/.test(code.trim().toUpperCase()) || !isValidPublicAddress(issuer)}
            onClick={queueCustom}
          >
            Queue
          </Button>
        </div>

        {/* Queued trustlines */}
        <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
          <div className="flex items-center justify-between pb-2">
            <p className="text-[12px] font-semibold text-white">
              Queued Trustlines ({selected.length})
            </p>
            {selected.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  triggerHaptic("selection");
                  setSelected([]);
                }}
                className="text-[11.5px] font-medium text-neutral-400 hover:text-[#FF453A]"
              >
                Clear all
              </button>
            )}
          </div>
          {selected.length === 0 ? (
            <p className="text-[11.5px] text-neutral-500">
              Tap verified assets or queue a custom asset above — they&apos;ll be added atomically
              in one transaction.
            </p>
          ) : (
            <div className="scrollbar-none max-h-[120px] space-y-1 overflow-y-auto">
              {selected.map((s) => {
                const known = lookupKnownAsset(s.code, s.issuer, network);
                return (
                  <div
                    key={`${s.code}:${s.issuer}`}
                    className="flex items-center justify-between rounded-xl bg-white/[0.04] px-2.5 py-1.5"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className="mono flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
                        style={{ background: known?.color ?? "#5E5CE6" }}
                      >
                        {s.code.slice(0, 2)}
                      </span>
                      <span className="truncate text-[12.5px] font-medium text-white">
                        {s.code}
                      </span>
                      <span className="mono hidden truncate text-[10.5px] text-neutral-500 sm:inline">
                        {formatTrezorAddress(s.issuer)}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic("selection");
                        setSelected((prev) =>
                          prev.filter(
                            (p) => `${p.code}:${p.issuer}` !== `${s.code}:${s.issuer}`,
                          ),
                        );
                      }}
                      className="text-neutral-500 hover:text-[#FF453A]"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          {selected.length > 0 && (
            <p className="pt-2 text-[11px] text-neutral-400">
              Fee: {selectedFeeXlm} XLM — one atomic transaction.
            </p>
          )}
        </div>

        {/* Hardware Device Indicator */}
        {activeAccount?.hardware && (
          <div className="mt-3 rounded-xl border border-[#0A84FF]/30 bg-[#0A84FF]/10 p-2.5 flex items-center justify-between text-[12px] text-[#0A84FF]">
            <div className="flex items-center gap-2">
              {activeAccount.hardware === "ledger" ? (
                <IconLedger size={15} className="text-[#64D2FF]" />
              ) : (
                <IconTrezor size={15} className="text-emerald-400" />
              )}
              <span className="font-semibold">
                Sign Trustline on {activeAccount.hardware === "ledger" ? "Ledger" : "Trezor"} Device
              </span>
            </div>
            <span className="mono text-[11px] text-neutral-400">{activeAccount.path ?? "m/44'/148'/0'"}</span>
          </div>
        )}

        <div className="mt-4">
          {pendingSubmission && (
            <div className={`mb-3 rounded-xl border p-3 text-[12px] leading-relaxed ${
              trackedSubmissionStatus === "status_unknown"
                ? "border-[#FF9F0A]/30 bg-[#FF9F0A]/10 text-[#FF9F0A]"
                : "border-[#0A84FF]/30 bg-[#0A84FF]/10 text-[#64D2FF]"
            }`}>
              {trackedSubmissionStatus === "status_unknown"
                ? "Trustline status unknown. Do not resubmit blindly."
                : trackedSubmissionStatus === "confirmed"
                  ? "Trustline transaction confirmed."
                  : "Trustline transaction accepted and confirming."}
              <span className="mt-1 block break-all font-mono text-[10px] text-neutral-400">
                {pendingSubmission.network} · {pendingSubmission.hash}
              </span>
            </div>
          )}
          <ErrorText message={error ?? ""} />
        </div>

        {/* Footer actions */}
        <div className="mt-6 flex gap-3">
          <Button variant="ghost" className="flex-1" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            className="flex-[2]"
            loading={busy}
            loadingLabel="Submitting trustline transaction"
            disabled={selected.length === 0 || busy || Boolean(pendingSubmission)}
            onClick={() => void handleAddBatch()}
          >
            {selected.length > 1
                ? `Add ${selected.length} Trustlines · 1 Tx`
                : selected.length === 1
                  ? "Add Trustline · 1 Tx"
                  : "Add Trustlines"}
          </Button>
        </div>
      </div>
    </>
  );
}

export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel,
  danger = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
}) {
  if (!open) return null;
  return (
    <ConfirmInner
      onClose={onClose}
      onConfirm={onConfirm}
      title={title}
      body={body}
      confirmLabel={confirmLabel}
      danger={danger}
    />
  );
}

function ConfirmInner({
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel,
  danger = false,
}: {
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
}) {
  return (
    <Modal open onClose={onClose}>
      <ModalHeader title={title} subtitle="Please confirm this action" onClose={onClose} />
      <div className="p-4 sm:p-6">
        <p className="text-[14px] leading-relaxed text-neutral-300">{body}</p>
        <div className="mt-6 grid grid-cols-2 gap-3">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
