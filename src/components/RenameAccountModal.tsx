"use client";

import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import { formatTrezorAddress } from "@/lib/address-display";
import type { AccountMeta } from "@/lib/types";
import { LoadingRegion, Modal, ModalHeader } from "./ui";

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
        subtitle={account ? `Custom label for ${formatTrezorAddress(account.publicKey)}` : undefined}
        onClose={onClose}
      />
      {account ? (
        <RenameAccountModalBody
          key={account.id}
          account={account}
          inputRef={inputRef}
          onClose={onClose}
          onDirtyChange={setDirty}
        />
      ) : null}
    </Modal>
  );
}
