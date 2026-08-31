"use client";

import { useEffect, useId, useMemo, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import QRCode from "qrcode";
import { useWalletIdentity, useWalletLedger } from "@/hooks/useWallet";
import {
  usePrivateBalanceRuntime,
  usePrivateBalanceRuntimeData,
} from "@/hooks/usePrivateBalanceRuntime";
import { NETWORKS } from "@/lib/stellar";
import { buildSep7PayUri } from "@/lib/payuri";
import { triggerHaptic } from "@/lib/haptics";
import { Button, CopyButton, HashValue, LoadingRegion, Modal, ModalHeader, Select, Tabs } from "./ui";
import { FiatValue } from "./FiatValue";
import { IconAlert, IconDownload, IconShare } from "./icons";

// The private receive body stays behind the feature's lazy boundary: the chunk
// only loads when someone actually switches the toggle to Private.
const PrivateReceiveContent = dynamic(
  () =>
    import("@/features/private-balance/components/ReceivePrivate").then(
      (module) => module.PrivateReceiveContent,
    ),
  {
    ssr: false,
    loading: () => <LoadingRegion label="Opening private receive address" />,
  },
);
const PrivateAssetSelector = dynamic(
  () =>
    import("@/features/private-balance/components/PrivateAssetSelector").then(
      (module) => module.PrivateAssetSelector,
    ),
  {
    ssr: false,
    loading: () => <LoadingRegion label="Opening private asset" className="min-h-16" />,
  },
);
const PrivateSetupContent = dynamic(
  () =>
    import("@/features/private-balance/components/PrivateSetupContent").then(
      (module) => module.PrivateSetupContent,
    ),
  {
    ssr: false,
    loading: () => <LoadingRegion label="Opening private payment" />,
  },
);

export function ReceiveModal({
  open,
  onClose,
  initialMode = "public",
}: {
  open: boolean;
  onClose: () => void;
  initialMode?: "public" | "private";
}) {
  if (!open) return null;
  return <ReceiveInner onClose={onClose} initialMode={initialMode} />;
}

function ReceiveInner({
  onClose,
  initialMode,
}: {
  onClose: () => void;
  initialMode: "public" | "private";
}) {
  const { activeAccount, network } = useWalletIdentity();
  const { balances } = useWalletLedger();
  const { availableAssets, requestRuntime } = usePrivateBalanceRuntime();
  const { configured } = usePrivateBalanceRuntimeData();
  const [receiveMode, setReceiveMode] = useState<"public" | "private">(initialMode);
  const [, startRuntimeTransition] = useTransition();
  const [selectedAssetKey, setSelectedAssetKey] = useState("native");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [showCustomRequest, setShowCustomRequest] = useState(false);
  const [requestAmount, setRequestAmount] = useState("");
  const [requestMemo, setRequestMemo] = useState("");
  const requestAmountId = useId();
  const requestMemoId = useId();

  const address = activeAccount?.publicKey ?? "";

  useEffect(() => {
    if (initialMode === "private") requestRuntime();
  }, [initialMode, requestRuntime]);

  const selectedAsset = useMemo(
    () => balances?.find((b) => b.key === selectedAssetKey) ?? null,
    [balances, selectedAssetKey]
  );

  const payload = useMemo(() => {
    if (!address) return "";
    if (showCustomRequest && (requestAmount.trim() || requestMemo.trim() || selectedAssetKey !== "native")) {
      return buildSep7PayUri({
        destination: address,
        amount: requestAmount.trim() || undefined,
        memo: requestMemo.trim() || undefined,
        assetCode: selectedAsset?.isNative ? undefined : selectedAsset?.code,
        assetIssuer: selectedAsset?.isNative ? undefined : (selectedAsset?.issuer ?? undefined),
      });
    }
    return address;
  }, [address, showCustomRequest, requestAmount, requestMemo, selectedAssetKey, selectedAsset]);

  useEffect(() => {
    let alive = true;
    if (!payload) return;
    void (async () => {
      try {
        const url = await QRCode.toDataURL(payload, {
          width: 440,
          margin: 1.5,
          color: {
            dark: "#000000",
            light: "#ffffff",
          },
        });
        if (alive) setQrDataUrl(url);
      } catch {
        if (alive) setQrDataUrl(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [payload]);

  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  async function handleShare() {
    try {
      triggerHaptic("light");
      await navigator.share({
        title: "My Stellar Address",
        text: `Send Stellar (${NETWORKS[network].label}) assets to: ${address}`,
        url: showCustomRequest ? payload : undefined,
      });
    } catch {
      // ignore user cancel
    }
  }

  const publicPanel = (
    <div className="flex flex-col items-center p-4 text-center sm:p-6">
      {activeAccount && (
        <div className="mb-3 flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-[12px] text-neutral-200">
          <span className="h-2 w-2 rounded-full bg-[#0A84FF]" />
          <span className="font-semibold">{activeAccount.label}</span>
        </div>
      )}

      {showCustomRequest && requestAmount.trim() && (
        <div className="fade-up mb-3 flex items-center gap-1.5 rounded-full border border-[#0A84FF]/30 bg-[#0A84FF]/15 px-3.5 py-1 text-[12px] font-semibold text-[#0A84FF]">
          <span>Requesting {requestAmount} {selectedAsset?.code ?? "XLM"}</span>
        </div>
      )}

      <div className="rounded-3xl bg-white p-3.5 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.9)]">
        {qrDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={qrDataUrl}
            alt="Address QR code"
            width={210}
            height={210}
            className="rounded-2xl"
          />
        ) : (
          <div className="skeleton h-[210px] w-[210px] rounded-2xl" />
        )}
      </div>

      <HashValue
        full
        value={address}
        className="mt-4 justify-center text-center text-[12.5px] leading-relaxed text-neutral-300"
      />

      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <CopyButton value={address} label="Copy Address" className="chip" />
        {canShare && (
          <Button
            variant="secondary"
            className="!h-8 !px-3 !text-[12px] flex items-center gap-1.5"
            onClick={handleShare}
          >
            <IconShare size={12} /> Share
          </Button>
        )}
        {qrDataUrl && (
          <a
            href={qrDataUrl}
            download="stellarkey-receive-qr.png"
            onClick={() => triggerHaptic("selection")}
            className="chip flex items-center gap-1.5 text-[12px]"
          >
            <IconDownload size={13} /> Save QR
          </a>
        )}
        <button
          type="button"
          onClick={() => {
            triggerHaptic("selection");
            setShowCustomRequest((value) => !value);
          }}
          className="chip text-[12px]"
        >
          {showCustomRequest ? "Hide Request Options" : "Set Amount / Memo"}
        </button>
      </div>

      {showCustomRequest && (
        <div className="fade-up mt-4 w-full space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 text-left">
          <p className="text-[12px] font-semibold text-white">Dynamic Payment Request (SEP-0007)</p>
          {balances && balances.length > 1 && (
            <div>
              <p className="mb-1 block text-[11px] font-medium text-neutral-400">
                Requested Asset
              </p>
              <Select
                value={selectedAssetKey}
                onChange={setSelectedAssetKey}
                ariaLabel="Requested asset"
                className="text-[13px]"
                options={balances.map((balance) => ({
                  value: balance.key,
                  label: balance.code,
                }))}
              />
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor={requestAmountId} className="mb-1 block text-[11px] font-medium text-neutral-400">
                Amount (optional)
              </label>
              <input
                id={requestAmountId}
                className="input text-base sm:text-[13px]"
                placeholder="e.g. 50"
                inputMode="decimal"
                autoComplete="off"
                value={requestAmount}
                onChange={(event) => setRequestAmount(event.target.value.replace(/[^0-9.]/g, ""))}
              />
              <FiatValue
                amount={requestAmount}
                code={selectedAsset?.code ?? "XLM"}
                issuer={selectedAsset?.issuer}
                isNative={selectedAsset?.isNative}
                className="mt-1 block text-[11px] text-neutral-500"
              />
            </div>
            <div>
              <label htmlFor={requestMemoId} className="mb-1 block text-[11px] font-medium text-neutral-400">
                Memo (optional)
              </label>
              <input
                id={requestMemoId}
                className="input text-base sm:text-[13px]"
                placeholder="e.g. Dinner"
                value={requestMemo}
                autoComplete="off"
                onChange={(event) => setRequestMemo(event.target.value)}
              />
            </div>
          </div>
          {payload.startsWith("web+stellar") && (
            <CopyButton
              value={payload}
              label="Copy SEP-0007 Link"
              className="chip w-full justify-center text-[11px]"
            />
          )}
        </div>
      )}

      <div className="mt-4 flex w-full items-start gap-2.5 rounded-2xl border border-white/10 bg-white/[0.02] px-3.5 py-3 text-left">
        <IconAlert size={15} className="mt-0.5 shrink-0 text-[#FF9F0A]" />
        <p className="text-[11.5px] leading-relaxed text-neutral-400">
          Only send Stellar network assets (XLM, USDC, etc.) to this address. Funds sent on other blockchains are unrecoverable.
        </p>
      </div>
    </div>
  );
  const panel = receiveMode === "private" ? (
    configured ? (
      <>
        <div className="flex justify-center px-4 pt-4 sm:px-6">
          <PrivateAssetSelector />
        </div>
        <PrivateReceiveContent />
      </>
    ) : (
      <PrivateSetupContent action="receive" />
    )
  ) : publicPanel;

  return (
    <Modal open onClose={onClose}>
      <ModalHeader
        title="Receive Funds"
        subtitle="Share a public or private receive address"
        onClose={onClose}
      />
      {availableAssets.length > 0 ? (
        <Tabs
          value={receiveMode}
          onChange={(next) => {
            setReceiveMode(next);
            if (next === "private") startRuntimeTransition(requestRuntime);
          }}
          ariaLabel="Receive address type"
          options={[
            { value: "public", label: "Public" },
            { value: "private", label: "Private" },
          ]}
          tabListClassName="mx-4 mt-4 sm:mx-6"
          panelClassName="min-h-56"
        >
          {panel}
        </Tabs>
      ) : panel}
    </Modal>
  );
}
