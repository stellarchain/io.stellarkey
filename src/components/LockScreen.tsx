"use client";

import { useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import { triggerHaptic } from "@/lib/haptics";
import { ResetWalletModal } from "./ResetWalletModal";
import { Button, ErrorText, Field } from "./ui";
import { IconTrezor, LogoMark } from "./icons";

export function LockScreen() {
  const { unlock } = useWallet();
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
    <div className="mx-auto flex min-h-screen w-full max-w-sm sm:max-w-md flex-col items-center justify-center px-6 py-12">
      <div className={`w-full ${shaking ? "shake" : ""}`}>
        <div className="flex flex-col items-center text-center">
          <LogoMark size={56} />
          <h1 className="display-h mt-4 text-[26px] font-bold text-white">Wallet</h1>
          <p className="mt-1 text-[13.5px] text-neutral-400">
            Enter your password to unlock your vault
          </p>
        </div>

        <div className="panel mt-7 p-6 sm:p-8 shadow-2xl border border-white/10">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleUnlock();
            }}
            className="space-y-4"
          >
            <Field label="Password">
              <input
                className="input text-base sm:text-[14px]"
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

          <div className="mt-3 pt-3 border-t border-white/[0.08] flex items-center justify-center gap-2">
            <span className="text-[11px] text-neutral-400 font-medium flex items-center gap-1.5">
              <span>Hardware Backed:</span>
              <span className="flex items-center gap-1 text-emerald-400 font-semibold">
                <IconTrezor size={13} />
                <span>Trezor</span>
              </span>
            </span>
          </div>
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

      <ResetWalletModal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
      />
    </div>
  );
}
