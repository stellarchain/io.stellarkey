"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { LoadingRegion, Modal, ModalHeader, useMountedThroughExit } from "./ui";
import type { NetworkStatsHeader } from "./NetworkStatsModalBody";

const NetworkStatsModalBody = dynamic(
  () => import("./NetworkStatsModalBody").then((m) => m.NetworkStatsModalBody),
  {
    ssr: false,
    loading: () => <LoadingRegion label="Loading" className="min-h-56" />,
  },
);

export function NetworkStatsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  // Every opening measures again: the body mounts fresh and stays through the exit.
  const mounted = useMountedThroughExit(open);
  const [generation, setGeneration] = useState(0);
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setGeneration((current) => current + 1);
  }

  const [header, setHeader] = useState<NetworkStatsHeader | null>(null);

  return (
    <Modal open={open} onClose={onClose} wide>
      <ModalHeader
        title={header?.title ?? "Network Status"}
        subtitle={header?.subtitle ?? "Observed data from the Stellar network"}
        onClose={onClose}
      />
      {mounted ? (
        <NetworkStatsModalBody key={generation} onClose={onClose} onHeaderChange={setHeader} />
      ) : null}
    </Modal>
  );
}
