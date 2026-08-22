"use client";

import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { useWallet } from "@/hooks/useWallet";
import { NETWORKS } from "@/lib/stellar";
import { buildSep7PayUri } from "@/lib/payuri";
import { triggerHaptic } from "@/lib/haptics";
import { Button, CopyButton, Modal, ModalHeader } from "./ui";
import { IconAlert, IconDownload, IconShare } from "./icons";

export function ReceiveModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return <ReceiveInner onClose={onClose} />;
}

function ReceiveInner({ onClose }: { onClose: () => void }) {
  const { activeAccount, network, balances } = useWallet();
  const [selectedAssetKey, setSelectedAssetKey] = useState("native");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [showCustomRequest, setShowCustomRequest] = useState(false);
  const [requestAmount, setRequestAmount] = useState("");
  const [requestMemo, setRequestMemo] = useState("");

  const address = activeAccount?.publicKey ?? "";

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

  return (
    <Modal open onClose={onClose}>
      <ModalHeader
        title="Receive Funds"
        subtitle={`Your ${NETWORKS[network].label} account`}
        onClose={onClose}
      />
      <div className="flex flex-col items-center p-6 text-center">
        {/* Active Account Identity Pill */}
        {activeAccount && (
          <div className="mb-3 flex items-center gap-1.5 rounded-full bg-white/[0.06] border border-white/10 px-3 py-1 text-[12px] text-neutral-200">
            <span className="h-2 w-2 rounded-full bg-[#0A84FF]" />
            <span className="font-semibold">{activeAccount.label}</span>
          </div>
        )}

        {/* Dynamic Request Pill */}
        {showCustomRequest && requestAmount.trim() && (
          <div className="fade-in mb-3 flex items-center gap-1.5 rounded-full bg-[#0A84FF]/15 border border-[#0A84FF]/30 px-3.5 py-1 text-[12px] font-semibold text-[#0A84FF]">
            <span>Requesting {requestAmount} {selectedAsset?.code ?? "XLM"}</span>
          </div>
        )}

        {/* QR Code Container with specular border */}
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

        <p className="mono mt-4 select-all break-all text-center text-[12.5px] leading-relaxed text-neutral-300 max-w-sm">
          {address}
        </p>

        {/* Action buttons */}
        <div className="mt-4 flex flex-wrap justify-center items-center gap-2">
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
              download="stellar-receive-qr.png"
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
              setShowCustomRequest((v) => !v);
            }}
            className="chip text-[12px]"
          >
            {showCustomRequest ? "Hide Request Options" : "Set Amount / Memo"}
          </button>
        </div>

        {/* Custom request configuration */}
        {showCustomRequest && (
          <div className="fade-in mt-4 w-full rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 space-y-3 text-left">
            <p className="text-[12px] font-semibold text-white">Dynamic Payment Request (SEP-0007)</p>
            {balances && balances.length > 1 && (
              <div>
                <label className="block text-[11px] font-medium text-neutral-400 mb-1">
                  Requested Asset
                </label>
                <select
                  value={selectedAssetKey}
                  onChange={(e) => {
                    triggerHaptic("selection");
                    setSelectedAssetKey(e.target.value);
                  }}
                  className="input text-[13px] cursor-pointer"
                >
                  {balances.map((b) => (
                    <option key={b.key} value={b.key} className="bg-neutral-900 text-white">
                      {b.code}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-medium text-neutral-400 mb-1">
                  Amount (optional)
                </label>
                <input
                  className="input text-[13px]"
                  placeholder="e.g. 50"
                  inputMode="decimal"
                  value={requestAmount}
                  onChange={(e) => setRequestAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-neutral-400 mb-1">
                  Memo (optional)
                </label>
                <input
                  className="input text-[13px]"
                  placeholder="e.g. Dinner"
                  value={requestMemo}
                  onChange={(e) => setRequestMemo(e.target.value)}
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
    </Modal>
  );
}
