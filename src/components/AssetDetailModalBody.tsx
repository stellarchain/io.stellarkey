"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import {
  useWalletIdentity,
  useWalletLedger,
  useWalletMarket,
  useWalletPreferences,
  useWalletSubmission,
  useWalletTransactions,
} from "@/hooks/useWallet";
import { NETWORKS } from "@/lib/stellar";
import { getHorizonUrl } from "@/lib/stellar-endpoints";
import { lookupKnownAsset } from "@/lib/assets";
import { fmtAmount, fmtFiat } from "@/lib/format";
import {
  assetMetadataCacheKey,
  fetchIssuerDetails,
  getCachedAssetLogo,
  normalizeIssuerHomeDomain,
  selectCurrentAssetMetadata,
  type BoundAssetMetadata,
} from "@/lib/toml";
import type { AssetBalance } from "@/lib/types";
import { triggerHaptic } from "@/lib/haptics";
import {
  assetDetailSubmissionView,
  type SubmissionResult,
} from "@/lib/submission";
import { assetPriceKey, marketDataLabel, type MarketSamples } from "@/lib/prices";
import { assetDetailBalanceSummary, deriveSacContractId } from "@/lib/transaction-intent";
import { networkFeeXlm } from "@/lib/api";
import {
  Button,
  ConfirmModal,
  CopyButton,
  ErrorText,
  HashValue,
  ModalBody,
  ModalFooter,
  Notice,
} from "./ui";
import { IconCheck, IconExternal, IconStar, IconTrash } from "./icons";
import { AssetAvatar } from "./AssetAvatar";
import { XlmFeeFiatValue } from "./XlmFeeFiatValue";

/** Header the body reports so the owning shell shows the asset code and its known name. */
export type AssetDetailHeader = { title: string; subtitle?: string; onBack?: () => void };

export type AssetDetailModalBodyProps = {
  asset: AssetBalance;
  favorite: boolean;
  onToggleFavorite: (key: string) => void;
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
  onHeaderChange?: (header: AssetDetailHeader | null) => void;
};

export function AssetDetailModalBody({
  asset,
  favorite,
  onToggleFavorite,
  onClose,
  onBusyChange,
  onHeaderChange,
}: AssetDetailModalBodyProps) {
  const { network } = useWalletIdentity();
  const { minimumBalanceXlm, recommendedBaseFeeStroops } = useWalletLedger();
  const { xlmPriceSample, fiatRateSamples, fiatRates } = useWalletMarket();
  const { privacyMode, fiatCurrency } = useWalletPreferences();
  const { submissionStatus } = useWalletSubmission();
  const { trustAsset, refresh } = useWalletTransactions();
  const horizonUrl = getHorizonUrl(network);
  const known = lookupKnownAsset(asset.code, asset.issuer, network);
  const metadataIdentity = !asset.isNative && asset.issuer
    ? assetMetadataCacheKey(asset.code, asset.issuer, horizonUrl)
    : null;
  const [prices, setPrices] = useState<MarketSamples>({});
  const [metadata, setMetadata] = useState<BoundAssetMetadata | null>(() =>
    metadataIdentity && asset.issuer
      ? {
          identity: metadataIdentity,
          logoUrl: getCachedAssetLogo(asset.code, asset.issuer, horizonUrl),
          issuerInfo: null,
        }
      : null,
  );
  const currentMetadata = selectCurrentAssetMetadata(metadataIdentity, metadata);
  const logoUrl = known?.iconUrl ?? currentMetadata?.logoUrl ?? null;
  const issuerInfo = currentMetadata?.issuerInfo ?? null;

  const knownName = known?.name;
  useLayoutEffect(() => {
    if (!onHeaderChange) return;
    onHeaderChange({
      title: asset.code,
      subtitle: knownName ?? (asset.isNative ? "Stellar Lumens" : "Custom Asset"),
    });
    return () => onHeaderChange(null);
  }, [asset.code, asset.isNative, knownName, onHeaderChange]);

  // Fetch USD price for this asset when the modal opens
  useEffect(() => {
    if (network !== "mainnet") return;
    let alive = true;
    void (async () => {
      const { fetchAssetPriceSamples } = await import("@/lib/prices");
      const p = await fetchAssetPriceSamples([{ code: asset.code, issuer: asset.issuer, network }]);
      if (alive) setPrices(p);
    })();
    return () => {
      alive = false;
    };
  }, [asset, network]);

  useEffect(() => {
    if (asset.isNative || !asset.issuer || !metadataIdentity || known?.iconUrl) return;
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
  }, [asset, horizonUrl, known?.iconUrl, metadataIdentity]);

  const priceSample =
    asset.isNative && network === "mainnet"
      ? xlmPriceSample
      : prices[assetPriceKey(network, asset.code, asset.issuer)] ?? null;
  const unitPrice = priceSample?.value ?? null;
  const totalUsd = unitPrice !== null ? parseFloat(asset.balance) * unitPrice : null;
  const balanceSummary = assetDetailBalanceSummary(asset, minimumBalanceXlm);
  const trustlineFeeXlm = networkFeeXlm(recommendedBaseFeeStroops, 1);
  const [busy, setBusy] = useState(false);
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingSubmission, setPendingSubmission] = useState<SubmissionResult | null>(null);
  const trackedSubmissionStatus = pendingSubmission ? submissionStatus(pendingSubmission) : null;
  const removalConfirmed = trackedSubmissionStatus === "confirmed";
  const submissionView = assetDetailSubmissionView(
    error,
    pendingSubmission,
    trackedSubmissionStatus,
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
  }, [refresh, trackedSubmissionStatus]);

  const knownIssuerDomain = normalizeIssuerHomeDomain(known?.anchorDomain);
  const declaredIssuerDomain = normalizeIssuerHomeDomain(issuerInfo?.domain);
  const issuerDomain = knownIssuerDomain ?? declaredIssuerDomain;
  const issuerDomainSignal = knownIssuerDomain
    ? "Known asset"
    : issuerInfo?.assetDeclared && declaredIssuerDomain
      ? "Issuer-declared"
      : null;
  const sacContractId = deriveSacContractId(asset, NETWORKS[network].networkPassphrase);
  const balance = parseFloat(asset.balance);
  const displayBalance = privacyMode ? "••••••" : fmtAmount(asset.balance);
  const balanceDensity = displayBalance.length >= 18
    ? "long"
    : displayBalance.length >= 13
      ? "medium"
      : "compact";

  async function handleRemove() {
    if (!asset.issuer || pendingSubmission) return;
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
    <>
      <ModalBody>
        <div className="flex flex-col items-center pb-2 pt-1">
          <AssetAvatar
            code={asset.code}
            isNative={asset.isNative}
            logoUrl={logoUrl}
            background={known?.color ?? `hsl(${assetHueOf(asset.key)}, 70%, 50%)`}
            size={56}
          />
          <p
            className="balance-display mt-4 text-white"
            data-density={balanceDensity}
          >
            <span className="balance-display-value">{displayBalance}</span>
            <span className="balance-display-unit">{asset.code}</span>
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
                <span className="mt-1 block text-[10px] text-neutral-500">{marketDataLabel([priceSample, fiatRateSamples[fiatCurrency]])}</span>
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
          className="row-hover flex min-h-11 w-full items-center gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.025] px-3.5 py-2 text-left transition-colors"
        >
          <IconStar
            filled={favorite}
            size={18}
            className={`shrink-0 ${favorite ? "text-[#FFD60A]" : "text-neutral-500"}`}
          />
          <span className="flex-1 text-[14px] font-medium text-neutral-300">Favorite</span>
          {favorite && (
            <IconCheck size={14} className="shrink-0 text-[#FFD60A]" />
          )}
        </button>

        {/* Liability-aware balance availability for every asset. */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3.5 space-y-2.5 text-[12px]">
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
            <span>Balance Availability</span>
            <span className="mono text-neutral-300">{asset.code}</span>
          </div>
          <div className="space-y-1.5">
            {asset.isNative && (
              <div className="flex items-start justify-between gap-3 text-neutral-300">
                <span>Live Minimum Balance</span>
                <span className="mono min-w-0 max-w-[60%] break-words text-right">
                  {balanceSummary.minimumBalance === null
                    ? "Loading…"
                    : `${fmtAmount(balanceSummary.minimumBalance)} XLM`}
                </span>
              </div>
            )}
            <div className="flex items-start justify-between gap-3 text-neutral-300">
              <span>Selling Liabilities</span>
              <span className="mono min-w-0 max-w-[60%] break-words text-right">
                {fmtAmount(balanceSummary.sellingLiabilities)} {asset.code}
              </span>
            </div>
            <div className="flex items-start justify-between gap-3 border-t border-white/10 pt-1.5 font-semibold text-white">
              <span>Spendable Balance</span>
              <span className="mono min-w-0 max-w-[60%] break-words text-right text-[#30D158]">
                {fmtAmount(balanceSummary.spendable)} {asset.code}
              </span>
            </div>
          </div>
        </div>

        {!asset.isNative && asset.isAuthorized !== true && (
          <Notice tone="warn" compact>
            <p className="font-semibold text-white">
              {asset.isAuthorizedToMaintainLiabilities
                ? "Maintain liabilities only"
                : "Frozen by issuer"}
            </p>
            <p className="mt-1">
              This balance cannot be sent until the issuer grants full authorization.
            </p>
          </Notice>
        )}

        {!asset.isNative && asset.isClawbackEnabled && (
          <Notice compact>
            <p className="font-semibold text-white">Clawback enabled</p>
            <p className="mt-1">The issuer can remove and burn some or all of this balance.</p>
          </Notice>
        )}

        <div className="panel-inset divide-y divide-white/[0.08]">
          <Row label="Type">
            <span className="text-[13px] text-white">
              {asset.isNative ? "Native Lumens" : "Credit Alphanum"}
            </span>
          </Row>
          {issuerDomain && (
            <Row label="Issuer Domain">
              <a
                href={`https://${issuerDomain}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex tap items-center justify-end gap-1.5 text-[13px] font-medium text-neutral-200 underline decoration-white/30 underline-offset-2 hover:decoration-white"
              >
                <span>{issuerDomain}</span>
                {issuerDomainSignal && (
                  <span
                    className={`rounded px-1 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                      knownIssuerDomain
                        ? "bg-[#30D158]/15 text-[#30D158]"
                        : "bg-white/[0.08] text-neutral-400"
                    }`}
                  >
                    {issuerDomainSignal}
                  </span>
                )}
              </a>
            </Row>
          )}
          {issuerDomain && issuerDomainSignal && (
            <p className="-mt-1 px-4 pb-3 text-[11px] leading-snug text-neutral-500">
              {knownIssuerDomain
                ? "Matched StellarKey's bundled asset registry."
                : "Self-published by the issuer; this is not independent verification."}
            </p>
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

        {submissionView.notice && pendingSubmission && (
          <Notice
            tone={
              submissionView.notice.tone === "warn"
                ? "warn"
                : submissionView.notice.tone === "success"
                  ? "pos"
                  : "info"
            }
          >
            <p role="status">{submissionView.notice.message}</p>
            <span className="mt-1 block break-all font-mono text-[10px] text-neutral-400">
              {pendingSubmission.network} · {pendingSubmission.hash}
            </span>
          </Notice>
        )}
        {submissionView.error && <ErrorText message={submissionView.error} />}

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-2">
          <CopyButton
            value={sacContractId}
            label="Copy SAC ID"
            className="chip tap flex-1 justify-center"
          />
          <a
            className="chip tap flex-1 justify-center"
            href={
              NETWORKS[network].explorerAccountUrl(sacContractId)
            }
            target="_blank"
            rel="noopener noreferrer"
          >
            Explorer <IconExternal size={11} />
          </a>
        </div>

        {!asset.isNative && !removalConfirmed && (
          balance > 0 ? (
            <p className="text-center text-[11.5px] text-neutral-500">
              Send or swap all {asset.code} balance before removing this trustline.
            </p>
          ) : (
            <div className="space-y-2">
              <div className="text-center text-[11.5px] text-neutral-500">
                <p>Network fee: {trustlineFeeXlm} XLM</p>
                <XlmFeeFiatValue amount={trustlineFeeXlm} className="mt-0.5 block" />
              </div>
              <Button
                variant="danger"
                className="w-full"
                loading={busy}
                loadingLabel="Removing trustline"
                disabled={busy || Boolean(pendingSubmission)}
                onClick={() => setConfirmingRemoval(true)}
              >
                <IconTrash size={14} /> Remove trustline and reclaim reserve
              </Button>
            </div>
          )
        )}

        <ModalFooter
          primary={
            <Button variant={removalConfirmed ? "primary" : "ghost"} onClick={onClose}>
              {removalConfirmed ? "Done" : "Close"}
            </Button>
          }
        />
      </ModalBody>
      <ConfirmModal
        open={confirmingRemoval}
        title={`Remove ${asset.code} trustline?`}
        message={`The ${asset.code} trustline is removed from this account and its base reserve returns to your spendable XLM. Add the trustline again before receiving ${asset.code}.`}
        confirmLabel="Remove Trustline"
        destructive
        onConfirm={() => {
          setConfirmingRemoval(false);
          void handleRemove();
        }}
        onClose={() => setConfirmingRemoval(false)}
      />
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-3">
      <span className="shrink-0 text-[13px] font-medium text-neutral-400">
        {label}
      </span>
      <span className="min-w-0 text-right">{children}</span>
    </div>
  );
}

/** Favourite star; `./icons` has no star glyph yet. */
function assetHueOf(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 33 + key.charCodeAt(i)) >>> 0;
  return hash % 360;
}
