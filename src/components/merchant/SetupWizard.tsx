"use client";

import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import { LoadingRegion, Modal, ModalHeader, useMountedThroughExit } from "../ui";
import type { SetupWizardHeader } from "./SetupWizardBody";

// The steps pull the merchant configuration, wallet balances and trustline
// signing; they load on the first open while the dialog shell and its header
// are always ready.
const SetupWizardBody = dynamic(
  () => import("./SetupWizardBody").then((m) => m.SetupWizardBody),
  {
    ssr: false,
    loading: () => <LoadingRegion label="Loading" className="min-h-56" />,
  },
);

/**
 * The Merchant Mode setup dialog. The body reports the current step ("Step N
 * of 4 · title" with the header Back control) and whether it is saving, which
 * blocks dismissal. The body needs the merchant provider, so the owner mounts
 * this shell only once the merchant runtime is requested.
 */
export function SetupWizard({
  open,
  onClose,
  onComplete,
}: {
  open: boolean;
  onClose: () => void;
  onComplete?: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [header, setHeader] = useState<SetupWizardHeader | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  // The wizard's draft lives in the body, which mounts on open and leaves after
  // the exit, so every opening starts on step one.
  const bodyMounted = useMountedThroughExit(open);
  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      busy={saving}
      busyReason="Wait for Merchant Mode to finish saving before closing."
      initialFocus={nameRef}
    >
      <ModalHeader
        title={header?.title ?? "Set up Merchant Mode"}
        subtitle={header ? header.subtitle : "Step 1 of 4 · The shop"}
        onBack={header?.onBack}
        onClose={onClose}
      />
      {bodyMounted ? (
        <SetupWizardBody
          onClose={onClose}
          onComplete={onComplete}
          nameRef={nameRef}
          onBusyChange={setSaving}
          onHeaderChange={setHeader}
        />
      ) : null}
    </Modal>
  );
}
