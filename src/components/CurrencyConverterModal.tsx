"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { LoadingRegion, Modal, ModalHeader, useMountedThroughExit } from "./ui";
import type { CurrencyConverterHeader } from "./CurrencyConverterModalBody";

const CurrencyConverterModalBody = dynamic(
  () => import("./CurrencyConverterModalBody").then((m) => m.CurrencyConverterModalBody),
  {
    ssr: false,
    loading: () => <LoadingRegion label="Loading" className="min-h-56" />,
  },
);

export function CurrencyConverterModal({
  open,
  onClose,
  onOpenSwap,
}: {
  open: boolean;
  onClose: () => void;
  onOpenSwap?: () => void;
}) {
  // The converter mounts fresh for each opening and stays through the shell's exit.
  const mounted = useMountedThroughExit(open);
  const [generation, setGeneration] = useState(0);
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setGeneration((current) => current + 1);
  }

  const [header, setHeader] = useState<CurrencyConverterHeader | null>(null);

  return (
    <Modal open={open} onClose={onClose} wide>
      <ModalHeader
        title={header?.title ?? "Currency Converter"}
        subtitle={header?.subtitle ?? "Rates from observed market data"}
        onClose={onClose}
      />
      {mounted ? (
        <CurrencyConverterModalBody
          key={generation}
          onClose={onClose}
          onOpenSwap={onOpenSwap}
          onHeaderChange={setHeader}
        />
      ) : null}
    </Modal>
  );
}
