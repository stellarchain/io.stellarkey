"use client";

import { useRef, useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import { useToast } from "./Toast";
import {
  exportKeystoreUnlocked,
  exportVaultBackup,
  hasMnemonic,
  inspectVaultBackup,
  isEncryptedBackup,
  revealSecret,
  type VaultBackupInfo,
} from "@/lib/vault";
import { triggerHaptic } from "@/lib/haptics";
import { NETWORKS } from "@/lib/stellar";
import { Button, CopyButton, ErrorText, HashValue, Modal, ModalHeader, Notice } from "./ui";
import {
  IconCheck,
  IconDownload,
  IconEye,
  IconKey,
  IconRefresh,
  IconShield,
} from "./icons";
import { PaperWalletModal } from "./PaperWalletModal";

type Method = "file" | "phrase" | "secret" | "paper";
type Step =
  | "choose"
  | "method"
  | "password"
  | "secure"
  | "done"
  | "restore-pick"
  | "restore-password"
  | "restore-confirm";

export function BackupWizardModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;
  return <WizardInner onClose={onClose} />;
}

function WizardInner({ onClose }: { onClose: () => void }) {
  const { activeAccount, accounts, network, revealRecoveryPhrase, restoreWalletFromBackup } =
    useWallet();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("choose");
  const [method, setMethod] = useState<Method>("file");
  const [password, setPassword] = useState("");
  const [revealed, setRevealed] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [restoreFile, setRestoreFile] = useState<string | null>(null);
  const [restoreInfo, setRestoreInfo] = useState<VaultBackupInfo | null>(null);
  const [restorePw, setRestorePw] = useState("");
  const [paperOpen, setPaperOpen] = useState(false);

  const hasPhrase = hasMnemonic();
  const canReveal = activeAccount !== null && !activeAccount.watchOnly;
  const usesPassword = method !== "file";

  function handleClose() {
    // Wipe sensitive state on close
    setRevealed(null);
    setPassword("");
    onClose();
  }

  function goBack() {
    triggerHaptic("selection");
    setError(null);
    if (step === "method" || step === "restore-pick") setStep("choose");
    else if (step === "password") setStep("method");
    else if (step === "secure") setStep(usesPassword ? "password" : "method");
    else if (step === "restore-password") setStep("restore-pick");
    else if (step === "restore-confirm") setStep("restore-password");
  }

  function pickMethod(m: Method) {
    triggerHaptic("selection");
    setMethod(m);
    setError(null);
    setStep(m === "file" ? "secure" : "password");
  }

  async function handleVerify() {
    if (!activeAccount) return;
    setBusy(true);
    setError(null);
    try {
      let material: string;
      if (method === "phrase" || (method === "paper" && hasPhrase)) {
        material = await revealRecoveryPhrase(password);
      } else {
        material = await revealSecret(activeAccount.id, password);
      }
      setRevealed(material);
      triggerHaptic("success");
      setStep("secure");
    } catch (e) {
      triggerHaptic("error");
      setError(e instanceof Error ? e.message : "Failed to decrypt.");
    } finally {
      setBusy(false);
    }
  }

  function download(filename: string, json: string) {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleDownloadBackup() {
    setBusy(true);
    setError(null);
    try {
      download(
        `wallet-backup-${new Date().toISOString().slice(0, 10)}.json`,
        await exportVaultBackup(),
      );
      triggerHaptic("success");
      setStep("done");
    } catch (e) {
      triggerHaptic("error");
      setError(e instanceof Error ? e.message : "Backup failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDownloadKeystore() {
    if (!activeAccount) return;
    const json = await exportKeystoreUnlocked(activeAccount.id);
    if (!json) {
      triggerHaptic("error");
      toast("Keystore unavailable for this account type", "error");
      return;
    }
    download(
      `wallet-${activeAccount.label.toLowerCase().replace(/\s+/g, "-")}-keystore.json`,
      json,
    );
    triggerHaptic("success");
    toast("Encrypted keystore downloaded", "success");
  }

  function handleRestoreFile(file: File) {
    void (async () => {
      setError(null);
      try {
        const json = await file.text();
        if (!isEncryptedBackup(json)) {
          throw new Error(
            "This file is not an encrypted Wallet backup — it may be an outdated legacy export.",
          );
        }
        setRestoreFile(json);
        setRestoreInfo(null);
        setRestorePw("");
        // Fully-encrypted backup — need its password before we can inspect it
        setStep("restore-password");
      } catch (e) {
        triggerHaptic("error");
        setError(e instanceof Error ? e.message : "Not a valid backup file.");
      }
    })();
  }

  async function handleRestoreUnlock() {
    if (!restoreFile) return;
    setBusy(true);
    setError(null);
    try {
      const info = await inspectVaultBackup(restoreFile, restorePw);
      if (info.accountCount === 0) throw new Error("Backup contains no accounts.");
      setRestoreInfo(info);
      triggerHaptic("success");
      setStep("restore-confirm");
    } catch (e) {
      triggerHaptic("error");
      setError(e instanceof Error ? e.message : "Incorrect password.");
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmRestore() {
    if (!restoreFile) return;
    setBusy(true);
    try {
      const result = await restoreWalletFromBackup(restoreFile, restorePw || undefined);
      triggerHaptic("success");
      toast(
        `Restored ${result.accountCount} account${result.accountCount === 1 ? "" : "s"}${
          result.contactCount > 0 ? ` and ${result.contactCount} contact${result.contactCount === 1 ? "" : "s"}` : ""
        } — enter the backup's password to unlock`,
        "success",
      );
      handleClose();
      // App flips to the locked phase on its own — no reload needed.
    } catch (e) {
      setBusy(false);
      triggerHaptic("error");
      setError(e instanceof Error ? e.message : "Restore failed.");
    }
  }

  const stepDots: { current: number; total: number } | null =
    step === "method"
      ? { current: 1, total: usesPasswordTotal() }
      : step === "password"
        ? { current: 2, total: usesPasswordTotal() }
        : step === "secure"
          ? { current: method === "file" ? 2 : 3, total: usesPasswordTotal() }
          : step === "done"
            ? { current: usesPasswordTotal(), total: usesPasswordTotal() }
            : step === "restore-pick"
              ? { current: 1, total: 3 }
              : step === "restore-password"
                ? { current: 2, total: 3 }
                : step === "restore-confirm"
                  ? { current: 3, total: 3 }
                  : null;

  function usesPasswordTotal() {
    return method === "file" ? 3 : 4;
  }

  const header: Record<Step, { title: string; subtitle: string }> = {
    choose: { title: "Backup & Recovery", subtitle: "One guided flow to protect your wallet" },
    method: { title: "Back Up Wallet", subtitle: "Choose how you want to secure it" },
    password: { title: "Verify It's You", subtitle: "Sensitive material stays encrypted until now" },
    secure: {
      title:
        method === "file"
          ? "Download Backup"
          : method === "phrase"
            ? "Your Recovery Phrase"
            : method === "paper"
              ? "Paper Wallet"
              : "Your Secret Key",
      subtitle: "Store it somewhere safe and offline",
    },
    done: { title: "Backup Complete", subtitle: "Your wallet is recoverable now" },
    "restore-pick": { title: "Restore Wallet", subtitle: "Select your encrypted backup file" },
    "restore-password": {
      title: "Restore Wallet",
      subtitle: "Enter the backup password to decrypt it",
    },
    "restore-confirm": { title: "Restore Wallet", subtitle: "Review before replacing this wallet" },
  };

  const METHODS: {
    id: Method;
    icon: React.ReactNode;
    tint: string;
    title: string;
    sub: string;
    badge?: string;
    hidden?: boolean;
  }[] = [
    {
      id: "file",
      icon: <IconDownload size={17} />,
      tint: "#30D158",
      title: "Encrypted Backup File",
      sub: "Everything — accounts, contacts, settings · locked by your wallet password",
      badge: "Recommended",
    },
    {
      id: "phrase",
      icon: <IconKey size={17} />,
      tint: "#BF5AF2",
      title: "Recovery Phrase",
      sub: "12 words · recreates all derived accounts · Ledger & Trezor compatible",
      hidden: !hasPhrase,
    },
    {
      id: "secret",
      icon: <IconEye size={17} />,
      tint: "#0A84FF",
      title: "Secret Key",
      sub: `Current account only (${activeAccount?.label ?? "—"})`,
      hidden: !canReveal,
    },
    {
      id: "paper",
      icon: <IconShield size={17} />,
      tint: "#FF9F0A",
      title: "Paper Wallet",
      sub: "Printable offline certificate with QR codes",
      hidden: !canReveal,
    },
  ];

  return (
    <>
      <Modal open onClose={handleClose} wide dismissable={!busy}>
        <ModalHeader
          title={header[step].title}
          subtitle={header[step].subtitle}
          onClose={busy ? undefined : handleClose}
        />

        {/* Guided-flow progress dots */}
        {stepDots && (
          <div className="flex items-center justify-center gap-1.5 border-b border-white/[0.06] py-2.5">
            {Array.from({ length: stepDots.total }, (_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i + 1 < stepDots.current
                    ? "w-4 bg-[#30D158]"
                    : i + 1 === stepDots.current
                      ? "w-4 bg-[#0A84FF]"
                      : "w-1.5 bg-white/15"
                }`}
              />
            ))}
          </div>
        )}

        <div className="p-4 sm:p-6">
          {/* ---------- STEP: choose path ---------- */}
          {step === "choose" && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <PathCard
                icon={<IconShield size={20} />}
                tint="#30D158"
                title="Back Up Wallet"
                sub="Guided backup — file, recovery phrase, secret key or paper"
                onClick={() => {
                  triggerHaptic("selection");
                  setStep("method");
                }}
              />
              <PathCard
                icon={<IconRefresh size={20} />}
                tint="#0A84FF"
                title="Restore From Backup"
                sub="Recover all accounts from an encrypted backup file"
                onClick={() => {
                  triggerHaptic("selection");
                  setStep("restore-pick");
                }}
              />
            </div>
          )}

          {/* ---------- STEP: choose backup method ---------- */}
          {step === "method" && (
            <div className="space-y-2">
              {METHODS.filter((m) => !m.hidden).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => pickMethod(m.id)}
                  className="group flex w-full items-center gap-3.5 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3.5 text-left transition-all hover:border-[#0A84FF]/40 hover:bg-[#0A84FF]/[0.06] active:scale-[0.99]"
                >
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                    style={{ background: `${m.tint}1f`, color: m.tint }}
                  >
                    {m.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-[14px] font-semibold text-white">{m.title}</span>
                      {m.badge && (
                        <span className="rounded-full bg-[#30D158]/15 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-[#30D158]">
                          {m.badge}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-[12px] text-neutral-400">
                      {m.sub}
                    </span>
                  </span>
                  <svg
                    width="7"
                    height="12"
                    viewBox="0 0 8 14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="shrink-0 text-neutral-600 transition-colors group-hover:text-[#0A84FF]"
                  >
                    <path d="m1.5 1.5 5 5.5-5 5.5" />
                  </svg>
                </button>
              ))}
              <WizardFooter backLabel="Back" onBack={goBack} />
            </div>
          )}

          {/* ---------- STEP: password gate ---------- */}
          {step === "password" && (
            <div>
              <Notice tone="warn">
                Your {method === "secret" ? "secret key" : "recovery phrase"} is about to be
                decrypted on this device. Make sure no one is watching your screen.
              </Notice>
              <div className="mt-4">
                <input
                  className="input text-base sm:text-[14px]"
                  type="password"
                  placeholder="Wallet Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && password) void handleVerify();
                  }}
                />
              </div>
              {error && (
                <div className="mt-3">
                  <ErrorText message={error} />
                </div>
              )}
              <WizardFooter
                backLabel="Back"
                onBack={goBack}
                nextLabel="Verify & Reveal"
                loading={busy}
                nextDisabled={!password || busy}
                onNext={() => void handleVerify()}
              />
            </div>
          )}

          {/* ---------- STEP: secure the material ---------- */}
          {step === "secure" && (
            <div>
              {method === "file" && (
                <>
                  <div className="panel-inset divide-y divide-white/[0.08] px-4 text-[13px]">
                    <div className="flex items-center justify-between gap-4 py-2.5">
                      <span className="shrink-0 text-neutral-400">Contents</span>
                      <span className="text-right text-white">
                        {accounts.length} account{accounts.length === 1 ? "" : "s"}, contacts,
                        settings &amp; notes
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-4 py-2.5">
                      <span className="shrink-0 text-neutral-400">Encryption</span>
                      <span className="mono text-right text-[12px] text-neutral-300">
                        AES-256-GCM · whole file
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-4 py-2.5">
                      <span className="shrink-0 text-neutral-400">Unlocks with</span>
                      <span className="text-right text-white">Your wallet password</span>
                    </div>
                  </div>
                  <div className="mt-4">
                    <Button
                      className="w-full"
                      loading={busy}
                      disabled={busy}
                      onClick={() => void handleDownloadBackup()}
                    >
                      <IconDownload size={15} /> Download Encrypted Backup
                    </Button>
                    {canReveal && (
                      <button
                        type="button"
                        onClick={() => void handleDownloadKeystore()}
                        className="mt-2.5 w-full text-center text-[12px] font-medium text-neutral-500 transition-colors hover:text-[#0A84FF]"
                      >
                        Or download a keystore for {activeAccount?.label ?? "this account"} only
                      </button>
                    )}
                  </div>
                </>
              )}

              {method === "phrase" && revealed && (
                <>
                  <Notice tone="warn">
                    These words recreate your entire wallet. Write them down offline — anyone
                    with them controls your funds.
                  </Notice>
                  <div className="mt-3.5 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                        12-Word Recovery Phrase
                      </span>
                      <CopyButton value={revealed} label="Copy" />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {revealed.split(" ").map((word, i) => (
                        <span
                          key={`${i}-${word}`}
                          className="rounded-xl border border-white/10 bg-white/[0.04] px-2 py-2 text-center text-[13px] text-white"
                        >
                          <span className="mr-1.5 text-[10.5px] text-neutral-500">{i + 1}</span>
                          {word}
                        </span>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {method === "secret" && revealed && (
                <>
                  <Notice tone="warn">
                    This key controls the {activeAccount?.label ?? "current"} account. Never
                    share it or store it in the cloud.
                  </Notice>
                  <div className="mt-3.5 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                    <div className="mb-2.5 flex items-center justify-between gap-3">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                        Secret Key
                      </span>
                      <CopyButton value={revealed} label="Copy" />
                    </div>
                    <HashValue
                      full
                      value={revealed}
                      className="justify-center text-center text-[13px] leading-loose text-white"
                    />
                  </div>
                </>
              )}

              {method === "paper" && revealed && (
                <>
                  <Notice>
                    Print a tamper-evident offline certificate with QR codes for the{" "}
                    {activeAccount?.label ?? "current"} account. Store it like cash.
                  </Notice>
                  <Button className="mt-4 w-full" onClick={() => setPaperOpen(true)}>
                    <IconDownload size={15} /> Open Printable Certificate
                  </Button>
                </>
              )}

              {/* Acknowledgment gate for revealed material */}
              {method !== "file" && (
                <label className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-3 text-[12.5px] leading-relaxed text-neutral-300 transition-colors hover:bg-white/[0.05]">
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    onChange={(e) => setAcknowledged(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-[#0A84FF]"
                  />
                  I understand anyone with this material can move my funds, and I have stored it
                  safely offline.
                </label>
              )}

              {error && (
                <div className="mt-3">
                  <ErrorText message={error} />
                </div>
              )}

              {method !== "file" ? (
                <WizardFooter
                  backLabel="Back"
                  onBack={goBack}
                  nextLabel="I've Stored It Safely"
                  nextDisabled={!acknowledged}
                  onNext={() => {
                    triggerHaptic("success");
                    setStep("done");
                  }}
                />
              ) : (
                <WizardFooter backLabel="Back" onBack={goBack} />
              )}
            </div>
          )}

          {/* ---------- STEP: done ---------- */}
          {step === "done" && (
            <div className="flex flex-col items-center py-4 text-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-full border border-[#30D158]/30 bg-[#30D158]/10 text-[#30D158]">
                <IconCheck size={28} />
              </span>
              <p className="display-h mt-4 text-xl font-light text-white">Wallet Protected</p>
              <p className="mt-1 max-w-[300px] text-[13px] leading-relaxed text-neutral-400">
                {method === "file"
                  ? "Keep the backup file somewhere safe — you'll need your wallet password to restore it."
                  : method === "phrase"
                    ? "Your 12 words can recreate this wallet on any Stellar wallet, Ledger or Trezor."
                    : method === "paper"
                      ? "Store the printed certificate offline — treat it like cash."
                      : "Your secret key is safely stored. Never share it with anyone."}
              </p>
              <Button variant="ghost" className="mt-6 w-full" onClick={handleClose}>
                Done
              </Button>
            </div>
          )}

          {/* ---------- STEP: restore file picker ---------- */}
          {step === "restore-pick" && (
            <div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex w-full flex-col items-center rounded-3xl border border-dashed border-white/20 bg-white/[0.02] px-6 py-10 text-center transition-colors hover:border-[#0A84FF]/50 hover:bg-[#0A84FF]/[0.05]"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#0A84FF]/10 text-[#0A84FF]">
                  <IconDownload size={20} />
                </span>
                <span className="mt-3 text-[14px] font-semibold text-white">
                  Choose backup file
                </span>
                <span className="mt-1 text-[12px] text-neutral-500">
                  wallet-backup-YYYY-MM-DD.json
                </span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json,application/octet-stream"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleRestoreFile(f);
                  e.target.value = "";
                }}
              />
              {error && (
                <div className="mt-3">
                  <ErrorText message={error} />
                </div>
              )}
              <WizardFooter backLabel="Back" onBack={goBack} />
            </div>
          )}

          {/* ---------- STEP: restore password (encrypted backups) ---------- */}
          {step === "restore-password" && (
            <div>
              <Notice>
                This backup is fully encrypted. Enter the wallet password that was used when the
                backup was created.
              </Notice>
              <div className="mt-4">
                <input
                  className="input text-base sm:text-[14px]"
                  type="password"
                  placeholder="Backup password"
                  value={restorePw}
                  onChange={(e) => setRestorePw(e.target.value)}
                  autoComplete="current-password"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && restorePw) void handleRestoreUnlock();
                  }}
                />
              </div>
              {error && (
                <div className="mt-3">
                  <ErrorText message={error} />
                </div>
              )}
              <WizardFooter
                backLabel="Back"
                onBack={goBack}
                nextLabel="Decrypt & Review"
                loading={busy}
                nextDisabled={!restorePw || busy}
                onNext={() => void handleRestoreUnlock()}
              />
            </div>
          )}

          {/* ---------- STEP: restore confirm ---------- */}
          {step === "restore-confirm" && restoreInfo && (
            <div>
              <div className="panel-inset divide-y divide-white/[0.08] px-4 text-[13px]">
                <div className="flex items-center justify-between gap-4 py-2.5">
                  <span className="shrink-0 text-neutral-400">Accounts inside</span>
                  <span className="text-right font-semibold text-white">
                    {restoreInfo.accountCount}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4 py-2.5">
                  <span className="shrink-0 text-neutral-400">Contacts &amp; settings</span>
                  <span className="text-right text-white">
                    {restoreInfo.contactCount} contact{restoreInfo.contactCount === 1 ? "" : "s"} · settings included
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4 py-2.5">
                  <span className="shrink-0 text-neutral-400">Recovery phrase</span>
                  <span className="text-right text-white">
                    {restoreInfo.hasMnemonic ? "Included" : "Not included"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4 py-2.5">
                  <span className="shrink-0 text-neutral-400">Merchant archive</span>
                  <span className="text-right text-white">
                    {restoreInfo.hasMerchantArchive ? "Included" : "Not included"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4 py-2.5">
                  <span className="shrink-0 text-neutral-400">Encryption</span>
                  <span className="mono text-right text-[12px] text-neutral-300">
                    AES-256-GCM · whole file
                  </span>
                </div>
                {restoreInfo.exportedAt && (
                  <div className="flex items-center justify-between gap-4 py-2.5">
                    <span className="shrink-0 text-neutral-400">Exported</span>
                    <span className="text-right text-white">
                      {new Date(restoreInfo.exportedAt).toLocaleDateString(undefined, {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  </div>
                )}
              </div>
              <div className="mt-3.5">
                <Notice tone="warn">
                  This replaces the wallet currently on this device. You will unlock the
                  restored wallet with the backup&rsquo;s <strong>original password</strong>.
                </Notice>
              </div>
              {error && (
                <div className="mt-3">
                  <ErrorText message={error} />
                </div>
              )}
              <div className="mt-6 grid grid-cols-2 gap-3">
                <Button variant="ghost" disabled={busy} onClick={goBack}>
                  Back
                </Button>
                <Button
                  variant="danger"
                  loading={busy}
                  disabled={busy}
                  onClick={() => void handleConfirmRestore()}
                >
                  Restore Wallet
                </Button>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* Paper wallet certificate overlays the wizard (portal-stacked) */}
      {paperOpen && revealed && activeAccount && (
        <PaperWalletModal
          open
          onClose={() => setPaperOpen(false)}
          accountLabel={activeAccount.label}
          publicKey={activeAccount.publicKey}
          secretOrPhrase={revealed}
          kind={hasPhrase ? "mnemonic" : "secret"}
          path={activeAccount.path}
          accountId={activeAccount.id}
          networkLabel={NETWORKS[network].label}
        />
      )}
    </>
  );
}

function PathCard({
  icon,
  tint,
  title,
  sub,
  onClick,
}: {
  icon: React.ReactNode;
  tint: string;
  title: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col items-start gap-3 rounded-3xl border border-white/[0.08] bg-white/[0.03] p-5 text-left transition-all hover:border-white/[0.16] hover:bg-white/[0.06] active:scale-[0.98]"
    >
      <span
        className="flex h-11 w-11 items-center justify-center rounded-2xl"
        style={{ background: `${tint}1f`, color: tint }}
      >
        {icon}
      </span>
      <span>
        <span className="block text-[15px] font-semibold text-white">{title}</span>
        <span className="mt-1 block text-[12px] leading-relaxed text-neutral-400">{sub}</span>
      </span>
    </button>
  );
}

function WizardFooter({
  backLabel,
  onBack,
  nextLabel,
  onNext,
  nextDisabled = false,
  loading = false,
}: {
  backLabel: string;
  onBack: () => void;
  nextLabel?: string;
  onNext?: () => void;
  nextDisabled?: boolean;
  loading?: boolean;
}) {
  return (
    <div className={`mt-6 ${nextLabel ? "grid grid-cols-2 gap-3" : ""}`}>
      <Button variant="ghost" onClick={onBack}>
        {backLabel}
      </Button>
      {nextLabel && (
        <Button loading={loading} disabled={nextDisabled || loading} onClick={onNext}>
          {nextLabel}
        </Button>
      )}
    </div>
  );
}
