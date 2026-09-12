"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useWalletIdentity } from "@/hooks/useWallet";
import { hasMnemonic, isValidPublicAddress, validateStellarSecret } from "@/lib/vault";
import { triggerHaptic } from "@/lib/haptics";
import {
  connectTrezorDevice,
  getStellarDerivationPath,
  warmTrezorConnect,
  type HardwareAccountInfo,
} from "@/lib/hardware";
import { IconEye, IconEyeOff, IconTrezor } from "./icons";
import {
  Button,
  ErrorText,
  Field,
  HashValue,
  ModalBody,
  ModalFooter,
  Notice,
  SegmentedControl,
} from "./ui";

export type AddAccountMode = "generate" | "import" | "hardware" | "watch";
type Mode = AddAccountMode;

/** Header text the body reports to its shell for the selected mode. */
export type AddAccountHeader = { title: string; subtitle?: string };

export interface AddAccountModalBodyProps {
  initialMode?: AddAccountMode;
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
  onDirtyChange: (dirty: boolean) => void;
  onHeaderChange: (header: AddAccountHeader | null) => void;
  /** The shell routes every dismissal through the body's busy-guarded close. */
  onCloseHandlerChange: (handler: (() => void) | null) => void;
}

const LABEL_PRESETS = [
  { emoji: "⚡", name: "Trading" },
  { emoji: "💼", name: "Treasury" },
  { emoji: "🏦", name: "Savings" },
  { emoji: "☕", name: "Daily" },
  { emoji: "🛡️", name: "Vault" },
  { emoji: "🚀", name: "Moon" },
];

// Mounted only for the active opening; it owns sensitive form state and
// reports busy, dirty and header state upward.
export function AddAccountModalBody({
  initialMode = "generate",
  onClose,
  onBusyChange,
  onDirtyChange,
  onHeaderChange,
  onCloseHandlerChange,
}: AddAccountModalBodyProps) {
  const { accounts, addAccount, addWatchOnly, addHardwareAccount } = useWalletIdentity();
  // Deriving needs the vault mnemonic — hardware/secret vaults don't have one
  const [hasMnemonicVault] = useState(() => hasMnemonic());
  const [mode, setMode] = useState<Mode>(
    !hasMnemonicVault && initialMode === "generate" ? "import" : initialMode,
  );
  const [hardwareIndex, setHardwareIndex] = useState(0);
  const [connectedInfo, setConnectedInfo] = useState<HardwareAccountInfo | null>(null);
  const [label, setLabel] = useState("");
  const [secretInput, setSecretInput] = useState("");
  const [secretVisible, setSecretVisible] = useState(false);
  const [watchKey, setWatchKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ownerRef = useRef(false);
  const busyRef = useRef(false);

  useLayoutEffect(() => {
    ownerRef.current = true;
    return () => { ownerRef.current = false; };
  }, []);

  const watchValid = isValidPublicAddress(watchKey.trim());
  const importValid = validateStellarSecret(secretInput);
  const dirty = secretInput.trim() !== "" || watchKey.trim() !== "";

  useEffect(() => {
    if (mode === "hardware") {
      warmTrezorConnect();
    }
  }, [mode]);

  async function handleConnectHardware() {
    if (!ownerRef.current || busyRef.current) return;
    busyRef.current = true;
    setError(null);
    setBusy(true);
    try {
      const info = await connectTrezorDevice(hardwareIndex);
      if (!ownerRef.current) return;
      setConnectedInfo(info);
      if (!label) {
        setLabel(info.label);
      }
      triggerHaptic("success");
    } catch {
      if (!ownerRef.current) return;
      triggerHaptic("error");
      setError("Could not connect to your hardware device. Check the device and try again.");
    } finally {
      if (ownerRef.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }

  async function handleCreate() {
    if (!ownerRef.current || busyRef.current || !canSubmit) return;
    busyRef.current = true;
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
      if (!ownerRef.current) return;
      triggerHaptic("success");
      onClose();
      // Reset for next open
      setLabel("");
      setSecretInput("");
      setWatchKey("");
      setConnectedInfo(null);
      setHardwareIndex(0);
      setMode(hasMnemonicVault ? "generate" : "import");
    } catch {
      if (!ownerRef.current) return;
      triggerHaptic("error");
      setError("Could not add this account. Check the details and try again.");
    } finally {
      if (ownerRef.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }

  function handleClose() {
    if (!ownerRef.current || busyRef.current) return;
    onClose();
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
        : mode === "import"
          ? "Import an existing Stellar secret key"
          : "Create another account from this wallet's recovery phrase";

  useLayoutEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);

  useLayoutEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);

  useLayoutEffect(() => {
    onHeaderChange({ title: "Add Account", subtitle });
    return () => onHeaderChange(null);
  }, [onHeaderChange, subtitle]);

  // handleClose is declared afresh each render so it sees current props; the
  // shell only ever needs the latest one.
  useLayoutEffect(() => {
    onCloseHandlerChange(handleClose);
    return () => onCloseHandlerChange(null);
  });

  return (
    <ModalBody>
      <SegmentedControl<Mode>
        ariaLabel="How to add this account"
        value={mode}
        onChange={(next) => {
          if (busyRef.current) return;
          setMode(next);
          setError(null);
        }}
        options={[
          ...(hasMnemonicVault ? [{ value: "generate" as Mode, label: "Derive", disabled: busy }] : []),
          { value: "import", label: "Import", disabled: busy },
          { value: "hardware", label: "Hardware", disabled: busy },
          { value: "watch", label: "Watch", disabled: busy },
        ]}
      />

      <div>
        <span className="block text-[11.5px] font-semibold uppercase tracking-wider text-neutral-400 mb-2">
          Account Preset & Emoji
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          {LABEL_PRESETS.map((preset) => (
            <button
              key={preset.name}
              type="button"
              disabled={busy}
              onClick={() => setLabel(`${preset.emoji} ${preset.name}`)}
              className="chip text-[12px] flex items-center gap-1 shrink-0 hover:bg-white/[0.12] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span aria-hidden="true">{preset.emoji}</span>
              <span>{preset.name}</span>
            </button>
          ))}
        </div>
      </div>

      <Field label="Account Label">
        <input
          className="input text-base sm:text-[14px]"
          placeholder={
            mode === "watch"
              ? "e.g. 👁 Cold Storage"
              : `Account ${accounts.length + 1}`
          }
          value={label}
          disabled={busy}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={24}
          enterKeyHint={mode === "import" || mode === "watch" ? "next" : "done"}
          autoCorrect="off"
        />
      </Field>

      {mode === "import" && (
        <div className="space-y-2">
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
              className="input mono text-base sm:text-[13px]"
              type={secretVisible ? "text" : "password"}
              placeholder="S..."
              value={secretInput}
              disabled={busy}
              onChange={(e) => setSecretInput(e.target.value)}
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              enterKeyHint="done"
            />
          </Field>
          <div className="flex justify-end">
            <button
              type="button"
              aria-pressed={secretVisible}
              disabled={busy}
              onClick={() => setSecretVisible((visible) => !visible)}
              className="flex items-center gap-1.5 rounded-xl px-2 text-[12px] font-medium text-neutral-400 transition-colors hover:text-white disabled:opacity-50"
            >
              {secretVisible ? <IconEyeOff size={14} /> : <IconEye size={14} />}
              {secretVisible ? "Hide secret key" : "Show secret key"}
            </button>
          </div>
        </div>
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
                      ? "bg-[#0A84FF] text-[var(--color-oncolor)]"
                      : "bg-white/[0.06] text-neutral-300 hover:bg-white/[0.1] hover:text-white"
                  }`}
                >
                  {index}
                </button>
              ))}
            </div>
          </div>

          {connectedInfo ? (
            <Notice tone="pos" compact className="space-y-2">
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
            </Notice>
          ) : (
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              loading={busy}
              loadingLabel="Connecting to Trezor"
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
              className="input mono text-base sm:text-[13px]"
              placeholder="G..."
              value={watchKey}
              disabled={busy}
              onChange={(e) => setWatchKey(e.target.value)}
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              enterKeyHint="done"
            />
          </Field>
          <p className="flex items-start gap-1.5 px-1 text-[11.5px] leading-relaxed text-neutral-400">
            <IconEye size={13} className="mt-0.5 shrink-0 text-[#64D2FF]" aria-hidden="true" />
            Watch-only accounts show balances and activity but cannot sign transactions.
            No secret key is stored.
          </p>
        </div>
      )}

      {error && <ErrorText message={error} />}

      <ModalFooter
        primary={
          <Button
            type="button"
            loading={busy}
            loadingLabel="Adding account"
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
        }
      />
    </ModalBody>
  );
}
