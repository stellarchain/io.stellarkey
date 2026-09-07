"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import type { ActivityItem } from "@/lib/types";
import { LoadingRegion, Modal, ModalHeader, useRetainedForExit } from "./ui";
import type { TxDetailHeader } from "./TxDetailModalBody";

// The receipt, note and explorer links live in a lazily loaded body so the
// shell opens at once and shows a loading region until the chunk arrives.
const TxDetailModalBody = dynamic(
  () => import("./TxDetailModalBody").then((m) => m.TxDetailModalBody),
  {
    ssr: false,
    loading: () => <LoadingRegion label="Opening transaction details" className="min-h-56" />,
  },
);

export function TxDetailModal({
  item,
  onClose,
}: {
  item: ActivityItem | null;
  onClose: () => void;
}) {
  const shown = useRetainedForExit(item);
  const [header, setHeader] = useState<TxDetailHeader | null>(null);
  return (
    <Modal open={item !== null} onClose={onClose}>
      {shown && (
        <>
          <ModalHeader
            title={header?.title ?? shown.title}
            subtitle={
              header
                ? header.subtitle
                : new Date(shown.createdAt).toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })
            }
            onClose={onClose}
          />
          <TxDetailModalBody
            key={shown.hash}
            item={shown}
            onClose={onClose}
            onHeaderChange={setHeader}
          />
        </>
      )}
    </Modal>
  );
}
