"use client";

import { useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import { hasMnemonic, isValidPublicAddress, validateStellarSecret } from "@/lib/vault";
import { triggerHaptic } from "@/lib/haptics";
import {
  connectTrezorDevice,
  getStellarDerivationPath,
  type HardwareDeviceType,
} from "@/lib/hardware";
import { IconTrezor } from "./icons";
import { Button, ErrorText, Field, Modal, ModalHeader, SegmentedControl } from "./ui";

type Mode = "generate" | "import" | "hardware" | "watch";

export function AddAccountModal({
  open,
  onClose,
  initialMode = "generate",
  initialDevice = "trezor",
}: {
  open: boolean;
  onClose: () => void;
  initialMode?: Mode;
  initialDevice?: HardwareDeviceType;
}) {
  if (!open) return null;
  return <AddAccountInner onClose={onClose} initialMode={initialMode} initialDevice={initialDevice} />;
}

function AddAccountInner({
  onClose,
  initialMode = "generate",
  initialDevice = "trezor",
}: {
  onClose: () => void;
  initialMode?: Mode;
  initialDevice?: HardwareDeviceType;
}) {
  const { accounts, addAccount, addWatchOnly, addHardwareAccount } = useWallet();
  // Deriving needs the vault mnemonic — hardware/secret vaults don't have one
  const [hasMnemonicVault] = useState(() => hasMnemonic());
  const [mode, setMode] = useState<Mode>(
    !hasMnemonicVault && initialMode === "generate" ? "import" : initialMode,
  );
  const [hardwareDevice] = useState<HardwareDeviceType>(
    initialDevice === "trezor" ? "trezor" : "trezor",
  );
  const [hardwareIndex, setHardwareIndex] = useState(0);
  void setHardwareIndex;
  const [hardwareKey, setHardwareKey] = useState("");
  const [label, setLabel] = useState("");
  const [secretInput, setSecretInput] = useState("");
  const [watchKey, setWatchKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const watchValid = isValidPublicAddress(watchKey.trim());
  const importValid = validateStellarSecret(secretInput);

  async function handleConnectHardware() {
    setError(null);
    setBusy(true);
    try {
      const info = await connectTrezorDevice(hardwareIndex);
      setHardwareKey(info.publicKey);
      if (!label) {
        setLabel(info.label);
      }
      triggerHaptic("success");
    } catch (e) {
      triggerHaptic("error");
      setError(e instanceof Error ? e.message : "Failed to connect hardware device.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate() {
    setError(null);
    setBusy(true);
    try {
      if (mode === "hardware") {
        if (!hardwareKey) {
          throw new Error("Please connect your hardware device first.");
        }
        await addHardwareAccount({
          publicKey: hardwareKey,
          device: hardwareDevice,
          path: getStellarDerivationPath(hardwareIndex),
          label: label || undefined,
          index: hardwareIndex,
        });
      } else if (mode === "watch") {
        await addWatchOnly(watchKey.trim(), label || undefined);
      } else {
        await addAccount({
          secret: mode === "import" ? secretInput : undefined,
          label: label || undefined,
        });
      }
      triggerHaptic("success");
      onClose();
      // Reset for next open
      setLabel("");
      setSecretInput("");
      setWatchKey("");
      setHardwareKey("");
      setMode(hasMnemonicVault ? "generate" : "import");
    } catch (e) {
      triggerHaptic("error");
      setError(e instanceof Error ? e.message : "Could not add account.");
    } finally {
      setBusy(false);
    }
  }

  const canSubmit =
    !busy &&
    (mode === "generate" ||
      (mode === "import" && importValid) ||
      (mode === "hardware" && Boolean(hardwareKey)) ||
      (mode === "watch" && watchValid));

  const subtitle =
    mode === "hardware"
      ? "Connect with Trezor Connect"
      : mode === "watch"
        ? "Track any address — balances only, no keys"
        : `Derives at m/44'/148'/${accounts.length}'`;

  return (
    <Modal open onClose={onClose} dismissable={!busy}>
      <ModalHeader title="Add Account" subtitle={subtitle} onClose={onClose} />
      <div className="p-4 sm:p-6">
        <SegmentedControl<Mode>
          value={mode}
          onChange={setMode}
          options={[
            ...(hasMnemonicVault ? [{ value: "generate" as Mode, label: "Derive" }] : []),
            { value: "import", label: "Import" },
            { value: "hardware", label: "Hardware" },
            { value: "watch", label: "Watch" },
          ]}
        />

        <div className="mt-4 space-y-4">
          <div>
            <label className="block text-[11.5px] font-semibold uppercase tracking-wider text-neutral-400 mb-2">
              Account Preset & Emoji
            </label>
            <div className="flex flex-wrap items-center gap-1.5">
              {[
                { emoji: "⚡", name: "Trading" },
                { emoji: "💼", name: "Treasury" },
                { emoji: "🏦", name: "Savings" },
                { emoji: "☕", name: "Daily" },
                { emoji: "🛡️", name: "Vault" },
                { emoji: "🚀", name: "Moon" },
              ].map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  onClick={() => {
                    triggerHaptic("selection");
                    setLabel(`${preset.emoji} ${preset.name}`);
                  }}
                  className="chip !py-1 !px-2.5 text-[12px] flex items-center gap-1 shrink-0 hover:bg-white/[0.12]"
                >
                  <span>{preset.emoji}</span>
                  <span>{preset.name}</span>
                </button>
              ))}
            </div>
          </div>

          <Field label="Account Label">
            <input
              className="input text-base sm:text-[13.5px]"
              placeholder={
                mode === "watch"
                  ? "e.g. 👁 Cold Storage"
                  : `Account ${accounts.length + 1}`
              }
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={24}
            />
          </Field>

          {mode === "import" && (
            <Field
              label="Secret Key"
              hint="Starts with 'S'"
              error={
                secretInput.trim() && !validateStellarSecret(secretInput)
                  ? "Invalid secret key format."
                  : undefined
              }
            >
              <input
                className="input mono text-base sm:text-[13.5px]"
                placeholder="S..."
                value={secretInput}
                onChange={(e) => setSecretInput(e.target.value)}
                spellCheck={false}
                autoComplete="off"
              />
            </Field>
          )}

          {mode === "hardware" && (
            <div className="space-y-3.5">
              <div className="rounded-2xl border border-[#0A84FF] bg-[#0A84FF]/10 p-3 text-left text-white shadow-sm">
                <p className="flex items-center gap-2 text-[14px] font-bold text-white">
                  <IconTrezor size={18} className="text-emerald-400" />
                  <span>Trezor</span>
                </p>
                <p className="mt-0.5 text-[11px] text-neutral-400">Model One / T / Safe</p>
              </div>

              {/* Derivation Path Index */}
              <div className="flex items-center justify-between px-1 text-[12px] text-neutral-300">
                <span>Derivation Path:</span>
                <span className="mono font-semibold text-[#0A84FF]">
                  {getStellarDerivationPath(hardwareIndex)}
                </span>
              </div>

              {hardwareKey ? (
                <div className="rounded-2xl border border-[#30D158]/30 bg-[#30D158]/10 p-3 text-[12px] space-y-1">
                  <p className="font-semibold text-[#30D158]">✓ Device Connected</p>
                  <p className="mono select-all break-all text-neutral-300 text-[11px]">
                    {hardwareKey}
                  </p>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full !py-2.5 text-[13.5px] font-semibold"
                  loading={busy}
                  onClick={() => void handleConnectHardware()}
                >
                  Connect with Trezor Connect
                </Button>
              )}
            </div>
          )}

          {mode === "watch" && (
            <div className="space-y-2">
              <Field
                label="Public Key to Track"
                hint="Starts with 'G'"
                error={
                  watchKey.trim() && !watchValid
                    ? "Invalid public key format."
                    : undefined
                }
              >
                <input
                  className="input mono text-base sm:text-[13.5px]"
                  placeholder="G..."
                  value={watchKey}
                  onChange={(e) => setWatchKey(e.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                />
              </Field>
              <p className="flex items-start gap-1.5 px-1 text-[11.5px] leading-relaxed text-neutral-400">
                <span className="text-[#64D2FF]">👁</span>
                Watch-only accounts show balances and activity but cannot sign transactions.
                No secret key is stored.
              </p>
            </div>
          )}
        </div>

        <div className="mt-3">
          <ErrorText message={error ?? ""} />
        </div>

        <Button
          className="mt-6 w-full !py-3.5 text-[15px] font-semibold"
          loading={busy}
          disabled={!canSubmit}
          onClick={() => void handleCreate()}
        >
          {mode === "generate"
            ? "Create Account"
            : mode === "import"
              ? "Import Account"
              : mode === "hardware"
                ? "Import Hardware Account"
                : "Track Address"}
        </Button>
      </div>
    </Modal>
  );
}
