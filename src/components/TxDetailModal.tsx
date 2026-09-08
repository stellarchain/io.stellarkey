"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import type { ActivityItem } from "@/lib/types";
import { LoadingRegion, Modal, ModalHeader } from "./ui";
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
  const [header, setHeader] = useState<TxDetailHeader | null>(null);
  return (
    <Modal open={item !== null} onClose={onClose}>
      <ModalHeader
        title={item ? header?.title ?? item.title : "Transaction details"}
        subtitle={item ? header?.subtitle ?? new Date(item.createdAt).toLocaleString(undefined, {
          dateStyle: "medium", timeStyle: "short",
        }) : undefined}
        onClose={onClose}
      />
      {item ? (
        <TxDetailModalBody key={item.hash} item={item} onClose={onClose} onHeaderChange={setHeader} />
      ) : null}
    </Modal>
  );
}
