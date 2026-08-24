"use client";

import { useWallet } from "@/hooks/useWallet";
import { triggerHaptic } from "@/lib/haptics";
import { Button, Modal, ModalHeader } from "./ui";

export function ResetWalletModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { resetWallet } = useWallet();
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
        <div className="mt-6 grid grid-cols-2 gap-3">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              triggerHaptic("error");
              onClose();
              resetWallet();
            }}
          >
            Erase Everything
          </Button>
        </div>
      </div>
    </Modal>
  );
}
