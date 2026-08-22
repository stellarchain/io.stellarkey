"use client";

import { useWallet } from "@/hooks/useWallet";
import { Dashboard } from "./Dashboard";
import { LockScreen } from "./LockScreen";
import { Onboarding } from "./Onboarding";
import { LogoMark } from "./icons";

export function WalletApp() {
  const { phase } = useWallet();

  if (phase === "loading") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <LogoMark size={44} />
        <span className="spinner text-accent" />
      </div>
    );
  }
  if (phase === "empty") return <Onboarding />;
  if (phase === "locked") return <LockScreen />;
  return <Dashboard />;
}
