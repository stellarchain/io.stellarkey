"use client";

import { useLayoutEffect, useState, type RefObject } from "react";
import { useWalletIdentity } from "@/hooks/useWallet";
import { useToast } from "./Toast";
import { MAX_ACCOUNT_LABEL_CHARS } from "@/lib/backup-schema";
import type { AccountMeta } from "@/lib/types";
import { triggerHaptic } from "@/lib/haptics";
import { Button, ErrorText, Field, ModalBody, ModalFooter } from "./ui";

const LABEL_PRESETS = [
  { emoji: "⚡", name: "Trading" },
  { emoji: "💼", name: "Treasury" },
  { emoji: "🏦", name: "Savings" },
  { emoji: "☕", name: "Daily" },
  { emoji: "🛡️", name: "Vault" },
  { emoji: "🚀", name: "Moon" },
];

export interface RenameAccountModalBodyProps {
  account: AccountMeta;
  /** The shell's initial-focus target; the label field attaches to it. */
  inputRef: RefObject<HTMLInputElement | null>;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
}

// Mounted by the RenameAccountModal shell per account and kept through its exit.
export function RenameAccountModalBody({
  account,
  inputRef,
  onClose,
  onDirtyChange,
}: RenameAccountModalBodyProps) {
  const { renameAccount } = useWalletIdentity();
  const { toast } = useToast();
  const [label, setLabel] = useState(account.label);
  const [error, setError] = useState<string | null>(null);
  const trimmed = label.trim();
  const dirty = trimmed !== account.label.trim();

  useLayoutEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);

  // This chunk may arrive after the shell's opening focus already settled on
  // the dialog itself; complete that intent without taking focus from a
  // control the user has since chosen.
  useLayoutEffect(() => {
    const input = inputRef.current;
    const panel = input?.closest<HTMLElement>("[data-modal-shell]");
    if (input && panel && document.activeElement === panel) input.focus({ preventScroll: true });
  }, [inputRef]);

  function handleSave() {
    if (!trimmed) return;
    setError(null);
    try {
      renameAccount(account.id, trimmed);
      triggerHaptic("success");
      toast("Account renamed", "success", { silent: true });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Account label could not be saved.");
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        handleSave();
      }}
    >
      <ModalBody>
        <div>
          <span className="block text-[11.5px] font-semibold uppercase tracking-wider text-neutral-400 mb-2">
            Preset &amp; Emoji
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {LABEL_PRESETS.map((preset) => (
              <button
                key={preset.name}
                type="button"
                onClick={() => setLabel(`${preset.emoji} ${preset.name}`)}
                className="chip text-[12px] flex items-center gap-1 shrink-0 hover:bg-white/[0.12]"
              >
                <span aria-hidden="true">{preset.emoji}</span>
                <span>{preset.name}</span>
              </button>
            ))}
          </div>
        </div>

        <Field label="Account Label">
          <input
            ref={inputRef}
            className="input text-base sm:text-[14px]"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. 💼 Treasury, ⚡ Trading"
            maxLength={MAX_ACCOUNT_LABEL_CHARS}
            enterKeyHint="done"
            autoCorrect="off"
          />
        </Field>

        {error && <ErrorText message={error} />}

        <ModalFooter
          secondary={
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          }
          primary={
            <Button type="submit" disabled={!trimmed}>
              Save label
            </Button>
          }
        />
      </ModalBody>
    </form>
  );
}
