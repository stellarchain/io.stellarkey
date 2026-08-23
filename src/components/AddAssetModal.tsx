"use client";

import { useMemo, useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import { isValidPublicAddress } from "@/lib/vault";
import { shortenAddr } from "@/lib/format";
import { lookupKnownAsset, POPULAR_ASSETS, type KnownAsset } from "@/lib/assets";
import { triggerHaptic } from "@/lib/haptics";
import { Button, ErrorText, Modal, ModalHeader } from "./ui";
import { IconCheck, IconLedger, IconPlus, IconSearch, IconTrezor } from "./icons";

export function AddAssetModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return <AddAssetInner onClose={onClose} />;
}

function AddAssetInner({ onClose }: { onClose: () => void }) {
  const { trustAssets, refresh, balances, network, activeAccount } = useWallet();
  const [search, setSearch] = useState("");
  const [code, setCode] = useState("");
  const [issuer, setIssuer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Multi-select: queued trustlines added atomically in ONE transaction
  const [selected, setSelected] = useState<Array<{ code: string; issuer: string }>>([]);

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
    const key = `${asset.code.toUpperCase()}:${iss}`;
    setSelected((prev) =>
      prev.some((s) => `${s.code}:${s.issuer}` === key)
        ? prev.filter((s) => `${s.code}:${s.issuer}` !== key)
        : [...prev, { code: asset.code.toUpperCase(), issuer: iss }],
    );
  }

  function queueCustom() {
    triggerHaptic("medium");
    const c = code.trim().toUpperCase();
    const iss = issuer.trim();
    if (!/^[A-Z0-9]{1,12}$/.test(c) || !isValidPublicAddress(iss)) {
      setError("Enter a valid asset code and issuer first.");
      return;
    }
    const key = `${c}:${iss}`;
    const alreadyQueued = selected.some((s) => `${s.code}:${s.issuer}` === key);
    // Dedupe atomically inside the updater so rapid clicks can't create duplicates
    setSelected((prev) =>
      prev.some((s) => `${s.code}:${s.issuer}` === key)
        ? prev
        : [...prev, { code: c, issuer: iss }],
    );
    if (alreadyQueued) {
      setError(`${c} is already queued.`);
      return;
    }
    setError(null);
    setCode("");
    setIssuer("");
  }

  async function handleAddBatch() {
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
      await trustAssets(unique);
      triggerHaptic("success");
      onClose();
      window.setTimeout(() => void refresh(), 4000);
    } catch (e) {
      triggerHaptic("error");
      setError(e instanceof Error ? e.message : "Batch trustline failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} wide dismissable={!busy}>
      <ModalHeader
        title="Add Assets"
        subtitle="Select one or more — all added in a single atomic transaction"
        onClose={onClose}
      />
      <div className="p-6">
        {/* Search */}
        <div className="search-field mb-4 flex items-center gap-2">
          <IconSearch size={15} className="text-neutral-400 shrink-0" />
          <input
            placeholder="Search popular tokens (USDC, EURC, AQUA, BTC...)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-transparent text-[13.5px] text-white outline-none placeholder:text-neutral-500"
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
                className={`flex items-center justify-between rounded-2xl border p-2.5 text-left transition-all ${
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
          <input
            className="input !h-9 w-[110px] shrink-0 uppercase text-[13px]"
            placeholder="CODE"
            maxLength={12}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <input
            className="input mono !h-9 min-w-0 flex-1 text-[12.5px]"
            placeholder="Issuer G..."
            value={issuer}
            onChange={(e) => setIssuer(e.target.value)}
          />
          <Button
            variant="secondary"
            className="!h-9 shrink-0 !px-3 !text-[12px]"
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
                        {shortenAddr(s.issuer, 4, 4)}
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
          {selected.length > 1 && (
            <p className="pt-2 text-[11px] text-neutral-400">
              Fee: {(selected.length * 0.00001).toFixed(5)} XLM ({selected.length * 100} stroops)
              — one atomic transaction.
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
            disabled={selected.length === 0 || busy}
            onClick={() => void handleAddBatch()}
          >
            {busy
              ? "Submitting…"
              : selected.length > 1
                ? `Add ${selected.length} Trustlines · 1 Tx`
                : selected.length === 1
                  ? "Add Trustline · 1 Tx"
                  : "Add Trustlines"}
          </Button>
        </div>
      </div>
    </Modal>
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
      <div className="p-6">
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
