"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import { NETWORKS } from "@/lib/stellar";
import { getHorizonUrl } from "@/lib/stellar-endpoints";
import { lookupKnownAsset } from "@/lib/assets";
import { fmtAmount, fmtFiat } from "@/lib/format";
import {
  assetMetadataCacheKey,
  fetchIssuerDetails,
  getCachedAssetLogo,
  selectCurrentAssetMetadata,
  type BoundAssetMetadata,
} from "@/lib/toml";
import type { AssetBalance } from "@/lib/types";
import { triggerHaptic } from "@/lib/haptics";
import {
  assetDetailSubmissionView,
  type SubmissionResult,
} from "@/lib/submission";
import { assetPriceKey } from "@/lib/prices";
import { assetDetailBalanceSummary, deriveSacContractId } from "@/lib/transaction-intent";
import { networkFeeXlm } from "@/lib/api";
import { Button, CopyButton, ErrorText, HashValue, Modal, ModalHeader } from "./ui";
import { IconExternal, IconTrash } from "./icons";

export function AssetDetailModal({
  asset,
  favorite,
  onToggleFavorite,
  onClose,
}: {
  asset: AssetBalance | null;
  favorite: boolean;
  onToggleFavorite: (key: string) => void;
  onClose: () => void;
}) {
  const { network, trustAsset, refresh, privacyMode, xlmPriceUsd, fiatCurrency, fiatRates, minimumBalanceXlm, recommendedBaseFeeStroops, submissionStatus } = useWallet();
  const horizonUrl = getHorizonUrl(network);
  const metadataIdentity = asset && !asset.isNative && asset.issuer
    ? assetMetadataCacheKey(asset.code, asset.issuer, horizonUrl)
    : null;
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [metadata, setMetadata] = useState<BoundAssetMetadata | null>(() =>
    metadataIdentity && asset?.issuer
      ? {
          identity: metadataIdentity,
          logoUrl: getCachedAssetLogo(asset.code, asset.issuer, horizonUrl),
          issuerInfo: null,
        }
      : null,
  );
  const currentMetadata = selectCurrentAssetMetadata(metadataIdentity, metadata);
  const logoUrl = currentMetadata?.logoUrl ?? null;
  const issuerInfo = currentMetadata?.issuerInfo ?? null;

  // Fetch USD price for this asset when the modal opens
  useEffect(() => {
    if (!asset || network !== "mainnet") return;
    let alive = true;
    void (async () => {
      const { fetchAssetPrices } = await import("@/lib/prices");
      const p = await fetchAssetPrices([{ code: asset.code, issuer: asset.issuer, network }]);
      if (alive && Object.keys(p).length > 0) setPrices(p);
    })();
    return () => {
      alive = false;
    };
  }, [asset, network]);

  useEffect(() => {
    if (!asset || asset.isNative || !asset.issuer || !metadataIdentity) return;
    const code = asset.code;
    const issuer = asset.issuer;
    const identity = metadataIdentity;
    let alive = true;
    const cachedLogo = getCachedAssetLogo(code, issuer, horizonUrl);
    queueMicrotask(() => {
      if (alive) {
        setMetadata({ identity, logoUrl: cachedLogo, issuerInfo: null });
      }
    });
    void (async () => {
      const details = await fetchIssuerDetails(code, issuer, horizonUrl);
      if (alive && details) {
        setMetadata((previous) => ({
          identity,
          logoUrl:
            details.logoUrl ??
            (previous?.identity === identity ? previous.logoUrl : null),
          issuerInfo: details,
        }));
      }
    })();
    return () => {
      alive = false;
    };
  }, [asset, horizonUrl, metadataIdentity]);

  const unitPrice =
    asset && asset.isNative && network === "mainnet"
      ? xlmPriceUsd
      : asset
        ? prices[assetPriceKey(network, asset.code, asset.issuer)] ?? null
        : null;
  const totalUsd =
    asset && unitPrice !== null ? parseFloat(asset.balance) * unitPrice : null;
  const balanceSummary = asset
    ? assetDetailBalanceSummary(asset, minimumBalanceXlm)
    : null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingSubmission, setPendingSubmission] = useState<SubmissionResult | null>(null);
  const trackedSubmissionStatus = pendingSubmission ? submissionStatus(pendingSubmission) : null;
  const submissionView = assetDetailSubmissionView(
    error,
    pendingSubmission,
    trackedSubmissionStatus,
  );

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
        setError("Trustline removal failed on-chain. Check the balance and retry.");
        triggerHaptic("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, [onClose, refresh, trackedSubmissionStatus]);

  if (!asset) return null;

  const known = lookupKnownAsset(asset.code, asset.issuer, network);
  const sacContractId = deriveSacContractId(asset, NETWORKS[network].networkPassphrase);
  const balance = parseFloat(asset.balance);

  async function handleRemove() {
    if (!asset || !asset.issuer || pendingSubmission) return;
    setBusy(true);
    setError(null);
    try {
      const result = await trustAsset({ code: asset.code, issuer: asset.issuer, add: false });
      setPendingSubmission(result);
      triggerHaptic(result.status === "status_unknown" ? "warning" : "medium");
    } catch (e) {
      triggerHaptic("error");
      setError(e instanceof Error ? e.message : "Failed to remove trustline.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} wide>
      <ModalHeader
        title={asset.code}
        subtitle={known?.name ?? (asset.isNative ? "Stellar Lumens" : "Custom Asset")}
        onClose={onClose}
      />
      <div className="p-4 sm:p-6">
        <div className="flex flex-col items-center pb-2 pt-1">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt=""
              width={56}
              height={56}
              className="h-14 w-14 rounded-full object-cover shadow-xl"
            />
          ) : (
            <span
              className="flex h-14 w-14 items-center justify-center rounded-full text-[18px] font-bold text-white shadow-xl"
              style={
                known
                  ? { background: known.color }
                  : asset.isNative
                    ? { background: "linear-gradient(135deg, #0A84FF, #5E5CE6)" }
                    : { background: `hsl(${assetHueOf(asset.key)}, 70%, 50%)` }
              }
            >
              {asset.code.slice(0, 3)}
            </span>
          )}
          <p className="display-h mt-4 text-[32px] font-light text-white">
            {privacyMode ? "••••••" : fmtAmount(asset.balance)}{" "}
            <span className="mono text-[18px] text-neutral-400 font-normal">{asset.code}</span>
          </p>
          {known?.description && (
            <p className="mt-1.5 text-center text-[12px] text-neutral-400 max-w-xs">
              {known.description}
            </p>
          )}
          {!privacyMode && unitPrice !== null && (
            <div className="mt-3 flex items-baseline justify-center gap-2">
              <span className="mono text-[14px] font-semibold text-[#30D158]">
                {fmtFiat(unitPrice, fiatCurrency, fiatRates)}
              </span>
              <span className="text-[11px] text-neutral-500">per {asset.code}</span>
              <span className="text-neutral-600">·</span>
              <span className="mono text-[12px] font-medium text-neutral-300">
                {fmtFiat(totalUsd ?? 0, fiatCurrency, fiatRates)} total
              </span>
            </div>
          )}
        </div>

        <button
          type="button"
          aria-pressed={favorite}
          aria-label={
            favorite
              ? `Remove ${asset.code} from favorites`
              : `Mark ${asset.code} as favorite`
          }
          onClick={() => onToggleFavorite(asset.key)}
          className={`row-hover mt-5 flex min-h-14 w-full items-center gap-3.5 rounded-2xl border px-4 py-3.5 text-left transition-colors ${
            favorite
              ? "border-[#FFD60A]/25 bg-[#FFD60A]/10"
              : "border-white/[0.08] bg-white/[0.04]"
          }`}
        >
          <span
            aria-hidden="true"
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[19px] ${
              favorite ? "bg-[#FFD60A]/15 text-[#FFD60A]" : "bg-white/[0.07] text-neutral-400"
            }`}
          >
            {favorite ? "★" : "☆"}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15.5px] font-medium text-white">Favorite asset</span>
            <span className="block text-[12px] leading-tight text-neutral-400">
              Favorites appear first on Home
            </span>
          </span>
          <span
            className={`text-[14px] font-medium ${
              favorite ? "text-[#FFD60A]" : "text-neutral-400"
            }`}
          >
            {favorite ? "On" : "Off"}
          </span>
        </button>

        {/* Liability-aware balance availability for every asset. */}
        {balanceSummary && (
          <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-3.5 space-y-2.5 text-[12px]">
            <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
              <span>Balance Availability</span>
              <span className="mono text-neutral-300">{asset.code}</span>
            </div>
            <div className="space-y-1.5">
              {asset.isNative && (
                <div className="flex justify-between text-neutral-300">
                  <span>Live Minimum Balance</span>
                  <span className="mono">
                    {balanceSummary.minimumBalance === null
                      ? "Loading…"
                      : `${fmtAmount(balanceSummary.minimumBalance)} XLM`}
                  </span>
                </div>
              )}
              <div className="flex justify-between text-neutral-300">
                <span>Selling Liabilities</span>
                <span className="mono">
                  {fmtAmount(balanceSummary.sellingLiabilities)} {asset.code}
                </span>
              </div>
              <div className="border-t border-white/10 pt-1.5 flex justify-between font-semibold text-white">
                <span>Spendable Balance</span>
                <span className="mono text-[#30D158]">
                  {fmtAmount(balanceSummary.spendable)} {asset.code}
                </span>
              </div>
            </div>
          </div>
        )}

        <div className="panel-inset mt-5 divide-y divide-white/[0.08]">
          <Row label="Type">
            <span className="text-[13px] text-white">
              {asset.isNative ? "Native Lumens" : "Credit Alphanum"}
            </span>
          </Row>
          {(known?.anchorDomain || issuerInfo?.domain) && (
            <Row label="Issuer Domain">
              <a
                href={`https://${known?.anchorDomain ?? issuerInfo?.domain}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-[13px] text-neutral-200 font-medium hover:underline"
              >
                <span>{known?.anchorDomain ?? issuerInfo?.domain}</span>
                {(known || issuerInfo?.assetDeclared) && (
                  <span className="text-[9px] rounded bg-[#30D158]/15 px-1 py-0.5 font-bold uppercase tracking-wider text-[#30D158]">
                    Asset declared
                  </span>
                )}
              </a>
            </Row>
          )}
          {issuerInfo?.assetDeclared && issuerInfo.orgName && (
            <Row label="Organization">
              <span className="text-[13px] text-white font-medium">{issuerInfo.orgName}</span>
            </Row>
          )}
          {!asset.isNative && asset.issuer && (
            <Row label="Issuer">
              <HashValue
                value={asset.issuer}
                className="justify-end text-[12px] text-neutral-300"
              />
            </Row>
          )}
          {asset.limit && (
            <Row label="Trust Limit">
              <span className="mono text-[13px] text-neutral-300">
                {asset.limit === "922337203685.4775807" ? "Unlimited" : fmtAmount(asset.limit)}
              </span>
            </Row>
          )}
          <Row label="Network">
            <span className="text-[13px] text-white capitalize">{NETWORKS[network].label}</span>
          </Row>
          <Row label="Soroban SAC ID">
            <HashValue
              value={sacContractId}
              className="justify-end text-[11px] text-neutral-400"
            />
          </Row>
        </div>

        {(submissionView.notice || submissionView.error) && (
          <div className="mt-4">
            {submissionView.notice && pendingSubmission && (
              <div className={`mb-3 rounded-xl border p-3 text-[12px] leading-relaxed ${
                submissionView.notice.tone === "warn"
                  ? "border-[#FF9F0A]/30 bg-[#FF9F0A]/10 text-[#FF9F0A]"
                  : submissionView.notice.tone === "success"
                    ? "border-[#30D158]/30 bg-[#30D158]/10 text-[#30D158]"
                    : "border-[#0A84FF]/30 bg-[#0A84FF]/10 text-[#64D2FF]"
              }`}>
                {submissionView.notice.message}
                <span className="mt-1 block break-all font-mono text-[10px] text-neutral-400">
                  {pendingSubmission.network} · {pendingSubmission.hash}
                </span>
              </div>
            )}
            {submissionView.error && <ErrorText message={submissionView.error} />}
          </div>
        )}

        {/* Action Buttons */}
        <div className="mt-5 flex flex-wrap gap-2">
          <CopyButton
            value={sacContractId}
            label="Copy SAC ID"
            className="chip flex-1 justify-center"
          />
          <a
            className="chip flex-1 justify-center"
            href={
              NETWORKS[network].explorerAccountUrl(sacContractId)
            }
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => triggerHaptic("light")}
          >
            Explorer <IconExternal size={11} />
          </a>
        </div>

        {!asset.isNative && (
          <div className="mt-4">
            {balance > 0 ? (
              <p className="text-center text-[11.5px] text-neutral-500">
                Send or swap all {asset.code} balance before removing this trustline.
              </p>
            ) : (
              <div className="space-y-2">
                <p className="text-center text-[11.5px] text-neutral-500">
                  Network fee: {networkFeeXlm(recommendedBaseFeeStroops, 1)} XLM
                </p>
                <Button
                  variant="danger"
                  className="w-full flex items-center justify-center gap-2 !py-2.5 text-[13px]"
                  loading={busy}
                  disabled={busy || Boolean(pendingSubmission)}
                  onClick={() => void handleRemove()}
                >
                  <IconTrash size={14} /> Remove Trustline & Reclaim Reserve
                </Button>
              </div>
            )}
          </div>
        )}

        <Button variant="ghost" className="mt-4 w-full" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3">
      <span className="shrink-0 pt-0.5 text-[13px] font-medium text-neutral-400">
        {label}
      </span>
      <span className="min-w-0 text-right">{children}</span>
    </div>
  );
}

function assetHueOf(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 33 + key.charCodeAt(i)) >>> 0;
  return hash % 360;
}
