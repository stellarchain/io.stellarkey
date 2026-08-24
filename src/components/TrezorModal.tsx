"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import { connectTrezorDevice, getStellarDerivationPath, warmTrezorConnect } from "@/lib/hardware";
import { triggerHaptic } from "@/lib/haptics";
import { Button, ErrorText, Modal, ModalHeader } from "./ui";
import { IconCheck, IconExternal, IconTrezor } from "./icons";

export function TrezorModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { addHardwareAccount } = useWallet();
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectedInfo, setConnectedInfo] = useState<{
    publicKey: string;
    path: string;
    index: number;
  } | null>(null);

  // Preload + init the connect bundle as soon as the modal opens so the
  // click below can open the official device interaction immediately.
  useEffect(() => {
    if (open) warmTrezorConnect();
  }, [open]);

  async function handleConnectTrezor() {
    setError(null);
    setBusy(true);
    try {
      const info = await connectTrezorDevice(index);
      setConnectedInfo({ publicKey: info.publicKey, path: info.path, index: info.index });
      triggerHaptic("success");
    } catch (e) {
      triggerHaptic("error");
      setError(e instanceof Error ? e.message : "Failed to connect to Trezor device.");
    } finally {
      setBusy(false);
    }
  }

  async function handleImportAccount() {
    if (!connectedInfo) return;
    setBusy(true);
    try {
      await addHardwareAccount({
        publicKey: connectedInfo.publicKey,
        device: "trezor",
        path: connectedInfo.path,
        label: `Trezor Account ${connectedInfo.index + 1}`,
        index: connectedInfo.index,
      });
      triggerHaptic("success");
      onClose();
    } catch (e) {
      triggerHaptic("error");
      setError(e instanceof Error ? e.message : "Could not import account.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <Modal open onClose={onClose} wide>
      <ModalHeader
        title="Trezor Hardware Suite"
        subtitle="Cold-storage signing through Trezor Connect"
        onClose={onClose}
      />
      <div className="space-y-4 p-4 sm:p-6">
        {/* Device Hero Card */}
        <div className="rounded-3xl border border-emerald-500/25 bg-gradient-to-br from-emerald-950/40 via-zinc-900 to-black p-5 flex items-center justify-between shadow-xl">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-[11px] font-semibold text-emerald-400">
              <IconTrezor size={13} />
              <span>Trezor Safe &amp; Model T / One</span>
            </div>
            <h3 className="text-[17px] font-bold text-white tracking-tight">
              Hardware Security Architecture
            </h3>
            <p className="text-[12px] text-neutral-400 max-w-sm">
              Your secret keys remain 100% offline inside the Trezor hardware device. Every transfer requires physical confirmation.
            </p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 text-2xl shadow-inner">
            <IconTrezor size={28} />
          </div>
        </div>

        {/* Path Selection */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-semibold uppercase tracking-wider text-neutral-400">
              Account Derivation Index
            </span>
            <span className="mono text-[12px] font-semibold text-[#0A84FF]">
              {getStellarDerivationPath(index)}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {[0, 1, 2, 3, 4].map((i) => (
              <button
                key={i}
                type="button"
                disabled={busy}
                onClick={() => {
                  triggerHaptic("selection");
                  setIndex(i);
                  setConnectedInfo(null);
                }}
                className={`flex-1 py-1.5 rounded-xl text-[12px] font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
                  index === i
                    ? "bg-[#0A84FF] text-white shadow-sm"
                    : "bg-white/[0.06] text-neutral-400 hover:text-white"
                }`}
              >
                Index #{i}
              </button>
            ))}
          </div>
        </div>

        {/* Connection status */}
        {connectedInfo ? (
          <div className="rounded-2xl border border-[#30D158]/30 bg-[#30D158]/10 p-4 space-y-2">
            <div className="flex items-center justify-between text-[#30D158] font-semibold text-[13px]">
              <div className="flex items-center gap-1.5">
                <IconCheck size={16} />
                <span>Trezor Device Connected</span>
              </div>
              <span className="text-[11px] font-mono">{connectedInfo.path}</span>
            </div>
            <p className="mono select-all break-all text-[12px] text-white bg-black/40 p-2.5 rounded-xl border border-white/10">
              {connectedInfo.publicKey}
            </p>
            <Button
              className="w-full !py-3 text-[14px] font-semibold !bg-[#30D158] !text-black hover:!bg-emerald-400"
              loading={busy}
              onClick={() => void handleImportAccount()}
            >
              Import Trezor Account {connectedInfo.index + 1}
            </Button>
          </div>
        ) : (
          <Button
            className="w-full !py-3.5 text-[15px] font-semibold !bg-[#0A84FF] text-white"
            loading={busy}
            onClick={() => void handleConnectTrezor()}
          >
            <IconTrezor size={18} /> Connect with Trezor Connect
          </Button>
        )}

        {error && (
          <div>
            <ErrorText message={error} />
          </div>
        )}

        {/* Trezor official links */}
        <div className="flex items-center justify-between pt-2 px-1 text-[12px] text-neutral-400">
          <span>Need help setting up your Trezor?</span>
          <a
            href="https://suite.trezor.io"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#0A84FF] font-medium hover:underline flex items-center gap-1"
          >
            <span>Trezor Suite</span>
            <IconExternal size={12} />
          </a>
        </div>

        <Button variant="ghost" className="w-full" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  );
}
