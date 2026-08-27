"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { useWalletLifecycleActions, useWalletPhase } from "@/hooks/useWallet";
import { LockScreen } from "./LockScreen";
import { Onboarding } from "./Onboarding";
import { LogoMark } from "./icons";
import { StorageRecoveryScreen } from "./StorageRecoveryScreen";

const UnlockedWalletShell = dynamic(
  () => import("./UnlockedWalletShell").then((module) => module.UnlockedWalletShell),
  {
    ssr: false,
    loading: () => (
      <div role="status" aria-label="Opening wallet" className="app-safe-top flex min-h-screen flex-col items-center justify-center gap-4">
        <LogoMark size={44} />
        <span className="spinner text-accent" />
      </div>
    ),
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
