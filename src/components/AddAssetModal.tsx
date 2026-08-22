"use client";

import { useMemo, useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import { isValidPublicAddress } from "@/lib/vault";
import { lookupKnownAsset, POPULAR_ASSETS, type KnownAsset } from "@/lib/assets";
import { triggerHaptic } from "@/lib/haptics";
import { Button, ErrorText, Field, Modal, ModalHeader } from "./ui";
import { IconCheck, IconPlus, IconSearch } from "./icons";

export function AddAssetModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return <AddAssetInner onClose={onClose} />;
}

function AddAssetInner({ onClose }: { onClose: () => void }) {
  const { trustAsset, refresh, balances, network } = useWallet();
  const [search, setSearch] = useState("");
  const [code, setCode] = useState("");
  const [issuer, setIssuer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const existingCodes = useMemo(
    () => new Set((balances ?? []).map((b) => b.code.toUpperCase())),
    [balances],
  );

  const matchedKnown = useMemo(() => {
    return lookupKnownAsset(code.trim().toUpperCase());
  }, [code]);

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

  const valid =
    code.trim().length >= 1 &&
    code.trim().length <= 12 &&
    isValidPublicAddress(issuer) &&
    !existingCodes.has(code.trim().toUpperCase());

  async function handleAdd(assetCode: string, assetIssuer: string) {
    setBusy(true);
    setError(null);
    try {
      await trustAsset({ code: assetCode.trim().toUpperCase(), issuer: assetIssuer.trim(), add: true });
      triggerHaptic("success");
      onClose();
      window.setTimeout(() => void refresh(), 4000);
    } catch (e) {
      triggerHaptic("error");
      setError(e instanceof Error ? e.message : "Failed to add trustline.");
    } finally {
      setBusy(false);
    }
  }

  function handleIssuerChange(val: string) {
    const clean = val.trim();
    setIssuer(clean);
    if (isValidPublicAddress(clean)) {
      const match = POPULAR_ASSETS.find(
        (a) => a.mainnetIssuer === clean || a.testnetIssuer === clean
      );
      if (match && !code) {
        setCode(match.code);
        triggerHaptic("medium");
      }
    }
  }
  function handleSelectPopular(asset: KnownAsset) {
    triggerHaptic("selection");
    setCode(asset.code);
    const iss = network === "mainnet" ? asset.mainnetIssuer : (asset.testnetIssuer ?? asset.mainnetIssuer);
    if (iss) setIssuer(iss);
  }

  return (
    <Modal open onClose={onClose} wide>
      <ModalHeader
        title="Add Trustline"
        subtitle="Enable a verified or custom Stellar asset"
        onClose={onClose}
      />
      <div className="px-6 py-5">
        {/* Search bar for verified assets */}
        <div className="search-field mb-4 flex items-center gap-2">
          <IconSearch size={15} className="text-neutral-400 shrink-0" />
          <input
            placeholder="Search popular tokens (USDC, EURC, AQUA, BTC...)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-transparent text-[13.5px] text-white outline-none placeholder:text-neutral-500"
          />
        </div>

        {/* Popular Stellar Assets */}
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 mb-2.5">
            Verified Stellar Assets
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-[180px] overflow-y-auto pr-0.5">
            {filteredPopular.map((asset) => {
              const alreadyAdded = existingCodes.has(asset.code.toUpperCase());
              const iss = network === "mainnet" ? asset.mainnetIssuer : (asset.testnetIssuer ?? asset.mainnetIssuer);
              const available = Boolean(iss);

              return (
                <button
                  key={asset.code}
                  type="button"
                  disabled={alreadyAdded || !available || busy}
                  onClick={() => handleSelectPopular(asset)}
                  className={`flex items-center justify-between rounded-2xl border p-2.5 text-left transition-all ${
                    alreadyAdded
                      ? "border-white/5 bg-white/[0.02] opacity-50 cursor-not-allowed"
                      : code === asset.code
                        ? "border-[#0A84FF] bg-[#0A84FF]/10 text-white"
                        : "border-white/10 bg-white/[0.04] text-neutral-300 hover:border-white/20 hover:text-white"
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white shadow-inner"
                      style={{ background: asset.color }}
                    >
                      {asset.code.slice(0, 2)}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-semibold text-white">
                        {asset.code}
                      </p>
                      <p className="truncate text-[10.5px] text-neutral-400">
                        {asset.name}
                      </p>
                    </div>
                  </div>
                  {alreadyAdded ? (
                    <IconCheck size={14} className="text-[#30D158] shrink-0" />
                  ) : (
                    <IconPlus size={14} className="text-neutral-400 shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Custom Asset Form */}
        <div className="mt-5 space-y-3.5 border-t border-white/[0.08] pt-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
            Selected / Custom Asset Parameters
          </p>
          <Field label="Asset Code" hint="1–12 characters (e.g. USDC, AQUA)">
            <input
              className="input uppercase text-[13px]"
              placeholder="e.g. USDC"
              maxLength={12}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
          </Field>

          <Field label="Issuer Public Key" hint="Starts with 'G' (56 chars)">
            <input
              className="input mono text-[13px]"
              placeholder="G..."
              value={issuer}
              onChange={(e) => handleIssuerChange(e.target.value)}
            />
          </Field>

          {matchedKnown?.anchorDomain && (
            <div className="flex items-center justify-between rounded-xl bg-[#30D158]/10 border border-[#30D158]/20 px-3 py-1.5 text-[11.5px] text-[#30D158]">
              <span className="font-semibold">✓ Verified Issuer: {matchedKnown.name}</span>
              <span className="font-mono text-neutral-300">{matchedKnown.anchorDomain}</span>
            </div>
          )}
        </div>

        <div className="mt-4">
          <ErrorText message={error ?? ""} />
        </div>

        <div className="mt-6 flex gap-3">
          <Button variant="ghost" className="flex-1" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            className="flex-1"
            loading={busy}
            disabled={!valid || busy}
            onClick={() => void handleAdd(code, issuer)}
          >
            Add Trustline
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
      <ModalHeader title={title} onClose={onClose} />
      <div className="px-6 py-6">
        <p className="text-[14px] leading-relaxed text-neutral-300">{body}</p>
        <div className="mt-6 flex gap-3">
          <Button variant="ghost" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            className="flex-1"
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
