"use client";

import { useState } from "react";
import { useWalletLifecycleActions } from "@/hooks/useWallet";
import { triggerHaptic } from "@/lib/haptics";
import { AlertContent, Button, ErrorText, Modal, ModalFooter } from "./ui";

export function ResetWalletModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { resetWallet } = useWalletLifecycleActions();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [prevOpen, setPrevOpen] = useState(open);

  // A fresh confirmation never shows the previous attempt's failure.
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setError(null);
  }

  async function handleErase() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await resetWallet();
      onClose();
    } catch (caught) {
      triggerHaptic("warning");
      setError(caught instanceof Error ? caught.message : "Wallet data could not be erased.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      presentation="alert"
      busy={busy}
      busyReason="Wait for the wallet to finish erasing."
    >
      <AlertContent
        title="Erase this wallet?"
        message="This permanently erases every encrypted private key and recovery phrase in this browser. It cannot be undone — without a backup of your recovery phrase, all funds will be lost."
        actions={
          <ModalFooter
            stack
            primary={
              <Button
                type="button"
                variant="danger"
                loading={busy}
                loadingLabel="Erasing wallet"
                onClick={() => void handleErase()}
              >
                Erase everything
              </Button>
            }
            secondary={
              <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
                Cancel
              </Button>
            }
          />
        }
      >
        {error && <ErrorText message={error} />}
      </AlertContent>
    </Modal>
  );
}
