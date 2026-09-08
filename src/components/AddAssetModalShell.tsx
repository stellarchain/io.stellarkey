"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import {
  usePrivateBalanceRuntime,
} from "@/hooks/usePrivateBalanceRuntime";
import { LoadingRegion, Modal, ModalHeader, Tabs } from "./ui";
import type { AddAssetHeader } from "./AddAssetModal";

const AddAssetPublicPanel = dynamic(
  () => import("./AddAssetModal").then((module) => module.AddAssetPublicPanel),
  {
    ssr: false,
    loading: () => <LoadingRegion label="Opening public assets" />,
  },
);
const PrivateAddFunds = dynamic(
  () => import("@/features/private-balance/components/AddPrivateFunds").then(
    (module) => module.AddPrivateFunds,
  ),
  {
    ssr: false,
    loading: () => <LoadingRegion label="Opening private funding" />,
  },
);
const PrivatePaymentAccessGate = dynamic(
  () => import("@/features/private-balance/components/PrivatePaymentAccessGate").then(
    (module) => module.PrivatePaymentAccessGate,
  ),
  {
    ssr: false,
    loading: () => <LoadingRegion label="Opening private payment" />,
  },
);

export function AddAssetModal({
  open,
  initialMode = "public",
  onClose,
}: {
  open: boolean;
  initialMode?: "public" | "private";
  onClose: () => void;
}) {
  const [surfaceBusy, setSurfaceBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [header, setHeader] = useState<AddAssetHeader | null>(null);
  const privateCloseHandler = useRef<(() => void) | null>(null);

  const setPrivateCloseHandler = useCallback((handler: (() => void) | null) => {
    privateCloseHandler.current = handler;
  }, []);

  const requestClose = useCallback(() => {
    const closePrivate = privateCloseHandler.current;
    if (closePrivate) {
      closePrivate();
      return;
    }
    onClose();
  }, [onClose]);

  return (
    <Modal
      open={open}
      onClose={requestClose}
      wide
      busy={surfaceBusy}
      busyReason="Wait for the trustline transaction to finish before closing."
      dirty={dirty}
    >
      <ModalHeader
        title={header?.title ?? "Add Assets"}
        subtitle={header ? header.subtitle : "Add public trustlines or fund a private balance"}
        onBack={header?.onBack}
        onClose={requestClose}
      />
      <AddAssetSurface
        initialMode={initialMode}
        surfaceBusy={surfaceBusy}
        onClose={onClose}
        onBusyChange={setSurfaceBusy}
        onDirtyChange={setDirty}
        onHeaderChange={setHeader}
        onPrivateCloseHandlerChange={setPrivateCloseHandler}
      />
    </Modal>
  );
}

// Mounted with the shell and unmounted after its exit, so every opening starts
// on the requested mode with an empty queue.
function AddAssetSurface({
  initialMode,
  surfaceBusy,
  onClose,
  onBusyChange,
  onDirtyChange,
  onHeaderChange,
  onPrivateCloseHandlerChange,
}: {
  initialMode: "public" | "private";
  surfaceBusy: boolean;
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
  onDirtyChange: (dirty: boolean) => void;
  onHeaderChange: (header: AddAssetHeader | null) => void;
  onPrivateCloseHandlerChange: (handler: (() => void) | null) => void;
}) {
  const { availableAssets, requestRuntime } = usePrivateBalanceRuntime();
  const [addMode, setAddMode] = useState<"public" | "private">(initialMode);
  const [, startRuntimeTransition] = useTransition();
  const privateLeaveHandler = useRef<(() => Promise<void>) | null>(null);

  const changeMode = (next: "public" | "private") => {
    if (next === addMode || surfaceBusy) return;
    const leavePrivate = addMode === "private" ? privateLeaveHandler.current?.() : null;
    setAddMode(next);
    if (next === "private") startRuntimeTransition(requestRuntime);
    if (leavePrivate) void leavePrivate.catch(() => undefined);
  };
  const panel = addMode === "private" ? (
    <PrivatePaymentAccessGate action="add">
      <PrivateAddFunds
        onClose={onClose}
        showAssetSelector
        embedded
        onCloseHandlerChange={onPrivateCloseHandlerChange}
        onBeforeLeaveChange={(handler) => {
          privateLeaveHandler.current = handler;
        }}
        onWorkingChange={onBusyChange}
        onHeaderChange={onHeaderChange}
      />
    </PrivatePaymentAccessGate>
  ) : (
    <AddAssetPublicPanel
      onClose={onClose}
      onBusyChange={onBusyChange}
      onDirtyChange={onDirtyChange}
      onHeaderChange={onHeaderChange}
    />
  );

  if (availableAssets.length === 0) return panel;
  return (
    <Tabs
      value={addMode}
      options={[
        { label: "Public", value: "public", disabled: surfaceBusy },
        { label: "Private", value: "private", disabled: surfaceBusy },
      ]}
      onChange={changeMode}
      ariaLabel="Where to add funds"
      activationMode="manual"
      panelBusy={surfaceBusy}
      tabListClassName="mx-4 mt-4 sm:mx-6"
      panelClassName="min-h-56"
    >
      {panel}
    </Tabs>
  );
}
