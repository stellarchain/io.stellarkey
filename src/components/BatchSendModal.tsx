"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { LoadingRegion, Modal, ModalHeader } from "./ui";
import type { BatchSendHeader } from "./BatchSendModalBody";

// The form, review and broadcast stages live in a lazily loaded body so the
// shell opens at once and shows a loading region until the chunk arrives.
const BatchSendModalBody = dynamic(
  () => import("./BatchSendModalBody").then((m) => m.BatchSendModalBody),
  {
    ssr: false,
    loading: () => <LoadingRegion label="Opening multi-send" className="min-h-56" />,
  },
);

export function BatchSendModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
  memo?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [header, setHeader] = useState<BatchSendHeader | null>(null);
  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      busy={busy}
      busyReason="Wait for the batch to finish broadcasting before closing."
      dirty={dirty}
    >
      <ModalHeader
        title={header?.title ?? "Multi-Send Disperse"}
        subtitle={header ? header.subtitle : "Send payments to multiple recipients in 1 transaction"}
        onBack={header?.onBack}
        onClose={onClose}
      />
      {/* Recipients and review data leave immediately; the shell holds geometry. */}
      {open ? (
        <BatchSendModalBody
          onClose={onClose}
          onBusyChange={setBusy}
          onDirtyChange={setDirty}
          onHeaderChange={setHeader}
        />
      ) : null}
    </Modal>
  );
}
