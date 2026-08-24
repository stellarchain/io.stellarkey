"use client";

import { useEffect } from "react";
import { useWallet } from "@/hooks/useWallet";
import { Dashboard } from "./Dashboard";
import { LockScreen } from "./LockScreen";
import { Onboarding } from "./Onboarding";
import { LogoMark } from "./icons";

export function WalletApp() {
  const { phase } = useWallet();

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
  if (phase === "empty") return <Onboarding />;
  if (phase === "locked") return <LockScreen />;
  return <Dashboard />;
}
