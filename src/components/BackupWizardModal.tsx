"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { LoadingRegion, Modal, ModalHeader, useRetainedForExit } from "./ui";
import type { BackupWizardHeader } from "./BackupWizardModalBody";

const BackupWizardModalBody = dynamic(
  () => import("./BackupWizardModalBody").then((m) => m.BackupWizardModalBody),
  {
    ssr: false,
    loading: () => <LoadingRegion label="Loading" className="min-h-56" />,
  },
);

export function BackupWizardModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [header, setHeader] = useState<BackupWizardHeader | null>(null);
  // Recovery material leaves with the body the moment the dialog closes; only
  // the step's heading stays for the exit animation.
  const shownHeader = useRetainedForExit(header);

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      busy={busy}
      busyReason="Wait for this backup step to finish before closing."
    >
      <ModalHeader
        title={shownHeader?.title ?? "Backup & Recovery"}
        subtitle={shownHeader?.subtitle ?? "One guided flow to protect your wallet"}
        onClose={onClose}
        onBack={shownHeader?.onBack}
      />
      {open ? (
        <BackupWizardModalBody
          onClose={onClose}
          onBusyChange={setBusy}
          onHeaderChange={setHeader}
        />
      ) : null}
    </Modal>
  );
}
