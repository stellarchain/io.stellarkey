"use client";

import { useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import { validateStellarSecret } from "@/lib/vault";
import { triggerHaptic } from "@/lib/haptics";
import { Button, ErrorText, Field, Modal, ModalHeader, SegmentedControl } from "./ui";

export function AddAccountModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;
  return <AddAccountInner open onClose={onClose} />;
}

function AddAccountInner({ onClose }: { open: boolean; onClose: () => void }) {
  const { accounts, addAccount } = useWallet();
  const [mode, setMode] = useState<"generate" | "import">("generate");
  const [label, setLabel] = useState("");
  const [secretInput, setSecretInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setError(null);
    setBusy(true);
    try {
      await addAccount({
        secret: mode === "import" ? secretInput : undefined,
        label: label || undefined,
      });
      triggerHaptic("success");
      onClose();
      // Reset for next open
      setLabel("");
      setSecretInput("");
      setMode("generate");
    } catch (e) {
      triggerHaptic("error");
      setError(e instanceof Error ? e.message : "Could not add account.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} dismissable={!busy}>
      <ModalHeader
        title="Add Account"
        subtitle={`Derives at m/44'/148'/${accounts.length}'`}
        onClose={onClose}
      />
      <div className="px-6 pb-6 pt-5">
        <SegmentedControl
          value={mode}
          onChange={setMode}
          options={[
            { value: "generate", label: "Derive from Phrase" },
            { value: "import", label: "Import Secret Key" },
          ]}
        />

        <div className="mt-4 space-y-4">
          <Field label="Account Label">
            <input
              className="input text-[13.5px]"
              placeholder={`Account ${accounts.length + 1}`}
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
        </div>

        <div className="mt-3">
          <ErrorText message={error ?? ""} />
        </div>

        <Button
          className="mt-5 w-full !py-3.5 text-[15px] font-semibold"
          loading={busy}
          disabled={busy || (mode === "import" && !validateStellarSecret(secretInput))}
          onClick={() => void handleCreate()}
        >
          {mode === "generate" ? "Create Account" : "Import Account"}
        </Button>
      </div>
    </Modal>
  );
}
