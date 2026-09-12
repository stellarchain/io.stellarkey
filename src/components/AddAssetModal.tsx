"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useState } from "react";
import { SectionHeader } from "@/components/ui";
import {
  useWalletIdentity,
  useWalletLedger,
  useWalletSubmission,
  useWalletTransactions,
} from "@/hooks/useWallet";
import { isValidPublicAddress } from "@/lib/vault";
import { formatTrezorAddress } from "@/lib/address-display";
import {
  knownAssetsForNetwork,
  knownAssetIssuer,
  lookupKnownAsset,
  type KnownAsset,
} from "@/lib/assets";
import { networkFeeXlm } from "@/lib/api";
import { triggerHaptic } from "@/lib/haptics";
import type { SubmissionResult } from "@/lib/submission";
import {
  addTrustlineSelection,
  MAX_TRUSTLINE_SELECTIONS,
  toggleTrustlineSelection,
} from "@/lib/transaction-intent";
import { Button, ErrorText, ModalBody, ModalFooter, Notice } from "./ui";
import { XlmFeeFiatValue } from "./XlmFeeFiatValue";
import {
  IconCheck,
  IconClose,
  IconLedger,
  IconPlus,
  IconSearch,
  IconTrezor,
} from "./icons";

/** Header override the panel reports so the owning shell shows stage-aware titles. */
export type AddAssetHeader = { title: string; subtitle?: string; onBack?: () => void };

export function AddAssetPublicPanel({
  onClose,
  onBusyChange,
  onDirtyChange,
  onHeaderChange,
}: {
  onClose: () => void;
  onBusyChange(busy: boolean): void;
  onDirtyChange?(dirty: boolean): void;
  onHeaderChange?(header: AddAssetHeader | null): void;
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
  const confirmed = trackedSubmissionStatus === "confirmed";
  const selectedFeeXlm = networkFeeXlm(
    recommendedBaseFeeStroops,
    Math.min(selected.length, MAX_TRUSTLINE_SELECTIONS),
  );
  const dirty =
    !pendingSubmission &&
    (selected.length > 0 || code.trim() !== "" || issuer.trim() !== "");

  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);

  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  useLayoutEffect(() => {
    if (!onHeaderChange) return;
    onHeaderChange(
      confirmed
        ? {
            title: selected.length > 1 ? "Trustlines Added" : "Trustline Added",
            subtitle: "Confirmed on-chain in one transaction",
          }
        : pendingSubmission
          ? {
              title: "Trustline Submitted",
              subtitle: trackedSubmissionStatus === "status_unknown"
                ? "Checking the canonical hash"
                : "Waiting for on-chain confirmation",
            }
          : null,
    );
    return () => onHeaderChange(null);
  }, [confirmed, onHeaderChange, pendingSubmission, selected.length, trackedSubmissionStatus]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      await Promise.resolve();
      if (!alive) return;
      if (trackedSubmissionStatus === "confirmed") {
        triggerHaptic("success");
        void refresh();
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
  }, [refresh, trackedSubmissionStatus]);

  const existingAssets = useMemo(
    () => new Set((balances ?? []).filter((b) => b.issuer).map((b) => `${b.code}:${b.issuer}`)),
    [balances],
  );

  const filteredPopular = useMemo(() => {
    const networkAssets = knownAssetsForNetwork(network);
    const q = search.trim().toLowerCase();
    if (!q) return networkAssets;
    return networkAssets.filter(
      (a) =>
        a.code.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        (a.anchorDomain ?? "").toLowerCase().includes(q),
    );
  }, [network, search]);

  function handleSelectPopular(asset: KnownAsset) {
    const iss = knownAssetIssuer(asset, network) ?? "";
    if (!iss) return;
    triggerHaptic("selection");
    const update = toggleTrustlineSelection(selected, {
      code: asset.code,
      issuer: iss,
    });
    setSelected(update.selected);
    setError(update.error);
  }

  function queueCustom() {
    const c = code.trim();
    const iss = issuer.trim();
    if (!/^[A-Za-z0-9]{1,12}$/.test(c) || !isValidPublicAddress(iss)) {
      setError("Enter a valid asset code and issuer first.");
      return;
    }
    const update = addTrustlineSelection(selected, { code: c, issuer: iss });
    setSelected(update.selected);
    if (update.error) {
      setError(update.error);
      return;
    }
    triggerHaptic("medium");
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

  const canQueueCustom =
    /^[A-Za-z0-9]{1,12}$/.test(code.trim()) && isValidPublicAddress(issuer.trim());

  if (confirmed && pendingSubmission) {
    const count = selected.length;
    return (
      <ModalBody>
        <div className="flex flex-col items-center py-4 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full border border-[#30D158]/30 bg-[#30D158]/10 text-[#30D158]">
            <IconCheck size={28} />
          </span>
          <h2 className="display-h mt-4 text-xl font-light text-white">
            {count > 1 ? "Trustlines Added" : "Trustline Added"}
          </h2>
          <p className="mt-1 text-[13px] text-neutral-400">
            Your wallet can now hold {count > 1 ? "these assets" : "this asset"}.
          </p>
        </div>
        <Notice tone="pos">
          <p className="font-semibold text-white">
            {count > 1
              ? `${count} trustlines confirmed on-chain.`
              : "Trustline confirmed on-chain."}
          </p>
          {count > 0 && (
            <p className="mt-1 text-neutral-300">
              {selected.map((s) => s.code).join(", ")}
            </p>
          )}
          <span className="mt-2 block break-all font-mono text-[10px] text-neutral-400">
            {pendingSubmission.network} · {pendingSubmission.hash}
          </span>
        </Notice>
        <ModalFooter primary={<Button onClick={onClose}>Done</Button>} />
      </ModalBody>
    );
  }

  return (
    <ModalBody>
      {/* Search */}
      <div className="search-field min-h-11 flex items-center gap-2">
        <IconSearch size={15} className="text-neutral-400 shrink-0" />
        <label htmlFor={searchInputId} className="sr-only">Search verified assets</label>
        <input
          id={searchInputId}
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          placeholder="Search popular tokens (USDC, EURC, AQUA, BTC...)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-transparent text-base text-white outline-none placeholder:text-neutral-500 sm:text-[13.5px]"
        />
      </div>

      {/* Verified assets grid */}
      <div>
        <SectionHeader className="mb-2.5">Verified Stellar Assets</SectionHeader>
        <div className="grid max-h-[180px] grid-cols-2 gap-2.5 overflow-y-auto pr-0.5 sm:grid-cols-3">
          {filteredPopular.map((asset) => {
            const iss = knownAssetIssuer(asset, network) ?? "";
            const alreadyAdded = existingAssets.has(`${asset.code}:${iss}`);
            const isSelected = selected.some(
              (s) => `${s.code}:${s.issuer}` === `${asset.code}:${iss}`,
            );
            const available = Boolean(iss);

            return (
              <button
                key={`${asset.code}:${iss}`}
                type="button"
                aria-pressed={isSelected}
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
                  {asset.iconUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={asset.iconUrl}
                      alt=""
                      width={28}
                      height={28}
                      className="h-7 w-7 shrink-0 rounded-full object-cover shadow-inner"
                    />
                  ) : (
                    <span
                      className="mono flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white shadow-inner"
                      style={{ background: asset.color }}
                    >
                      {asset.code.slice(0, 2)}
                    </span>
                  )}
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
      </div>

      {/* Custom asset row */}
      <div className="flex gap-2 border-t border-white/[0.08] pt-4">
        <label htmlFor={assetCodeInputId} className="sr-only">Custom asset code</label>
        <input
          id={assetCodeInputId}
          className="input w-[110px] shrink-0 uppercase text-base sm:text-[13px]"
          placeholder="CODE"
          maxLength={12}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="next"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <label htmlFor={issuerInputId} className="sr-only">Custom asset issuer address</label>
        <input
          id={issuerInputId}
          className="input mono min-w-0 flex-1 text-base sm:text-[13px]"
          placeholder="Issuer G..."
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="done"
          value={issuer}
          onChange={(e) => setIssuer(e.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && canQueueCustom) {
              event.preventDefault();
              queueCustom();
            }
          }}
        />
        <Button
          variant="secondary"
          className="btn-sm shrink-0"
          disabled={!canQueueCustom}
          onClick={queueCustom}
        >
          Queue
        </Button>
      </div>

      {/* Queued trustlines */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
        <div className="flex min-h-8 items-center justify-between">
          <p className="text-[12px] font-semibold text-white">
            Queued Trustlines ({selected.length})
          </p>
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => setSelected([])}
              className="rounded-lg px-2 text-[12px] font-medium text-neutral-300 hover:text-[#FF453A]"
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
          <div className="scrollbar-none max-h-[160px] space-y-1 overflow-y-auto">
            {selected.map((s) => {
              const known = lookupKnownAsset(s.code, s.issuer, network);
              return (
                <div
                  key={`${s.code}:${s.issuer}`}
                  className="flex items-center justify-between gap-2 rounded-xl bg-white/[0.04] py-0.5 pl-2.5 pr-0.5"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    {known?.iconUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={known.iconUrl}
                        alt=""
                        width={20}
                        height={20}
                        className="h-5 w-5 shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <span
                        className="mono flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                        style={{ background: known?.color ?? "#5E5CE6" }}
                      >
                        {s.code.slice(0, 2)}
                      </span>
                    )}
                    <span className="truncate text-[12.5px] font-medium text-white">
                      {s.code}
                    </span>
                    <span className="mono hidden truncate text-[10.5px] text-neutral-500 sm:inline">
                      {formatTrezorAddress(s.issuer)}
                    </span>
                  </div>
                  <button
                    type="button"
                    aria-label={`Remove ${s.code} from the queue`}
                    onClick={() =>
                      setSelected((prev) =>
                        prev.filter(
                          (p) => `${p.code}:${p.issuer}` !== `${s.code}:${s.issuer}`,
                        ),
                      )
                    }
                    className="flex shrink-0 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:text-[#FF453A]"
                  >
                    <IconClose size={13} aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {selected.length > 0 && (
          <div className="pt-2 text-[11px] text-neutral-400">
            <p>Fee: {selectedFeeXlm} XLM — one atomic transaction.</p>
            <XlmFeeFiatValue amount={selectedFeeXlm} className="mt-0.5 block" />
          </div>
        )}
      </div>

      {/* Hardware Device Indicator */}
      {activeAccount?.hardware && (
        <Notice tone="accent" compact className="flex items-center justify-between">
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
        </Notice>
      )}

      {pendingSubmission && (
        <Notice tone={trackedSubmissionStatus === "status_unknown" ? "warn" : "info"}>
          <p role="status">
            {trackedSubmissionStatus === "status_unknown"
              ? "Trustline status unknown. Do not resubmit blindly."
              : "Trustline transaction accepted and confirming."}
          </p>
          <span className="mt-1 block break-all font-mono text-[10px] text-neutral-400">
            {pendingSubmission.network} · {pendingSubmission.hash}
          </span>
        </Notice>
      )}
      {error && <ErrorText message={error} />}

      <ModalFooter
        secondary={
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
        }
        primary={
          <Button
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
        }
      />
    </ModalBody>
  );
}
