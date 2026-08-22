"use client";

import { useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import { isValidPublicAddress, validateStellarSecret } from "@/lib/vault";
import { triggerHaptic } from "@/lib/haptics";
import { Button, ErrorText, Field, Modal, ModalHeader, SegmentedControl } from "./ui";

type Mode = "generate" | "import" | "watch";

export function AddAccountModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;
  return <AddAccountInner onClose={onClose} />;
}

function AddAccountInner({ onClose }: { onClose: () => void }) {
  const { accounts, addAccount, addWatchOnly } = useWallet();
  const [mode, setMode] = useState<Mode>("generate");
  const [label, setLabel] = useState("");
  const [secretInput, setSecretInput] = useState("");
  const [watchKey, setWatchKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const watchValid = isValidPublicAddress(watchKey.trim());
  const importValid = validateStellarSecret(secretInput);

  async function handleCreate() {
    setError(null);
    setBusy(true);
    try {
      if (mode === "watch") {
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
      setMode("generate");
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
      (mode === "watch" && watchValid));

  const subtitle =
    mode === "watch"
      ? "Track any address — balances only, no keys"
      : `Derives at m/44'/148'/${accounts.length}'`;

  return (
    <Modal open onClose={onClose} dismissable={!busy}>
      <ModalHeader title="Add Account" subtitle={subtitle} onClose={onClose} />
      <div className="px-6 pb-6 pt-5">
        <SegmentedControl<Mode>
          value={mode}
          onChange={setMode}
          options={[
            { value: "generate", label: "Derive" },
            { value: "import", label: "Import" },
            { value: "watch", label: "Watch Only" },
          ]}
        />

        <div className="mt-4 space-y-4">
          <Field label="Account Label">
            <input
              className="input text-[13.5px]"
              placeholder={
                mode === "watch"
                  ? "e.g. Exchange Cold Wallet"
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
                className="input mono text-[13.5px]"
                placeholder="S..."
                value={secretInput}
                onChange={(e) => setSecretInput(e.target.value)}
                spellCheck={false}
                autoComplete="off"
              />
            </Field>
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
                  className="input mono text-[13.5px]"
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
          className="mt-5 w-full !py-3.5 text-[15px] font-semibold"
          loading={busy}
          disabled={!canSubmit}
          onClick={() => void handleCreate()}
        >
          {mode === "generate"
            ? "Create Account"
            : mode === "import"
              ? "Import Account"
              : "Track Address"}
        </Button>
      </div>
    </Modal>
  );
}
