"use client";

import dynamic from "next/dynamic";
import { LoadingRegion, Modal, ModalHeader, useMountedThroughExit } from "./ui";

const KeyboardShortcutsModalBody = dynamic(
  () => import("./KeyboardShortcutsModalBody").then((m) => m.KeyboardShortcutsModalBody),
  {
    ssr: false,
    loading: () => <LoadingRegion label="Loading" className="min-h-56" />,
  },
);

export function KeyboardShortcutsModal({
  open,
  onClose,
  merchantEnabled = false,
}: {
  open: boolean;
  onClose: () => void;
  merchantEnabled?: boolean;
}) {
  const mounted = useMountedThroughExit(open);

  return (
    <Modal open={open} onClose={onClose}>
      <ModalHeader
        title="Keyboard Shortcuts"
        subtitle="macOS & Web Pro Hotkeys"
        onClose={onClose}
      />
      {mounted ? (
        <KeyboardShortcutsModalBody merchantEnabled={merchantEnabled} onClose={onClose} />
      ) : null}
    </Modal>
  );
}
