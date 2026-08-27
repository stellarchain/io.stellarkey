"use client";

import { useState } from "react";
import { useWalletLifecycleActions } from "@/hooks/useWallet";
import { triggerHaptic } from "@/lib/haptics";
import { Button, Modal, ModalHeader } from "./ui";

export function ResetWalletModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { resetWallet } = useWalletLifecycleActions();
  const [error, setError] = useState<string | null>(null);
  if (!open) return null;

  return (
    <Modal open onClose={onClose}>
      <ModalHeader
        title="Erase & Reset Wallet?"
        subtitle="Destructive action — irreversible"
        onClose={onClose}
      />
      <div className="p-4 sm:p-6">
        <p className="text-[13.5px] leading-relaxed text-neutral-300">
          This permanently erases all encrypted private keys and recovery phrases in this browser.{" "}
          <span className="text-[#FF453A] font-semibold">
            Without a backup of your recovery phrase, all funds will be permanently lost.
          </span>
        </p>
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              triggerHaptic("error");
              setError(null);
              try {
                await resetWallet();
                onClose();
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : "Wallet data could not be erased.");
              }
            }}
          >
            Erase Everything
          </Button>
        </div>
        {error && <p className="mt-3 text-[12.5px] text-[#FF453A]">{error}</p>}
      </div>
    </Modal>
  );
}
