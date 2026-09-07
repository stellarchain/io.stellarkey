"use client";

import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import { formatTrezorAddress } from "@/lib/address-display";
import type { AccountMeta } from "@/lib/types";
import { LoadingRegion, Modal, ModalHeader, useRetainedForExit } from "./ui";

const RenameAccountModalBody = dynamic(
  () => import("./RenameAccountModalBody").then((m) => m.RenameAccountModalBody),
  {
    ssr: false,
    loading: () => <LoadingRegion label="Loading" className="min-h-56" />,
  },
);

export function RenameAccountModal({
  account,
  onClose,
}: {
  account: AccountMeta | null;
  onClose: () => void;
}) {
  // The account keeps rendering through the exit; a different account gets a fresh editor.
  const shown = useRetainedForExit(account);
  const [dirty, setDirty] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <Modal
      open={account !== null}
      onClose={onClose}
      initialFocus={() => inputRef.current}
      dirty={dirty}
    >
      <ModalHeader
        title="Rename Account"
        subtitle={shown ? `Custom label for ${formatTrezorAddress(shown.publicKey)}` : undefined}
        onClose={onClose}
      />
      {shown ? (
        <RenameAccountModalBody
          key={shown.id}
          account={shown}
          inputRef={inputRef}
          onClose={onClose}
          onDirtyChange={setDirty}
        />
      ) : null}
    </Modal>
  );
}
