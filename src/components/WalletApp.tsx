"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useWalletLifecycleActions, useWalletPhase } from "@/hooks/useWallet";
import { LockScreen } from "./LockScreen";
import { Onboarding } from "./Onboarding";
import { LogoMark } from "./icons";
import { StorageRecoveryScreen } from "./StorageRecoveryScreen";
import { BuildIdentity } from "./BuildIdentity";

const OPENING_WALLET_SLOW_MS = 8_000;

function OpeningWalletFallback() {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), OPENING_WALLET_SLOW_MS);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={slow ? "Wallet is taking longer than expected to open" : "Opening wallet"}
      className="app-safe-top flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center"
    >
      <LogoMark size={44} />
      {slow ? (
        <div className="flex max-w-sm flex-col items-center gap-3">
          <p className="text-[17px] font-semibold text-white">Still opening</p>
          <p className="text-[13px] leading-relaxed text-neutral-400">
            Reload the local app to reconnect its files. Your wallet data stays on this device.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="min-h-11 rounded-xl bg-[#0A84FF] px-4 text-[14px] font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A84FF] focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          >
            Reload StellarKey
          </button>
        </div>
      ) : (
        <span className="spinner text-accent" />
      )}
      <BuildIdentity className="text-[10px] text-neutral-500" />
    </div>
  );
}

const UnlockedWalletShell = dynamic(
  () => import("./UnlockedWalletShell").then((module) => module.UnlockedWalletShell),
  {
    ssr: false,
    loading: () => <OpeningWalletFallback />,
  },
);

export function WalletApp() {
  const { phase, vaultStorageIssue } = useWalletPhase();
  const { resetWallet } = useWalletLifecycleActions();

  // Register as the OS-level handler for web+stellar pay links (SEP-0007 deep links)
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.registerProtocolHandler) return;
    try {
      navigator.registerProtocolHandler("web+stellar", "/?uri=%s");
    } catch {
      // Browser refused (e.g. not user-initiated or cross-origin) — harmless.
    }
  }, []);

  if (phase === "loading") {
    return (
      <div className="app-safe-top flex min-h-screen flex-col items-center justify-center gap-4">
        <LogoMark size={44} />
        <span className="spinner text-accent" />
        <BuildIdentity className="text-[10px] text-neutral-500" />
      </div>
    );
  }
  if (phase === "recovery" && vaultStorageIssue) {
    return <StorageRecoveryScreen issue={vaultStorageIssue} onReset={resetWallet} />;
  }
  if (phase === "empty") return <Onboarding />;
  if (phase === "locked") return <LockScreen />;
  return <UnlockedWalletShell />;
}
