"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { triggerHaptic } from "@/lib/haptics";
import { Button, Modal, ModalHeader } from "./ui";
import { IconAlert, IconCheck } from "./icons";

export function PaperWalletModal({
  open,
  onClose,
  accountLabel,
  publicKey,
  secretOrPhrase,
  kind,
  path,
}: {
  open: boolean;
  onClose: () => void;
  accountLabel: string;
  publicKey: string;
  secretOrPhrase: string;
  kind: "mnemonic" | "secret";
  path?: string;
}) {
  const [pubQr, setPubQr] = useState<string | null>(null);
  const [secQr, setSecQr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [pUrl, sUrl] = await Promise.all([
          QRCode.toDataURL(publicKey, {
            margin: 1,
            width: 300,
            errorCorrectionLevel: "medium",
            color: { dark: "#000000", light: "#ffffff" },
          }),
          QRCode.toDataURL(secretOrPhrase, {
            margin: 1,
            width: 300,
            errorCorrectionLevel: "medium",
            color: { dark: "#000000", light: "#ffffff" },
          }),
        ]);
        if (alive) {
          setPubQr(pUrl);
          setSecQr(sUrl);
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      alive = false;
    };
  }, [publicKey, secretOrPhrase]);

  function handlePrint() {
    triggerHaptic("selection");
    if (typeof window !== "undefined") {
      window.print();
    }
  }

  if (!open) return null;

  return (
    <Modal open onClose={onClose} wide>
      <ModalHeader
        title="Cold Storage Paper Wallet"
        subtitle="Printable physical backup certificate"
        onClose={onClose}
      />
      <div className="p-6">
        {/* Certificate Container formatted for print and screen */}
        <div className="rounded-3xl border-2 border-dashed border-white/20 bg-white p-6 text-black shadow-2xl print:border-black print:p-8">
          {/* Header */}
          <div className="flex items-center justify-between border-b-2 border-black/15 pb-4">
            <div>
              <h2 className="text-[20px] font-black tracking-tight text-black uppercase">
                Wallet Certificate
              </h2>
              <p className="text-[12px] font-medium text-neutral-600">
                Stellar Network Cold Storage Backup
              </p>
            </div>
            <div className="text-right">
              <span className="inline-block rounded-md bg-black px-2 py-0.5 text-[11px] font-bold text-white uppercase">
                {accountLabel}
              </span>
              {path && (
                <p className="mono text-[10.5px] text-neutral-500 mt-0.5">{path}</p>
              )}
            </div>
          </div>

          {/* 2-Column QR Grid: Public vs Secret */}
          <div className="mt-6 grid grid-cols-2 gap-6">
            {/* Public Key Column */}
            <div className="flex flex-col items-center rounded-2xl border border-black/15 p-4 text-center bg-neutral-50">
              <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-500 mb-2">
                Public Address (Shareable)
              </span>
              <div className="h-[120px] w-[120px] rounded-lg bg-white p-1 shadow-sm flex items-center justify-center">
                {pubQr ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={pubQr} alt="Public Address QR" width={112} height={112} />
                ) : (
                  <div className="h-full w-full bg-neutral-200 animate-pulse rounded" />
                )}
              </div>
              <p className="mono mt-3 select-all break-all text-[10px] leading-relaxed text-black font-semibold">
                {publicKey}
              </p>
            </div>

            {/* Private Secret / Phrase Column */}
            <div className="flex flex-col items-center rounded-2xl border-2 border-dashed border-[#FF453A] p-4 text-center bg-red-50/40">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#FF453A] mb-2 flex items-center gap-1">
                <IconAlert size={12} />
                <span>{kind === "mnemonic" ? "Recovery Phrase" : "Secret Key (DO NOT SHARE)"}</span>
              </span>
              <div className="h-[120px] w-[120px] rounded-lg bg-white p-1 shadow-sm flex items-center justify-center">
                {secQr ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={secQr} alt="Secret QR" width={112} height={112} />
                ) : (
                  <div className="h-full w-full bg-neutral-200 animate-pulse rounded" />
                )}
              </div>
              <p className="mono mt-3 select-all break-all text-[10px] leading-relaxed text-black font-bold">
                {secretOrPhrase}
              </p>
            </div>
          </div>

          {/* Security Checklist Footer */}
          <div className="mt-6 border-t border-black/10 pt-3 text-[11px] text-neutral-600 space-y-1">
            <div className="flex items-center gap-1.5">
              <IconCheck size={12} className="text-[#30D158]" />
              <span>Generated client-side. Keep offline in a secure, fireproof location.</span>
            </div>
            <div className="flex items-center gap-1.5">
              <IconCheck size={12} className="text-[#30D158]" />
              <span>Compatible with Trezor & Ledger hardware recovery standards (BIP-39 / SLIP-0010).</span>
            </div>
            <div className="flex items-center gap-1.5">
              <IconCheck size={12} className="text-[#30D158]" />
              <span>Anyone with these keys controls 100% of funds on this account.</span>
            </div>
          </div>
        </div>

        {/* Print Action Buttons */}
        <div className="mt-6 flex gap-3 print:hidden">
          <Button variant="ghost" className="flex-1" onClick={onClose}>
            Close
          </Button>
          <Button className="flex-1 !bg-white !text-black hover:!bg-neutral-200" onClick={handlePrint}>
            Print / Save as PDF
          </Button>
        </div>
      </div>
    </Modal>
  );
}
