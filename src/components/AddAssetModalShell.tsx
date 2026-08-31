"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import {
  usePrivateBalanceRuntime,
  usePrivateBalanceRuntimeData,
} from "@/hooks/usePrivateBalanceRuntime";
import { LoadingRegion, Modal, ModalHeader, Tabs } from "./ui";

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
const PrivateSetupContent = dynamic(
  () => import("@/features/private-balance/components/PrivateSetupContent").then(
    (module) => module.PrivateSetupContent,
  ),
  {
    ssr: false,
    loading: () => <LoadingRegion label="Opening private payment" />,
  },
);

export function AddAssetModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { availableAssets, requestRuntime } = usePrivateBalanceRuntime();
  const { configured } = usePrivateBalanceRuntimeData();
  const [addMode, setAddMode] = useState<"public" | "private">("public");
  const [, startRuntimeTransition] = useTransition();
  const [surfaceBusy, setSurfaceBusy] = useState(false);
  const privateCloseHandler = useRef<(() => void) | null>(null);
  const privateLeaveHandler = useRef<(() => Promise<void>) | null>(null);

  const close = useCallback(() => {
    privateCloseHandler.current = null;
    privateLeaveHandler.current = null;
    setAddMode("public");
    setSurfaceBusy(false);
    onClose();
  }, [onClose]);

  const requestClose = useCallback(() => {
    if (addMode === "private" && privateCloseHandler.current) {
      privateCloseHandler.current();
      return;
    }
    close();
  }, [addMode, close]);

  if (!open) return null;

  const changeMode = (next: "public" | "private") => {
    if (next === addMode || surfaceBusy) return;
    const leavePrivate = addMode === "private" ? privateLeaveHandler.current?.() : null;
    setAddMode(next);
    if (next === "private") startRuntimeTransition(requestRuntime);
    if (leavePrivate) void leavePrivate.catch(() => undefined);
  };
  const panel = addMode === "private" ? (
    configured ? (
      <PrivateAddFunds
        onClose={close}
        showAssetSelector
        embedded
        onCloseHandlerChange={(handler) => {
          privateCloseHandler.current = handler;
        }}
        onBeforeLeaveChange={(handler) => {
          privateLeaveHandler.current = handler;
        }}
        onWorkingChange={setSurfaceBusy}
      />
    ) : (
      <PrivateSetupContent action="add" />
    )
  ) : (
    <AddAssetPublicPanel onClose={close} onBusyChange={setSurfaceBusy} embedded />
  );

  return (
    <Modal open onClose={requestClose} wide dismissable={!surfaceBusy}>
      <ModalHeader
        title="Add Assets"
        subtitle="Add public trustlines or fund a private balance"
        onClose={requestClose}
        closeDisabled={surfaceBusy}
      />
      {availableAssets.length > 0 ? (
        <Tabs
          value={addMode}
          options={[
            { label: "Public", value: "public", disabled: surfaceBusy },
            { label: "Private", value: "private", disabled: surfaceBusy },
          ]}
          onChange={changeMode}
          ariaLabel="Where to add funds"
          panelBusy={surfaceBusy}
          tabListClassName="mx-4 mt-4 sm:mx-6"
          panelClassName="min-h-56"
        >
          {panel}
        </Tabs>
      ) : (
        panel
      )}
    </Modal>
  );
}
