"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { AssetBalance } from "@/lib/types";
import { LoadingRegion, Modal, ModalHeader, useRetainedForExit } from "./ui";
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
  // Retain the favourite state with the asset so the row does not flip while
  // the sheet leaves (the owner clears both together).
  const detail = useMemo(() => (asset ? { asset, favorite } : null), [asset, favorite]);
  const shown = useRetainedForExit(detail);
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
      {shown && (
        <>
          <ModalHeader
            title={header?.title ?? shown.asset.code}
            subtitle={header ? header.subtitle : shown.asset.isNative ? "Stellar Lumens" : undefined}
            onClose={onClose}
          />
          <AssetDetailModalBody
            key={shown.asset.key}
            asset={shown.asset}
            favorite={shown.favorite}
            onToggleFavorite={onToggleFavorite}
            onClose={onClose}
            onBusyChange={setBusy}
            onHeaderChange={setHeader}
          />
        </>
      )}
    </Modal>
  );
}
