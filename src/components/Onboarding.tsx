"use client";

import { useEffect, useState } from "react";
import { useWalletLifecycleActions } from "@/hooks/useWallet";
import { isEncryptedBackup, looksLikeMnemonic, validateStellarSecret } from "@/lib/vault";
import { triggerHaptic } from "@/lib/haptics";
import { estimatePasswordStrength, type PasswordStrength } from "@/lib/password-strength";
import { markBackupVerified } from "@/lib/backup-health";
import { BRAND_NAME } from "@/lib/brand";
import {
  readStandaloneDisplay,
  shouldPrioritizeStandaloneRestore,
} from "@/lib/install-handoff";
import { Button, CopyButton, ErrorText, Field, HashValue, IOSBackButton, Notice } from "./ui";
import { PublicFooter } from "./PublicFooter";
import {
  IconAlert,
  IconCheck,
  IconDownload,
  IconKey,
  IconPlus,
  IconRefresh,
  IconShield,
  IconTrezor,
  LogoMark,
} from "./icons";

type Mode = "create" | "import" | "restore" | "hardware";
type Step = "choose" | "hardware" | "password" | "reveal" | "verify";

/* Ambient background — two soft light fields drifting behind everything */
function Ambient() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute -top-40 left-1/2 h-[480px] w-[720px] -translate-x-1/2 rounded-full bg-[#0A84FF]/[0.13] blur-[120px]" />
      <div className="absolute -bottom-52 -left-40 h-[420px] w-[560px] rounded-full bg-[#5E5CE6]/[0.10] blur-[110px]" />
      <div className="absolute -right-48 top-1/3 h-[380px] w-[480px] rounded-full bg-[#30D158]/[0.06] blur-[110px]" />
    </div>
  );
}

export function Onboarding() {
  const {
    createWallet,
    completeSetup,
    resetWallet,
    restoreWalletFromBackup,
    createHardwareVault,
  } = useWalletLifecycleActions();
  const [pendingBackupJson, setPendingBackupJson] = useState<string | null>(null);
  const [hwInfo, setHwInfo] = useState<{ publicKey: string; path: string; index: number } | null>(null);
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
  const [challengeIndices, setChallengeIndices] = useState<number[]>([2, 6, 10]);
  const [wordBank, setWordBank] = useState<string[]>([]);
  const [selectedWords, setSelectedWords] = useState<string[]>([]);
  const [verifyFailed, setVerifyFailed] = useState(false);
  const [standaloneLaunch] = useState(readStandaloneDisplay);

  // Preload + init the connect bundle when the user lands on the hardware
  // step so the device interaction can start immediately after their click.
  useEffect(() => {
    if (step === "hardware") {
      void import("@/lib/hardware")
        .then(({ warmTrezorConnect }) => warmTrezorConnect())
        .catch(() => {
          // The connect button retries and reports the failure in the hardware step.
        });
    }
  }, [step]);

  const passwordValid = password.length >= 8;
  const passwordsMatch = password === confirmPassword;
  const passwordStrength = estimatePasswordStrength(password);

  async function handleRestoreBackupFile(file: File) {
    const json = await file.text();
    if (isEncryptedBackup(json)) {
      // Fully-encrypted backup — ask for the backup's password first
      setPendingBackupJson(json);
      setError(null);
      setMode("restore");
      setStep("password");
      return;
    }
    triggerHaptic("error");
    setError(
      "This file is not an encrypted Wallet backup — it may be an outdated legacy export.",
    );
  }

  function go(to: Step, m?: Mode) {
    triggerHaptic("selection");
    if (m) setMode(m);
    setError(null);
    setStep(to);
  }

  async function handleTrezorConnect() {
    setBusy(true);
    setError(null);
    try {
      const { connectTrezorDevice } = await import("@/lib/hardware");
      const info = await connectTrezorDevice(0);
      setHwInfo({ publicKey: info.publicKey, path: info.path, index: info.index });
      triggerHaptic("success");
    } catch (e) {
      triggerHaptic("error");
      setError(e instanceof Error ? e.message : "Could not reach a Trezor device.");
    } finally {
      setBusy(false);
    }
  }

  async function handlePasswordSubmit() {
    setError(null);

    if (mode === "hardware") {
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
      if (!hwInfo) {
        setError("Connect your Trezor first.");
        return;
      }
      setBusy(true);
      try {
        await createHardwareVault(password, {
          publicKey: hwInfo.publicKey,
          path: hwInfo.path,
          index: hwInfo.index,
          device: "trezor",
        });
        triggerHaptic("success");
        completeSetup();
      } catch (e) {
        triggerHaptic("error");
        setError(e instanceof Error ? e.message : "Could not create the vault.");
      } finally {
        setBusy(false);
      }
      return;
    }

    if (mode === "restore") {
      if (!password) {
        setError("Please enter your vault password.");
        return;
      }
      setBusy(true);
      try {
        if (!pendingBackupJson) throw new Error("Choose an encrypted backup file first.");
        await restoreWalletFromBackup(pendingBackupJson, password);
        markBackupVerified();
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
    setStep("choose");
    setError(null);
    setPassword("");
    setConfirmPassword("");
    setSecretInput("");
  }

  /** Enter the verification quiz with 3 random distinct word positions. */
  function startVerify() {
    const words = (revealed ?? "").split(" ");
    if (words.length < 12) {
      completeSetup();
      return;
    }
    const picked = new Set<number>();
    while (picked.size < 3) picked.add(Math.floor(Math.random() * words.length));
    const indices = [...picked].sort((a, b) => a - b);
    // Word bank: the 3 targets + 4 distractor words from the phrase, shuffled
    const distractors = words
      .map((w, i) => ({ w, i }))
      .filter(({ i }) => !indices.includes(i))
      .sort(() => Math.random() - 0.5)
      .slice(0, 4)
      .map(({ w }) => w);
    setWordBank([...indices.map((i) => words[i]), ...distractors].sort(() => Math.random() - 0.5));
    setChallengeIndices(indices);
    setSelectedWords([]);
    setVerifyFailed(false);
    triggerHaptic("selection");
    setStep("verify");
  }

  /* ------------------------------------------------------------------ */
  /* CHOOSE — the landing                                                */
  /* ------------------------------------------------------------------ */
  if (step === "choose") {
    const prioritizeRestore = shouldPrioritizeStandaloneRestore({
      standalone: standaloneLaunch,
      walletExists: false,
    });
    const restorePath = (
      <label className="group flex w-full cursor-pointer items-center gap-3.5 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3.5 text-left transition-all hover:border-[#30D158]/40 hover:bg-[#30D158]/[0.06] active:scale-[0.99]">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#30D158]/12 text-[#30D158]">
          <IconRefresh size={16} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-semibold text-white">
            Restore From Backup
          </span>
          <span className="mt-0.5 block truncate text-[12px] text-neutral-400">
            Encrypted wallet-backup .json file
          </span>
        </span>
        <input
          type="file"
          accept="application/json,.json,application/octet-stream"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleRestoreBackupFile(f);
            e.target.value = "";
          }}
        />
      </label>
    );
    return (
      <div className="relative z-10 min-h-screen w-full overflow-hidden">
        <Ambient />
        <div className="app-safe-top app-safe-top-pad-14 fade-up relative mx-auto grid min-h-screen w-full max-w-6xl grid-cols-1 items-center gap-12 px-6 py-14 lg:grid-cols-2 lg:gap-16">
          {/* Brand / pitch column */}
          <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
            <LogoMark size={56} />
            <p className="eyebrow mt-7">{BRAND_NAME} · Self-custodial Stellar wallet</p>
            <h1 className="display-h mt-4 text-[42px] font-bold leading-[1.04] tracking-tight text-white sm:text-[56px]">
              Own your keys.
              <br />
              Own your money.
            </h1>
            <p className="mt-5 max-w-md text-[15.5px] leading-relaxed text-neutral-300">
              Keys are generated and encrypted locally in your browser. Zero telemetry,
              zero custody, zero tracking — just pure Stellar.
            </p>

            <ul className="mt-9 hidden w-full max-w-md space-y-0 lg:block">
              {[
                {
                  icon: <IconKey size={16} className="text-[#0A84FF]" />,
                  title: "Keys stay local",
                  body: "SLIP-0010 HD derivation — nothing ever leaves the device.",
                },
                {
                  icon: <IconShield size={16} className="text-[#5E5CE6]" />,
                  title: "Encrypted vault",
                  body: "AES-256-GCM with PBKDF2, sealed by your password.",
                },
                {
                  icon: <IconCheck size={16} className="text-[#30D158]" />,
                  title: "Full Stellar toolkit",
                  body: "DEX swaps, multi-sig, hardware keys, trustlines, pay links.",
                },
              ].map((f, i) => (
                <li
                  key={f.title}
                  className={`flex items-start gap-3.5 py-3.5 ${i > 0 ? "border-t border-white/[0.07]" : ""}`}
                >
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/[0.06]">
                    {f.icon}
                  </span>
                  <span>
                    <span className="block text-[14px] font-semibold text-white">{f.title}</span>
                    <span className="mt-0.5 block text-[12.5px] leading-relaxed text-neutral-400">
                      {f.body}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* Action card */}
          <div className="mx-auto w-full max-w-[440px]">
            <div className="rounded-[28px] border border-white/[0.12] bg-[#121214]/95 p-6 shadow-[0_25px_70px_-15px_rgba(0,0,0,0.9)] backdrop-blur-2xl">
              {prioritizeRestore && (
                <div role="status" className="mb-4 rounded-2xl border border-[#0A84FF]/25 bg-[#0A84FF]/[0.08] p-4">
                  <p className="text-[13px] font-semibold text-white">Restore your encrypted backup first</p>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-neutral-300">
                    This Home Screen app has its own local storage. Your Safari wallet is still
                    on this device; restore its encrypted backup here to continue safely.
                  </p>
                </div>
              )}
              <p className="px-1 pb-4 text-[12px] font-semibold uppercase tracking-wider text-neutral-400">
                {prioritizeRestore ? "Continue your wallet" : "Get started"}
              </p>
              <div className="space-y-2.5">
                {prioritizeRestore && restorePath}
                <OnboardPath
                  icon={<IconPlus size={17} />}
                  tint="#0A84FF"
                  title="Create New Wallet"
                  sub="Generate a fresh 12-word recovery phrase"
                  onClick={() => go("password", "create")}
                  primary
                />
                <OnboardPath
                  icon={<IconDownload size={17} />}
                  tint="#5E5CE6"
                  title="Import Existing Wallet"
                  sub="Secret key or 12/24-word recovery phrase"
                  onClick={() => go("password", "import")}
                />
                <OnboardPath
                  icon={<IconTrezor size={17} />}
                  tint="#34d399"
                  title="Connect Trezor"
                  sub="Pair directly — no recovery phrase needed"
                  onClick={() => go("hardware", "hardware")}
                />
                {!prioritizeRestore && restorePath}
                {error && <ErrorText message={error} />}
              </div>

            </div>

            <p className="mt-5 text-center text-[11.5px] text-neutral-400">
              Starts on Stellar Testnet · switch to Mainnet anytime
            </p>
          </div>
        </div>
        <PublicFooter compact />
      </div>
    );
  }

  /* ------------------------------------------------------------------ */
  /* HARDWARE — pair a Trezor directly, no phrase                        */
  /* ------------------------------------------------------------------ */
  if (step === "hardware") {
    return (
      <StepShell
        current={1}
        total={2}
        eyebrow="Hardware Wallet"
        title="Connect your Trezor"
        subtitle="Your Stellar address is read directly from the device at m/44'/148'/0' — no recovery phrase, no local keys."
        onBack={backToChoose}
        backDisabled={busy}
      >
        {!hwInfo ? (
          <>
            <Notice>
              Plug in and unlock your Trezor. This only reads the public address — nothing is
              signed, and keys never leave the device.
            </Notice>
            {error && <ErrorText message={error} />}
            <Button
              className="w-full"
              loading={busy}
              disabled={busy}
              onClick={() => void handleTrezorConnect()}
            >
              Connect with Trezor Connect
            </Button>
          </>
        ) : (
          <>
            <div className="rounded-2xl border border-[#30D158]/25 bg-[#30D158]/[0.07] p-4">
              <p className="flex items-center gap-2 text-[12px] font-semibold text-[#30D158]">
                <IconCheck size={13} /> Address read from device
              </p>
              <HashValue
                full
                value={hwInfo.publicKey}
                className="mt-2.5 justify-center text-center text-[12.5px] leading-loose text-white"
              />
              <p className="mono mt-2 text-center text-[11px] text-neutral-500">{hwInfo.path}</p>
            </div>
            <p className="text-center text-[11.5px] text-neutral-500">
              Does it match the address shown on your Trezor screen?
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Button variant="ghost" onClick={() => setHwInfo(null)}>
                Re-check
              </Button>
              <Button
                onClick={() => {
                  triggerHaptic("selection");
                  setStep("password");
                }}
              >
                Yes, Continue
              </Button>
            </div>
          </>
        )}
      </StepShell>
    );
  }

  /* ------------------------------------------------------------------ */
  /* PASSWORD (create / import / restore / hardware)                     */
  /* ------------------------------------------------------------------ */
  if (step === "password") {
    const restoreViaBackup = pendingBackupJson !== null;
    return (
      <StepShell
        current={mode === "hardware" ? 2 : 1}
        total={mode === "create" ? 3 : mode === "hardware" ? 2 : 1}
        eyebrow={
          mode === "create"
            ? "Create Wallet"
            : mode === "restore"
              ? "Restore Wallet"
              : mode === "hardware"
                ? "Hardware Wallet"
                : "Import Wallet"
        }
        title={
          mode === "create"
            ? "Secure your vault"
            : mode === "restore"
              ? restoreViaBackup
                ? "Unlock your backup"
                : "Recover your wallet"
              : mode === "hardware"
                ? "Secure your vault"
                : "Import your wallet"
        }
        subtitle={
          mode === "create"
            ? "This password encrypts your master seed on this device. It cannot be recovered — make it strong."
            : mode === "restore"
              ? restoreViaBackup
                ? "Enter the wallet password that was used when this encrypted backup was created."
                : "Enter the password of your previously reset wallet to bring it back."
              : mode === "hardware"
                ? "This password locks the app on this device and encrypts anything you add later. Your keys never leave the Trezor."
                : "Paste your secret key or recovery phrase, then choose a password to seal this vault."
        }
        onBack={backToChoose}
        backDisabled={busy}
      >
        {mode === "import" && (
          <Field label="Secret Key or Recovery Phrase" hint="Starts with 'S' or 12/24 words">
            <textarea
              className="input mono min-h-[85px] resize-none text-base sm:text-[13px]"
              placeholder="S... or apple banana cherry..."
              value={secretInput}
              onChange={(e) => setSecretInput(e.target.value)}
              spellCheck={false}
              autoComplete="off"
            />
          </Field>
        )}
        <Field
          label="Vault Password"
          hint={mode === "restore" ? undefined : "Minimum 8 characters"}
        >
          <input
            className="input text-base sm:text-[14px]"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter password"
            autoComplete={mode === "restore" ? "current-password" : "new-password"}
            autoFocus={mode !== "import"}
            onKeyDown={(e) => {
              if (e.key === "Enter" && mode === "restore") void handlePasswordSubmit();
            }}
          />
        </Field>
        {mode !== "restore" && (
          <PasswordStrengthMeter strength={passwordStrength} />
        )}
        {mode !== "restore" && (
          <Field label="Confirm Password">
            <input
              className="input text-base sm:text-[14px]"
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
        {error && <ErrorText message={error} />}
        <Button
          className="w-full"
          loading={busy}
          disabled={busy}
          onClick={() => void handlePasswordSubmit()}
        >
          {mode === "create"
            ? "Continue"
            : mode === "restore"
              ? restoreViaBackup
                ? "Decrypt & Restore"
                : "Restore Wallet"
              : mode === "hardware"
                ? "Create Vault"
                : "Unlock & Import"}
        </Button>
      </StepShell>
    );
  }

  /* ------------------------------------------------------------------ */
  /* REVEAL — recovery phrase                                            */
  /* ------------------------------------------------------------------ */
  if (step === "reveal") {
    return (
      <StepShell
        current={2}
        total={3}
        eyebrow="Create Wallet"
        title="Back up your recovery phrase"
        subtitle="The only way to recover this wallet. Write the words down in order and keep them offline."
        onBack={async () => {
          await resetWallet();
          setStep("choose");
          setRevealed(null);
          setSaved(false);
          setPassword("");
          setConfirmPassword("");
        }}
        backLabel="Start Over"
      >
        <div className="flex items-start gap-2.5 rounded-2xl border border-[#FF9F0A]/25 bg-[#FF9F0A]/10 px-3.5 py-3">
          <IconAlert size={15} className="mt-0.5 shrink-0 text-[#FF9F0A]" />
          <p className="text-[11.5px] leading-relaxed text-[#FF9F0A]">
            Anyone with these words controls your funds. Never share them — not even with
            support.
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
              {revealedKind === "mnemonic" ? "Recovery Phrase" : "Secret Key"}
            </span>
            <CopyButton value={revealed ?? ""} label="Copy" />
          </div>
          {revealedKind === "mnemonic" ? (
            <div className="grid grid-cols-3 gap-2">
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
          className="flex items-start gap-2.5 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-3 text-left transition-colors hover:bg-white/[0.05]"
          onClick={() => {
            triggerHaptic("selection");
            setSaved((s) => !s);
          }}
        >
          <span
            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-all ${
              saved ? "border-[#0A84FF] bg-[#0A84FF] text-white" : "border-white/20 bg-white/[0.05]"
            }`}
          >
            {saved && <IconCheck size={12} />}
          </span>
          <span className="text-[12.5px] leading-relaxed text-neutral-300">
            I have written the {revealedKind === "mnemonic" ? "words" : "key"} down and stored
            them somewhere safe and offline.
          </span>
        </button>

        <div className="grid grid-cols-2 gap-3">
          <Button variant="ghost" disabled={!saved} onClick={() => {
            triggerHaptic("success");
            completeSetup();
          }}>
            Skip for Now
          </Button>
          <Button disabled={!saved} onClick={startVerify}>
            Verify Backup
          </Button>
        </div>
        <p className="text-center text-[11px] text-neutral-500">
          Verifying takes 20 seconds and proves your backup works.
        </p>
      </StepShell>
    );
  }

  /* ------------------------------------------------------------------ */
  /* VERIFY — word challenge (reachable + randomized)                    */
  /* ------------------------------------------------------------------ */
  const words = (revealed ?? "").split(" ");
  const targetWords = challengeIndices.map((idx) => words[idx] ?? "");
  const isCorrect =
    selectedWords.length === targetWords.length &&
    selectedWords.every((w, i) => w === targetWords[i]);

  return (
    <StepShell
      current={3}
      total={3}
      eyebrow="Create Wallet"
      title="Verify your backup"
      subtitle="Tap the requested words in order to confirm your written copy."
      onBack={() => {
        setStep("reveal");
      }}
    >
      <div className="grid grid-cols-3 gap-2">
        {challengeIndices.map((idx, i) => {
          const filled = selectedWords[i];
          const wrong = verifyFailed && selectedWords.length === targetWords.length;
          return (
            <div
              key={idx}
              className={`flex min-h-[64px] flex-col items-center justify-center rounded-xl border p-2.5 text-center transition-colors ${
                wrong
                  ? "border-[#FF453A]/40 bg-[#FF453A]/[0.07]"
                  : filled
                    ? "border-[#0A84FF]/40 bg-[#0A84FF]/[0.08]"
                    : "border-white/10 bg-white/[0.03]"
              }`}
            >
              <span className="text-[10px] font-bold uppercase text-neutral-500">
                Word #{idx + 1}
              </span>
              <span className="mono mt-0.5 text-[14px] font-bold text-white">
                {filled ?? "—"}
              </span>
            </div>
          );
        })}
      </div>

      <div>
        <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
          Word Bank
        </p>
        <div className="flex flex-wrap gap-2">
          {wordBank.map((w) => {
            const isPicked = selectedWords.includes(w);
            return (
              <button
                key={w}
                type="button"
                disabled={isPicked || selectedWords.length >= targetWords.length}
                onClick={() => {
                  triggerHaptic("selection");
                  setVerifyFailed(false);
                  setSelectedWords((prev) => [...prev, w]);
                }}
                className={`chip !py-1.5 !px-3.5 text-[13px] font-medium transition-all ${
                  isPicked
                    ? "cursor-not-allowed bg-white/5 opacity-30"
                    : "hover:bg-white/[0.12] active:scale-95"
                }`}
              >
                {w}
              </button>
            );
          })}
        </div>
      </div>

      {verifyFailed && (
        <p className="flex items-center justify-between text-[12px] text-[#FF453A]">
          Not quite — check your written copy.
          <button
            type="button"
            className="font-semibold hover:underline"
            onClick={() => {
              triggerHaptic("selection");
              setVerifyFailed(false);
              setSelectedWords([]);
            }}
          >
            Try Again
          </button>
        </p>
      )}

      <Button
        className="w-full"
        disabled={selectedWords.length < targetWords.length}
        onClick={() => {
          if (isCorrect) {
            triggerHaptic("success");
            completeSetup();
          } else {
            triggerHaptic("error");
            setVerifyFailed(true);
          }
        }}
      >
        {isCorrect ? "✓ Phrase Verified — Enter Wallet" : "Confirm Words"}
      </Button>
    </StepShell>
  );
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

function OnboardPath({
  icon,
  tint,
  title,
  sub,
  onClick,
  primary = false,
}: {
  icon: React.ReactNode;
  tint: string;
  title: string;
  sub: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex w-full items-center gap-3.5 rounded-2xl border px-4 py-3.5 text-left transition-all active:scale-[0.99] ${
        primary
          ? "border-[#0A84FF]/40 bg-[#0A84FF]/[0.10] hover:bg-[#0A84FF]/[0.16]"
          : "border-white/[0.08] bg-white/[0.03] hover:border-white/[0.16] hover:bg-white/[0.06]"
      }`}
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
        style={{ background: `${tint}1f`, color: tint }}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-semibold text-white">{title}</span>
        <span className="mt-0.5 block text-[12px] leading-snug text-neutral-400 line-clamp-2">{sub}</span>
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
        className={`shrink-0 transition-colors ${primary ? "text-[#0A84FF]" : "text-neutral-600 group-hover:text-neutral-400"}`}
      >
        <path d="m1.5 1.5 5 5.5-5 5.5" />
      </svg>
    </button>
  );
}

function PasswordStrengthMeter({ strength }: { strength: PasswordStrength }) {
  return (
    <div
      role="meter"
      aria-label="Password strength"
      aria-valuemin={0}
      aria-valuemax={4}
      aria-valuenow={strength.score}
      aria-valuetext={strength.label}
      className="space-y-2"
    >
      <div className="flex items-center justify-between gap-3 text-[12px]">
        <span className="font-medium text-neutral-400">Password strength</span>
        <span className="font-semibold" style={{ color: strength.color }}>
          {strength.label}
        </span>
      </div>
      <div className="grid grid-cols-4 gap-1.5" aria-hidden>
        {Array.from({ length: 4 }, (_, index) => (
          <span
            key={index}
            className="h-1.5 rounded-full transition-colors"
            style={{
              backgroundColor:
                index < strength.score ? strength.color : "rgba(255,255,255,0.1)",
            }}
          />
        ))}
      </div>
      <p className="text-[11.5px] leading-relaxed text-neutral-400">{strength.feedback}</p>
    </div>
  );
}

function StepShell({
  eyebrow,
  current,
  total,
  title,
  subtitle,
  children,
  onBack,
  backLabel = "Back",
  backDisabled = false,
}: {
  eyebrow: string;
  current: number;
  total: number;
  title: string;
  subtitle: string;
  children: React.ReactNode;
  onBack?: () => void;
  backLabel?: string;
  backDisabled?: boolean;
}) {
  return (
    <div className="relative z-10 min-h-screen w-full overflow-hidden">
      <Ambient />
      <div className="app-safe-top app-safe-top-pad-14 fade-up relative mx-auto flex min-h-screen w-full max-w-[520px] flex-col justify-center px-6 py-14">
        <div className="mb-6 flex items-center justify-between">
          {onBack ? (
            <IOSBackButton
              onClick={onBack}
              label={backLabel}
              disabled={backDisabled}
              className="-ml-1"
            />
          ) : (
            <LogoMark size={38} />
          )}
          <p className="eyebrow">{eyebrow}</p>
        </div>

        {/* Progress dots */}
        <div className="mb-6 flex items-center gap-1.5">
          {Array.from({ length: total }, (_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i + 1 < current
                  ? "w-5 bg-[#30D158]"
                  : i + 1 === current
                    ? "w-5 bg-[#0A84FF]"
                    : "w-1.5 bg-white/15"
              }`}
            />
          ))}
        </div>

        <h1 className="display-h text-[30px] font-bold tracking-tight text-white">{title}</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-neutral-400">{subtitle}</p>

        <div className="mt-7 space-y-4 rounded-[28px] border border-white/[0.12] bg-[#121214]/95 p-6 shadow-[0_25px_70px_-15px_rgba(0,0,0,0.9)] backdrop-blur-2xl">
          {children}
        </div>
      </div>
    </div>
  );
}
