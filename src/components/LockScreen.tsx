"use client";

import { useState } from "react";
import { useWalletLifecycleActions } from "@/hooks/useWallet";
import { triggerHaptic } from "@/lib/haptics";
import { canOfferPasskeyUnlock } from "@/lib/passkey-prf";
import { hasPasskeyUnlock } from "@/lib/vault";
import { ResetWalletModal } from "./ResetWalletModal";
import { Button, ErrorText, Field } from "./ui";
import { IconFingerprint, IconTrezor, LogoMark } from "./icons";

export function LockScreen() {
  const { unlock, unlockWithPasskey } = useWalletLifecycleActions();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"password" | "passkey" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shaking, setShaking] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [passkeyConfigured] = useState(() => hasPasskeyUnlock());
  const [passkeyAvailable] = useState(() => canOfferPasskeyUnlock());

  async function handleUnlock() {
    if (!password) return;
    setBusy("password");
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
      setBusy(null);
    }
  }

  async function handlePasskeyUnlock() {
    setBusy("passkey");
    setError(null);
    try {
      await unlockWithPasskey();
      triggerHaptic("success");
    } catch (cause) {
      triggerHaptic("error");
      setError(cause instanceof Error ? cause.message : "Passkey unlock failed. Use your password.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="app-safe-top app-safe-top-pad-12 mx-auto flex min-h-screen w-full max-w-sm sm:max-w-md flex-col items-center justify-center px-6 py-12">
      <div className={`w-full ${shaking ? "shake" : ""}`}>
        <div className="flex flex-col items-center text-center">
          <LogoMark size={56} />
          <h1 className="display-h mt-4 text-[26px] font-bold text-white">Wallet</h1>
          <p className="mt-1 text-[13.5px] text-neutral-400">
            {passkeyConfigured ? "Use Face ID, Touch ID, or your password" : "Enter your password to unlock your vault"}
          </p>
        </div>

        <div className="panel mt-7 p-6 sm:p-8 shadow-2xl border border-white/10">
          {passkeyConfigured && passkeyAvailable && (
            <>
              <Button
                type="button"
                className="w-full !py-3 text-[15px] font-semibold"
                loading={busy === "passkey"}
                disabled={busy !== null}
                onClick={() => void handlePasskeyUnlock()}
              >
                <span className="flex items-center justify-center gap-2">
                  <IconFingerprint size={18} />
                  Unlock with Face ID / Touch ID
                </span>
              </Button>
              <div className="my-4 flex items-center gap-3" aria-hidden>
                <span className="h-px flex-1 bg-white/[0.08]" />
                <span className="text-[11px] font-medium uppercase tracking-wider text-neutral-500">or password</span>
                <span className="h-px flex-1 bg-white/[0.08]" />
              </div>
            </>
          )}

          {passkeyConfigured && !passkeyAvailable && (
            <p className="mb-4 rounded-xl border border-amber-400/20 bg-amber-400/[0.07] p-3 text-[12px] leading-relaxed text-amber-200">
              Face ID / Touch ID needs HTTPS on this address. Password unlock is always available.
            </p>
          )}

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
                autoFocus={!passkeyConfigured}
                autoComplete="current-password"
              />
            </Field>

            <ErrorText message={error ?? ""} />

            <Button
              type="submit"
              className="w-full !py-3 text-[15px] font-semibold"
              loading={busy === "password"}
              disabled={!password || busy !== null}
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
