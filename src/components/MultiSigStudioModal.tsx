"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { LoadingRegion, Modal, ModalHeader, useMountedThroughExit } from "./ui";
import type { MultiSigStudioHeader } from "./MultiSigStudioModalBody";

const MultiSigStudioModalBody = dynamic(
  () => import("./MultiSigStudioModalBody").then((m) => m.MultiSigStudioModalBody),
  {
    ssr: false,
    loading: () => <LoadingRegion label="Loading" className="min-h-56" />,
  },
);

export function MultiSigStudioModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  // The studio mounts fresh for each opening and stays through the shell's exit.
  const mounted = useMountedThroughExit(open);
  const [generation, setGeneration] = useState(0);
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setGeneration((current) => current + 1);
  }

  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [header, setHeader] = useState<MultiSigStudioHeader | null>(null);

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      busy={busy}
      busyReason="Wait for the current multi-sig step to finish before closing."
      dirty={dirty}
    >
      <ModalHeader
        title={header?.title ?? "Multi-Sig Studio"}
        subtitle={header?.subtitle ?? "Shared control for this account"}
        onClose={onClose}
        onBack={header?.onBack}
      />
      {mounted ? (
        <MultiSigStudioModalBody
          key={generation}
          onBusyChange={setBusy}
          onDirtyChange={setDirty}
          onHeaderChange={setHeader}
        />
      ) : null}
    </Modal>
  );
}
