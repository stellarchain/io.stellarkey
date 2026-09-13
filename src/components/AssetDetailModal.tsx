"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import type { AssetBalance } from "@/lib/types";
import { LoadingRegion, Modal, ModalHeader } from "./ui";
import type { AssetDetailHeader } from "./AssetDetailModalBody";

// Metadata, pricing and the trustline flow live in a lazily loaded body so the
// shell opens at once and shows a loading region until the chunk arrives.
const AssetDetailModalBody = dynamic(
  () => import("./AssetDetailModalBody").then((m) => m.AssetDetailModalBody),
  {
    ssr: false,
    loading: () => <LoadingRegion label="Opening asset details" className="min-h-56" />,
  },
);

export function AssetDetailModal({
  asset,
  favorite,
  onToggleFavorite,
  onClose,
}: {
  asset: AssetBalance | null;
  favorite: boolean;
  onToggleFavorite: (key: string) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [header, setHeader] = useState<AssetDetailHeader | null>(null);
  return (
    <Modal
      open={asset !== null}
      onClose={onClose}
      wide
      busy={busy}
      busyReason="Wait for the trustline removal to finish before closing."
    >
      <ModalHeader
        title={asset ? header?.title ?? asset.code : "Asset details"}
        subtitle={asset ? header ? header.subtitle : asset.isNative ? "Stellar Lumens" : undefined : undefined}
        onClose={onClose}
      />
      {asset ? (
        <AssetDetailModalBody
          key={asset.key}
          asset={asset}
          favorite={favorite}
          onToggleFavorite={onToggleFavorite}
          onClose={onClose}
          onBusyChange={setBusy}
          onHeaderChange={setHeader}
        />
      ) : null}
    </Modal>
  );
}
