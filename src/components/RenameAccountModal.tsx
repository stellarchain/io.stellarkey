"use client";

import { useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import { useToast } from "./Toast";
import { shortenAddr } from "@/lib/format";
import type { AccountMeta } from "@/lib/types";
import { triggerHaptic } from "@/lib/haptics";
import { Button, Field, Modal, ModalHeader } from "./ui";

export function RenameAccountModal({
  account,
  onClose,
}: {
  account: AccountMeta | null;
  onClose: () => void;
}) {
  if (!account) return null;
  return <RenameAccountInner key={account.id} account={account} onClose={onClose} />;
}

function RenameAccountInner({
  account,
  onClose,
}: {
  account: AccountMeta;
  onClose: () => void;
}) {
  const { renameAccount } = useWallet();
  const { toast } = useToast();
  const [label, setLabel] = useState(account.label);

  function handleSave() {
    if (label.trim()) {
      renameAccount(account.id, label.trim());
      triggerHaptic("success");
      toast("Account renamed", "success");
      onClose();
    }
  }

  return (
    <Modal open onClose={onClose}>
      <ModalHeader
        title="Rename Account"
        subtitle={`Custom label for ${shortenAddr(account.publicKey, 6, 6)}`}
        onClose={onClose}
      />
      <div className="p-6 space-y-4">
        {/* Preset & Emoji Chips */}
        <div>
          <label className="block text-[11.5px] font-semibold uppercase tracking-wider text-neutral-400 mb-2">
            Preset &amp; Emoji
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
            className="input text-[14px]"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. 💼 Treasury, ⚡ Trading"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
            }}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3 pt-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!label.trim()} onClick={handleSave}>
            Save Label
          </Button>
        </div>
      </div>
    </Modal>
  );
}
