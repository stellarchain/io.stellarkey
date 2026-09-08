"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { LoadingRegion, Modal, ModalHeader } from "./ui";
import type {
  ClaimableBalancesHeader,
  ClaimableBalancesModalBodyProps,
} from "./ClaimableBalancesModalBody";

// The review list, selection and claim flow live in a lazily loaded body so
// the shell opens at once and shows a loading region until the chunk arrives.
const ClaimableBalancesModalBody = dynamic(
  () => import("./ClaimableBalancesModalBody").then((m) => m.ClaimableBalancesModalBody),
  {
    ssr: false,
    loading: () => <LoadingRegion label="Opening pending balances" className="min-h-56" />,
  },
);

type ClaimableBalancesModalProps = Omit<
  ClaimableBalancesModalBodyProps,
  "onBusyChange" | "onHeaderChange"
> & {
  open: boolean;
};

export function ClaimableBalancesModal({
  open,
  onClose,
  initialShowDismissed = false,
  ...props
}: ClaimableBalancesModalProps) {
  const [busy, setBusy] = useState(false);
  const [header, setHeader] = useState<ClaimableBalancesHeader | null>(null);
  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      busy={busy}
      busyReason="Wait for the claim to finish before closing."
    >
      <ModalHeader
        title={header?.title ?? (initialShowDismissed ? "Dismissed balances" : "Pending balances")}
        subtitle={
          header
            ? header.subtitle
            : initialShowDismissed
              ? "Hidden on this browser only"
              : "Select only the assets you recognize"
        }
        onClose={onClose}
      />
      {/* Mounted with the shell and unmounted after its exit, so every opening
          owns its own selections. */}
      <ClaimableBalancesModalBody
        initialShowDismissed={initialShowDismissed}
        onClose={onClose}
        onBusyChange={setBusy}
        onHeaderChange={setHeader}
        {...props}
      />
    </Modal>
  );
}
