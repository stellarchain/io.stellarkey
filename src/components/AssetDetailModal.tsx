"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import { NETWORKS } from "@/lib/stellar";
import { lookupKnownAsset } from "@/lib/assets";
import { fmtAmount, fmtFiat } from "@/lib/format";
import { fetchIssuerDetails, getCachedAssetLogo, type IssuerDetails } from "@/lib/toml";
import type { AssetBalance } from "@/lib/types";
import { triggerHaptic } from "@/lib/haptics";
import { Button, CopyButton, ErrorText, Modal, ModalHeader } from "./ui";
import { IconExternal, IconTrash } from "./icons";

export function AssetDetailModal({
  asset,
  onClose,
}: {
  asset: AssetBalance | null;
  onClose: () => void;
}) {
  const { network, trustAsset, refresh, privacyMode, xlmPriceUsd, fiatCurrency, balances } = useWallet();
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [logoUrl, setLogoUrl] = useState<string | null>(() =>
    asset && !asset.isNative && asset.issuer
      ? getCachedAssetLogo(asset.code, asset.issuer)
      : null,
  );
  const [issuerInfo, setIssuerInfo] = useState<IssuerDetails | null>(null);

  // Fetch USD price for this asset when the modal opens
  useEffect(() => {
    if (!asset || network !== "mainnet") return;
    let alive = true;
    void (async () => {
      const { fetchAssetPrices } = await import("@/lib/prices");
      const p = await fetchAssetPrices([asset.code]);
      if (alive && Object.keys(p).length > 0) setPrices(p);
    })();
    return () => {
      alive = false;
    };
  }, [asset, network]);

  useEffect(() => {
    if (!asset || asset.isNative || !asset.issuer) return;
    const code = asset.code;
    const issuer = asset.issuer;
    let alive = true;
    void (async () => {
      const details = await fetchIssuerDetails(code, issuer, NETWORKS[network].horizonUrl);
      if (alive && details) {
        setIssuerInfo(details);
        if (details.logoUrl) setLogoUrl(details.logoUrl);
      }
    })();
    return () => {
      alive = false;
    };
  }, [asset, network]);

  const unitPrice =
    asset && asset.isNative
      ? xlmPriceUsd
      : asset
        ? prices[asset.code.trim().toUpperCase()] ?? null
        : null;
  const totalUsd =
    asset && unitPrice !== null ? parseFloat(asset.balance) * unitPrice : null;
  const trustlinesCount = (balances ?? []).filter((b) => !b.isNative).length;
  const totalReserve = 1.0 + trustlinesCount * 0.5;
  const spendableBalance = Math.max(0, parseFloat(asset?.balance ?? "0") - totalReserve).toFixed(4);
  const [calcAmount, setCalcAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!asset) return null;

  const known = lookupKnownAsset(asset.code);
  const balance = parseFloat(asset.balance);

  // Approximate USD rate
  const assetUsdRate = asset.isNative
    ? xlmPriceUsd ?? 0.12
    : asset.code === "USDC" || asset.code === "EURC"
      ? 1.0
      : asset.code === "AQUA"
        ? 0.0012
        : 0;

  const parsedCalc = parseFloat(calcAmount || asset.balance);
  const calculatedVal = !Number.isNaN(parsedCalc) && assetUsdRate > 0 ? parsedCalc * assetUsdRate : null;

  async function handleRemove() {
    if (!asset || !asset.issuer) return;
    setBusy(true);
    setError(null);
    try {
      await trustAsset({ code: asset.code, issuer: asset.issuer, add: false });
      triggerHaptic("success");
      onClose();
      window.setTimeout(() => void refresh(), 4000);
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
      <div className="px-6 py-6">
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
                {fmtFiat(unitPrice, fiatCurrency)}
              </span>
              <span className="text-[11px] text-neutral-500">per {asset.code}</span>
              <span className="text-neutral-600">·</span>
              <span className="mono text-[12px] font-medium text-neutral-300">
                {fmtFiat(totalUsd ?? 0, fiatCurrency)} total
              </span>
            </div>
          )}
        </div>

        {/* Stellar Reserve Health & Breakdown for Native XLM */}
        {asset.isNative && (
          <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-3.5 space-y-2.5 text-[12px]">
            <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
              <span>Account Reserve Breakdown</span>
              <span className="mono text-[#30D158]">Healthy</span>
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between text-neutral-300">
                <span>Base Account Reserve</span>
                <span className="mono">1.0000 XLM</span>
              </div>
              <div className="flex justify-between text-neutral-300">
                <span>Trustline Reserves ({trustlinesCount} × 0.5 XLM)</span>
                <span className="mono">{(trustlinesCount * 0.5).toFixed(4)} XLM</span>
              </div>
              <div className="border-t border-white/10 pt-1.5 flex justify-between font-semibold text-white">
                <span>Spendable Balance</span>
                <span className="mono text-[#30D158]">{spendableBalance} XLM</span>
              </div>
            </div>
          </div>
        )}

        {/* Live Asset Valuation & Converter Box */}
        {assetUsdRate > 0 && !privacyMode && (
          <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-3.5 space-y-2">
            <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
              <span>Valuation Calculator</span>
              <span className="mono text-[#30D158]">{fiatCurrency}</span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                inputMode="decimal"
                placeholder={fmtAmount(asset.balance)}
                value={calcAmount}
                onChange={(e) => setCalcAmount(e.target.value.replace(/,/g, "."))}
                className="input mono !h-8 text-[13px] flex-1"
              />
              <span className="text-[13px] font-medium text-neutral-300">
                {asset.code} =
              </span>
              <span className="mono text-[14px] font-semibold text-white">
                {calculatedVal !== null ? fmtFiat(calculatedVal, fiatCurrency) : "—"}
              </span>
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
            <Row label="Verified Domain">
              <a
                href={`https://${known?.anchorDomain ?? issuerInfo?.domain}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-[13px] text-[#30D158] font-medium hover:underline"
              >
                <span>{known?.anchorDomain ?? issuerInfo?.domain}</span>
                <span className="text-[9px] rounded bg-[#30D158]/15 px-1 py-0.5 font-bold uppercase tracking-wider">
                  Verified
                </span>
              </a>
            </Row>
          )}
          {issuerInfo?.orgName && (
            <Row label="Organization">
              <span className="text-[13px] text-white font-medium">{issuerInfo.orgName}</span>
            </Row>
          )}
          {known?.anchorDomain && (
            <Row label="Compliance (SEP-0008)">
              <span className="text-[12px] font-semibold text-[#30D158]">
                ✓ Regulated & Asset Anchored
              </span>
            </Row>
          )}
          {!asset.isNative && asset.issuer && (
            <Row label="Issuer">
              <span className="mono text-[12px] break-all text-neutral-300">
                {asset.issuer}
              </span>
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
            <span className="mono text-[11px] text-neutral-400 truncate max-w-[200px]">
              {asset.isNative
                ? "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"
                : asset.issuer
                  ? `C${asset.issuer.slice(1, 10)}...${asset.issuer.slice(-6)}`
                  : "Native WASM SAC"}
            </span>
          </Row>
        </div>

        {error && (
          <div className="mt-4">
            <ErrorText message={error} />
          </div>
        )}

        {/* Action Buttons */}
        <div className="mt-5 flex flex-wrap gap-2">
          <CopyButton
            value={
              asset.isNative
                ? "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"
                : asset.issuer ?? ""
            }
            label={asset.isNative ? "Copy SAC ID" : "Copy Issuer"}
            className="chip flex-1 justify-center"
          />
          <a
            className="chip flex-1 justify-center"
            href={
              asset.isNative
                ? `${NETWORKS[network].explorerAccountUrl("CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC")}`
                : asset.issuer
                  ? NETWORKS[network].explorerAccountUrl(asset.issuer)
                  : "#"
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
              <Button
                variant="danger"
                className="w-full flex items-center justify-center gap-2 !py-2.5 text-[13px]"
                loading={busy}
                onClick={() => void handleRemove()}
              >
                <IconTrash size={14} /> Remove Trustline & Reclaim Reserve
              </Button>
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
