"use client";

import { useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import { looksLikeMnemonic, validateStellarSecret } from "@/lib/vault";
import { triggerHaptic } from "@/lib/haptics";
import { Button, CopyButton, ErrorText, Field } from "./ui";
import {
  IconAlert,
  IconCheck,
  IconDownload,
  IconKey,
  IconRefresh,
  IconSend,
  LogoMark,
} from "./icons";

type Mode = "create" | "import" | "restore";
type Step = "choose" | "password" | "reveal";

export function Onboarding() {
  const { createWallet, completeSetup, resetWallet, hasDeletedWalletBackup, restoreDeletedWallet } = useWallet();
  const [step, setStep] = useState<Step>("choose");
  const [mode, setMode] = useState<Mode>("create");
  const [secretInput, setSecretInput] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [revealed, setRevealed] = useState<string | null>(null);
  const [revealedKind, setRevealedKind] = useState<"mnemonic" | "secret">("secret");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const passwordValid = password.length >= 8;
  const passwordsMatch = password === confirmPassword;

  async function handlePasswordSubmit() {
    setError(null);

    if (mode === "restore") {
      if (!password) {
        setError("Please enter your vault password.");
        return;
      }
      setBusy(true);
      try {
        await restoreDeletedWallet(password);
        triggerHaptic("success");
      } catch (e) {
        triggerHaptic("error");
        setError(e instanceof Error ? e.message : "Incorrect password.");
      } finally {
        setBusy(false);
      }
      return;
    }

    if (!passwordValid) {
      setError("Password must be at least 8 characters.");
      triggerHaptic("warning");
      return;
    }
    if (!passwordsMatch) {
      setError("Passwords do not match.");
      triggerHaptic("warning");
      return;
    }
    if (
      mode === "import" &&
      !validateStellarSecret(secretInput) &&
      !looksLikeMnemonic(secretInput)
    ) {
      setError("Enter a valid secret key (S…) or a 12/24-word recovery phrase.");
      triggerHaptic("warning");
      return;
    }
    setBusy(true);
    try {
      const result = await createWallet(
        password,
        mode === "import"
          ? looksLikeMnemonic(secretInput)
            ? { mnemonic: secretInput }
            : { secret: secretInput.trim() }
          : {},
      );
      triggerHaptic("success");
      if (mode === "create") {
        setRevealed(result.revealed);
        setRevealedKind(result.kind);
        setStep("reveal");
      } else {
        completeSetup();
      }
    } catch (e) {
      triggerHaptic("error");
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  function backToChoose() {
    triggerHaptic("selection");
    setStep("choose");
    setError(null);
    setPassword("");
    setConfirmPassword("");
    setSecretInput("");
  }

  if (step === "choose") {
    return (
      <div className="fade-up relative z-10 mx-auto flex min-h-screen w-full max-w-4xl flex-col items-center justify-center px-6 py-16">
        <div className="flex flex-col items-center text-center">
          <LogoMark size={64} />
          <p className="eyebrow mt-8">Self-Custodial Stellar Wallet</p>
          <h1 className="display-h mt-4 max-w-3xl text-[44px] font-bold text-white sm:text-[64px] tracking-tight">
            Own your keys.
            <br />
            Own your money.
          </h1>
          <p className="mt-5 max-w-md text-[15.5px] leading-relaxed text-neutral-300">
            Wallet generates and encrypts your keys locally in your browser.
            Zero telemetry, zero custody, zero tracking — just pure Stellar.
          </p>
        </div>

        <div className="mt-10 flex flex-col gap-3 sm:flex-row w-full max-w-xs sm:max-w-md">
          <Button
            className="flex-1 !py-3.5 text-[15px] font-semibold shadow-lg shadow-blue-500/20"
            onClick={() => {
              triggerHaptic("selection");
              setMode("create");
              setStep("password");
            }}
          >
            <IconKey size={16} /> Create New Wallet
          </Button>
          <Button
            variant="ghost"
            className="flex-1 !py-3.5 text-[15px] font-semibold"
            onClick={() => {
              triggerHaptic("selection");
              setMode("import");
              setStep("password");
            }}
          >
            <IconDownload size={16} /> Import Existing
          </Button>
        </div>

        {hasDeletedWalletBackup && (
          <div className="mt-4">
            <button
              type="button"
              onClick={() => {
                triggerHaptic("selection");
                setMode("restore");
                setStep("password");
              }}
              className="flex items-center gap-2 rounded-2xl border border-[#30D158]/30 bg-[#30D158]/10 px-4 py-2 text-[13px] font-medium text-[#30D158] hover:bg-[#30D158]/15 transition-colors"
            >
              <IconRefresh size={14} />
              <span>Restore Previously Reset Wallet</span>
            </button>
          </div>
        )}

        <div className="mt-16 grid w-full max-w-3xl gap-6 sm:grid-cols-3">
          {[
            {
              icon: <IconKey size={18} className="text-[#0A84FF]" />,
              title: "Keys Stay Local",
              body: "Derived via SLIP-0010 HD algorithms and never sent to any server.",
            },
            {
              icon: <ShieldGlyph />,
              title: "Encrypted Vault",
              body: "Sealed using authenticated AES-GCM and PBKDF2 key derivation.",
            },
            {
              icon: <IconSend size={18} className="text-[#30D158]" />,
              title: "SOTA In-App Swaps",
              body: "Direct integration with the Stellar DEX orderbooks and path payments.",
            },
          ].map((f) => (
            <div
              key={f.title}
              className="flex flex-col items-center text-center p-5 rounded-3xl border border-white/10 bg-white/[0.03] backdrop-blur-md"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/[0.06] mb-3">
                {f.icon}
              </span>
              <p className="text-[14.5px] font-semibold text-white">{f.title}</p>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-neutral-400">
                {f.body}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-16 flex flex-col items-center gap-1.5 text-center">
          <p className="text-[12px] text-neutral-400">
            Connected to Stellar Testnet by default · Switchable to Mainnet anytime
          </p>
          <p className="text-[11px] text-neutral-500">
            Send · Receive · In-App DEX Swaps · Trustlines · Contacts · SEP-0007 Pay Links
          </p>
        </div>
      </div>
    );
  }

  if (step === "password") {
    return (
      <StepShell
        stepLabel={
          mode === "create"
            ? "Step 1 of 2"
            : mode === "restore"
              ? "Restore Deleted Wallet"
              : "Import Wallet"
        }
        title={
          mode === "create"
            ? "Create Your Password"
            : mode === "restore"
              ? "Enter Wallet Password"
              : "Import Your Vault"
        }
        subtitle={
          mode === "create"
            ? "This password encrypts your master seed locally on this device."
            : mode === "restore"
              ? "Enter the password you used for your previous wallet to restore all accounts and keys."
              : "Enter your private key or 12/24-word phrase and set a vault password."
        }
        onBack={backToChoose}
        backDisabled={busy}
      >
        {mode === "import" && (
          <Field label="Secret Key or Recovery Phrase" hint="Starts with 'S' or 12/24 words">
            <textarea
              className="input mono min-h-[85px] resize-none text-[13px]"
              placeholder="S... or apple banana cherry..."
              value={secretInput}
              onChange={(e) => setSecretInput(e.target.value)}
              spellCheck={false}
              autoComplete="off"
            />
          </Field>
        )}
        <div className="space-y-4">
          <Field label="Vault Password" hint={mode === "restore" ? undefined : "Minimum 8 characters"}>
            <input
              className="input text-[14px]"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              autoComplete={mode === "restore" ? "current-password" : "new-password"}
              onKeyDown={(e) => {
                if (e.key === "Enter" && mode === "restore") void handlePasswordSubmit();
              }}
            />
          </Field>
          {mode !== "restore" && (
            <Field label="Confirm Password">
              <input
                className="input text-[14px]"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat password"
                autoComplete="new-password"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handlePasswordSubmit();
                }}
              />
            </Field>
          )}
        </div>
        <ErrorText message={error ?? ""} />
        <Button
          className="w-full !py-3.5 text-[15px] font-semibold"
          loading={busy}
          disabled={busy}
          onClick={() => void handlePasswordSubmit()}
        >
          {mode === "create"
            ? "Continue to Secret Phrase"
            : mode === "restore"
              ? "Restore Wallet"
              : "Unlock & Import"}
        </Button>
      </StepShell>
    );
  }

  return (
    <StepShell
      stepLabel="Step 2 of 2"
      title="Save Your Recovery Phrase"
      subtitle="The only way to recover your wallet if you clear your browser or change devices. Write it down in order."
      onBack={() => {
        resetWallet();
        setStep("choose");
        setRevealed(null);
        setSaved(false);
        setPassword("");
        setConfirmPassword("");
      }}
      backLabel="Start Over"
    >
      <div className="rounded-2xl border border-[#FF9F0A]/30 bg-[#FF9F0A]/10 p-4">
        <div className="flex gap-3">
          <IconAlert size={16} className="mt-0.5 shrink-0 text-[#FF9F0A]" />
          <p className="text-[12.5px] leading-relaxed text-[#FF9F0A]">
            Anyone with these words controls your funds. Never share them with anyone, including support.
          </p>
        </div>
      </div>

      <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <span className="text-[12.5px] font-semibold uppercase tracking-wider text-neutral-400">
            {revealedKind === "mnemonic" ? "12-Word Recovery Phrase" : "Secret Key"}
          </span>
          <CopyButton value={revealed ?? ""} label="Copy" />
        </div>
        {revealedKind === "mnemonic" ? (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
            {revealed?.split(" ").map((w, i) => (
              <span
                key={i}
                className="rounded-xl border border-white/10 bg-white/[0.04] px-2 py-2 text-center text-[13px] text-white"
              >
                <span className="mr-1.5 text-[10.5px] text-neutral-500">{i + 1}</span>
                {w}
              </span>
            ))}
          </div>
        ) : (
          <p className="mono select-all break-all text-[13px] leading-relaxed text-white">
            {revealed}
          </p>
        )}
      </div>

      <button
        type="button"
        className="flex items-start gap-3 text-left pt-1"
        onClick={() => {
          triggerHaptic("selection");
          setSaved((s) => !s);
        }}
      >
        <span
          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-lg border transition-all ${
            saved
              ? "border-[#30D158] bg-[#30D158] text-black"
              : "border-white/20 bg-white/[0.05]"
          }`}
        >
          {saved && <IconCheck size={12} />}
        </span>
        <span className="text-[13px] leading-relaxed text-neutral-300">
          I have written down and stored my recovery phrase in a safe place.
        </span>
      </button>

      <Button
        className="w-full !py-3.5 text-[15px] font-semibold"
        disabled={!saved}
        onClick={() => {
          triggerHaptic("success");
          completeSetup();
        }}
      >
        Enter Wallet
      </Button>
    </StepShell>
  );
}

function StepShell({
  stepLabel,
  title,
  subtitle,
  children,
  onBack,
  backLabel = "Back",
  backDisabled = false,
}: {
  stepLabel: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
  onBack?: () => void;
  backLabel?: string;
  backDisabled?: boolean;
}) {
  return (
    <div className="fade-up relative z-10 mx-auto flex min-h-screen w-full max-w-[440px] sm:max-w-[520px] md:max-w-[560px] flex-col justify-center px-6 py-16">
      <div className="mb-8 flex items-center justify-between">
        <LogoMark size={42} />
        <p className="eyebrow">{stepLabel}</p>
      </div>
      <h1 className="display-h text-[30px] font-bold text-white tracking-tight">{title}</h1>
      <p className="mt-2 text-[14px] leading-relaxed text-neutral-400">{subtitle}</p>
      <div className="mt-6 space-y-4">{children}</div>
      {onBack && (
        <button
          type="button"
          className="mx-auto mt-7 block text-[13px] text-neutral-400 transition-colors hover:text-white"
          onClick={onBack}
          disabled={backDisabled}
        >
          ← {backLabel}
        </button>
      )}
    </div>
  );
}

function ShieldGlyph() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#5E5CE6"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3 5 6v5c0 4.7 3 8.4 7 10 4-1.6 7-5.3 7-10V6l-7-3Z" />
      <path d="m9.2 12 2 2 3.6-4" />
    </svg>
  );
}
