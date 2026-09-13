"use client";

import { useCallback, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { LoadingRegion, Modal, ModalHeader } from "./ui";
import type { AddAccountHeader, AddAccountMode } from "./AddAccountModalBody";

const AddAccountModalBody = dynamic(
  () => import("./AddAccountModalBody").then((m) => m.AddAccountModalBody),
  {
    ssr: false,
    loading: () => <LoadingRegion label="Loading" className="min-h-56" />,
  },
);

/** Shown until the body reports the mode it settled on. */
const MODE_SUBTITLES: Record<AddAccountMode, string> = {
  generate: "Create another account from this wallet's recovery phrase",
  import: "Import an existing Stellar secret key",
  hardware: "Connect a device and verify its Stellar address",
  watch: "Track any address — balances only, no keys",
};

export function AddAccountModal({
  open,
  onClose,
  initialMode = "generate",
}: {
  open: boolean;
  onClose: () => void;
  initialMode?: AddAccountMode;
}) {
  // The shell retains exit geometry; imported keys leave with the opening.
  const [generation, setGeneration] = useState(0);
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setGeneration((current) => current + 1);
  }

  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [header, setHeader] = useState<AddAccountHeader | null>(null);
  const closeHandlerRef = useRef<(() => void) | null>(null);
  const setCloseHandler = useCallback((handler: (() => void) | null) => {
    closeHandlerRef.current = handler;
  }, []);
  // Every dismissal goes through the body's busy-guarded close once it exists.
  const requestClose = useCallback(() => {
    const close = closeHandlerRef.current;
    if (close) close();
    else onClose();
  }, [onClose]);

  return (
    <Modal
      open={open}
      onClose={requestClose}
      busy={busy}
      busyReason="Wait for the account to finish being added before closing."
      dirty={dirty}
    >
      <ModalHeader
        title={header?.title ?? "Add Account"}
        subtitle={header?.subtitle ?? MODE_SUBTITLES[initialMode]}
        onClose={requestClose}
      />
      {open ? (
        <AddAccountModalBody
          key={generation}
          initialMode={initialMode}
          onClose={onClose}
          onBusyChange={setBusy}
          onDirtyChange={setDirty}
          onHeaderChange={setHeader}
          onCloseHandlerChange={setCloseHandler}
        />
      ) : null}
    </Modal>
  );
}
