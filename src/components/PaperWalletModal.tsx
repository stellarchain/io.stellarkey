"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { triggerHaptic } from "@/lib/haptics";
import { exportKeystoreWithPassword, exportVaultBackup } from "@/lib/vault";
import { openPaperWalletPrint } from "@/lib/paperwallet";
import { markBackupExported } from "@/lib/backup-health";
import { useToast } from "./Toast";
import { Button, Modal, ModalHeader } from "./ui";
import { IconAlert, IconCheck, IconLock } from "./icons";

export function PaperWalletModal({
  open,
  onClose,
  accountLabel,
  publicKey,
  secretOrPhrase,
  kind,
  path,
  accountId,
  password,
  networkLabel,
}: {
  open: boolean;
  onClose: () => void;
  accountLabel: string;
  publicKey: string;
  secretOrPhrase: string;
  kind: "mnemonic" | "secret";
  path?: string;
  /** Enables the encrypted keystore export for secret-key certificates. */
  accountId?: string;
  /** Verified at the parent password gate and used only for this export action. */
  password: string;
  networkLabel?: string;
}) {
  const [pubQr, setPubQr] = useState<string | null>(null);
  const [secQr, setSecQr] = useState<string | null>(null);
  const { toast } = useToast();

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

  function handleExportPdf() {
    if (!pubQr || !secQr) return;
    triggerHaptic("selection");
    openPaperWalletPrint({
      accountLabel,
      publicKey,
      secretOrPhrase,
      kind,
      path,
      networkLabel,
      pubQrDataUrl: pubQr,
      secQrDataUrl: secQr,
    });
  }

  async function handleEncryptedExport() {
    triggerHaptic("selection");
    try {
      let json: string;
      let filename: string;
      if (kind === "secret") {
        if (!accountId) return;
        const keystore = await exportKeystoreWithPassword(accountId, password);
        if (!keystore) {
          triggerHaptic("error");
          toast("Encrypted export unavailable for this account type", "error");
          return;
        }
        json = keystore;
        filename = `stellarkey-${accountLabel.toLowerCase().replace(/\s+/g, "-")}-keystore.json`;
      } else {
        json = await exportVaultBackup(password);
        filename = `stellarkey-backup-${new Date().toISOString().slice(0, 10)}.json`;
      }
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      if (kind === "mnemonic") markBackupExported();
      triggerHaptic("success");
      toast(
        kind === "secret"
          ? "Encrypted keystore downloaded — unlocks with your wallet password"
          : "Encrypted vault backup downloaded — unlocks with your wallet password",
        "success",
      );
    } catch (e) {
      triggerHaptic("error");
      toast(e instanceof Error ? e.message : "Encrypted export failed.", "error");
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
      <div className="p-4 sm:p-6">
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
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6">
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

        {/* Export Actions */}
        <div className="mt-6 grid grid-cols-2 gap-3 print:hidden">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button onClick={handleExportPdf} disabled={!pubQr || !secQr}>
            Export PDF Certificate
          </Button>
        </div>
        <button
          type="button"
          data-encrypted-export-action="true"
          onClick={() => void handleEncryptedExport()}
          className="group mt-3 flex w-full min-w-0 items-center gap-3 rounded-2xl border border-white/[0.1] bg-white/[0.04] px-4 py-3.5 text-left transition-colors hover:border-[#0A84FF]/40 print:hidden"
        >
          <IconLock size={16} className="shrink-0 text-neutral-400" />
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold text-neutral-200 transition-colors group-hover:text-[#0A84FF]">
              Download encrypted file instead
            </span>
            <span className="mt-0.5 block text-[12px] font-normal leading-snug text-neutral-500">
              {kind === "secret" ? "Keystore .json" : "Vault backup .json"} · locked by your
              wallet password
            </span>
          </span>
        </button>
      </div>
    </Modal>
  );
}
