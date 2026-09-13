"use client";

import { useRef, useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { LoadingRegion, Modal, useMountedThroughExit } from "./ui";
import type { PaletteAction } from "./CommandPaletteBody";

export type { PaletteAction } from "./CommandPaletteBody";

const CommandPaletteBody = dynamic(
  () => import("./CommandPaletteBody").then((m) => m.CommandPaletteBody),
  {
    ssr: false,
    loading: () => <LoadingRegion label="Loading" className="min-h-56" />,
  },
);

export function CommandPalette({
  open,
  onClose,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  actions: PaletteAction[];
}) {
  // A launcher must not take over a dialog that holds focus (signing, setup):
  // while another dialog is open the palette stays quiet, whoever asked.
  useEffect(() => {
    if (!open) return;
    if (document.querySelector('[data-modal-backdrop][data-overlay-state="open"]:not([aria-label="Command palette"])')) onClose();
  }, [open, onClose]);
  // Every opening starts from an empty search: the body mounts fresh and
  // stays through the shell's exit.
  const mounted = useMountedThroughExit(open);
  const [generation, setGeneration] = useState(0);
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setGeneration((current) => current + 1);
  }

  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <Modal
      open={open}
      onClose={onClose}
      anchor="top"
      wide
      ariaLabel="Command palette"
      initialFocus={() => inputRef.current}
    >
      {mounted ? (
        <CommandPaletteBody
          key={generation}
          actions={actions}
          inputRef={inputRef}
          onClose={onClose}
        />
      ) : null}
    </Modal>
  );
}
