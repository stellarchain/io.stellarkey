"use client";

import { useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import { triggerHaptic } from "@/lib/haptics";
import { Button, ErrorText, Field, Modal, ModalHeader } from "./ui";
import { IconFingerprint, LogoMark } from "./icons";

export function LockScreen() {
  const { unlock, resetWallet, biometricsEnabled } = useWallet();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shaking, setShaking] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  async function handleUnlock() {
    if (!password) return;
    setBusy(true);
    setError(null);
    try {
      await unlock(password);
      triggerHaptic("success");
    } catch (e) {
      triggerHaptic("error");
      setError(e instanceof Error ? e.message : "Incorrect password.");
      setShaking(true);
      window.setTimeout(() => setShaking(false), 450);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-sm flex-col items-center justify-center px-6">
      <div className={`w-full ${shaking ? "shake" : ""}`}>
        <div className="flex flex-col items-center text-center">
          <LogoMark size={56} />
          <h1 className="display-h mt-4 text-[26px] font-bold text-white">Polaris</h1>
          <p className="mt-1 text-[13.5px] text-neutral-400">
            Enter your password to unlock your vault
          </p>
        </div>

        <div className="panel mt-7 p-5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleUnlock();
            }}
            className="space-y-4"
          >
            <Field label="Password">
              <input
                className="input text-[14px]"
                type="password"
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                autoComplete="current-password"
              />
            </Field>

            <ErrorText message={error ?? ""} />

            <Button
              type="submit"
              className="w-full !py-3 text-[15px] font-semibold"
              loading={busy}
              disabled={!password || busy}
            >
              Unlock Vault
            </Button>
          </form>

          {biometricsEnabled && (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => {
                  triggerHaptic("selection");
                  // Trigger biometric simulation or prompt
                }}
                className="flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-white/[0.08]"
              >
                <IconFingerprint size={18} className="text-[#0A84FF]" />
                <span>Unlock with Touch ID</span>
              </button>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => {
            triggerHaptic("selection");
            setConfirmReset(true);
          }}
          className="mt-6 block w-full text-center text-[13px] text-neutral-500 hover:text-neutral-300 transition-colors"
        >
          Forgot password? Reset wallet
        </button>
      </div>

      <Modal open={confirmReset} onClose={() => setConfirmReset(false)}>
        <ModalHeader title="Reset this wallet?" onClose={() => setConfirmReset(false)} />
        <div className="px-6 pb-6 pt-2">
          <p className="text-[13.5px] leading-relaxed text-neutral-300">
            Resetting your wallet will erase all encrypted data from this browser. If you don&apos;t have a backup of your recovery phrase or secret key, your funds will be lost forever.
          </p>
          <div className="mt-6 flex gap-3">
            <Button variant="ghost" className="flex-1" onClick={() => setConfirmReset(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              onClick={() => {
                triggerHaptic("error");
                setConfirmReset(false);
                resetWallet();
              }}
            >
              Erase & Reset
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
