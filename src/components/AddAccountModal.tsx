"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import { hasMnemonic, isValidPublicAddress, validateStellarSecret } from "@/lib/vault";
import { triggerHaptic } from "@/lib/haptics";
import {
  connectTrezorDevice,
  getStellarDerivationPath,
  warmTrezorConnect,
  type HardwareAccountInfo,
} from "@/lib/hardware";
import { IconTrezor } from "./icons";
import { Button, ErrorText, Field, HashValue, Modal, ModalHeader, SegmentedControl } from "./ui";

type Mode = "generate" | "import" | "hardware" | "watch";

export function AddAccountModal({
  open,
  onClose,
  initialMode = "generate",
}: {
  open: boolean;
  onClose: () => void;
  initialMode?: Mode;
}) {
  if (!open) return null;
  return <AddAccountInner onClose={onClose} initialMode={initialMode} />;
}

function AddAccountInner({
  onClose,
  initialMode = "generate",
}: {
  onClose: () => void;
  initialMode?: Mode;
}) {
  const { accounts, addAccount, addWatchOnly, addHardwareAccount } = useWallet();
  // Deriving needs the vault mnemonic — hardware/secret vaults don't have one
  const [hasMnemonicVault] = useState(() => hasMnemonic());
  const [mode, setMode] = useState<Mode>(
    !hasMnemonicVault && initialMode === "generate" ? "import" : initialMode,
  );
  const [hardwareIndex, setHardwareIndex] = useState(0);
  const [connectedInfo, setConnectedInfo] = useState<HardwareAccountInfo | null>(null);
  const [label, setLabel] = useState("");
  const [secretInput, setSecretInput] = useState("");
  const [watchKey, setWatchKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const watchValid = isValidPublicAddress(watchKey.trim());
  const importValid = validateStellarSecret(secretInput);

  useEffect(() => {
    if (mode === "hardware") {
      warmTrezorConnect();
    }
  }, [mode]);

  async function handleConnectHardware() {
    setError(null);
    setBusy(true);
    try {
      const info = await connectTrezorDevice(hardwareIndex);
      setConnectedInfo(info);
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
        if (!connectedInfo) {
          throw new Error("Please connect your hardware device first.");
        }
        await addHardwareAccount({
          publicKey: connectedInfo.publicKey,
          device: connectedInfo.device,
          path: connectedInfo.path,
          label: label || undefined,
          index: connectedInfo.index,
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
      setConnectedInfo(null);
      setHardwareIndex(0);
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
      (mode === "hardware" && Boolean(connectedInfo)) ||
      (mode === "watch" && watchValid));

  const subtitle =
    mode === "hardware"
      ? "Connect a device and verify its Stellar address"
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
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3.5 text-left">
                <p className="text-[13px] font-semibold text-white">Hardware wallet</p>
                <p className="mt-1 text-[12px] leading-relaxed text-neutral-400">
                  Keys stay on your device. Confirm the Stellar address on its screen before
                  adding it to this wallet.
                </p>
                <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-3 text-[11.5px]">
                  <span className="text-neutral-400">Supported signer</span>
                  <span className="flex items-center gap-1.5 font-semibold text-neutral-200">
                    <IconTrezor size={14} className="text-emerald-400" />
                    Trezor Connect
                  </span>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 space-y-3">
                <div className="flex items-center justify-between gap-3 text-[12px]">
                  <span className="font-semibold text-neutral-300">Account index</span>
                  <span className="mono truncate text-[11px] font-semibold text-[#64D2FF]">
                    {getStellarDerivationPath(hardwareIndex)}
                  </span>
                </div>
                <div
                  className="grid grid-cols-5 gap-1.5"
                  role="group"
                  aria-label="Hardware account index"
                >
                  {[0, 1, 2, 3, 4].map((index) => (
                    <button
                      key={index}
                      type="button"
                      disabled={busy}
                      aria-label={`Account index ${index}`}
                      aria-pressed={hardwareIndex === index}
                      onClick={() => {
                        triggerHaptic("selection");
                        setHardwareIndex(index);
                        if (label === connectedInfo?.label) {
                          setLabel("");
                        }
                        setConnectedInfo(null);
                        setError(null);
                      }}
                      className={`min-h-11 rounded-xl text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                        hardwareIndex === index
                          ? "bg-[#0A84FF] text-white"
                          : "bg-white/[0.06] text-neutral-300 hover:bg-white/[0.1] hover:text-white"
                      }`}
                    >
                      {index}
                    </button>
                  ))}
                </div>
              </div>

              {connectedInfo ? (
                <div className="rounded-2xl border border-[#30D158]/30 bg-[#30D158]/10 p-3.5 text-[12px] space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-[#30D158]">Address received</p>
                    <span className="mono text-[10.5px] text-neutral-400">{connectedInfo.path}</span>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/30 p-2.5">
                    <HashValue
                      full
                      value={connectedInfo.publicKey}
                      className="w-full justify-center text-center text-[11px] leading-loose text-neutral-200"
                    />
                  </div>
                  <p className="text-[11.5px] leading-relaxed text-neutral-300">
                    Confirm this address on your device before adding the account.
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
                  Connect Trezor
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
                ? "Add Hardware Account"
                : "Track Address"}
        </Button>
      </div>
    </Modal>
  );
}
