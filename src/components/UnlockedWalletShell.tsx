"use client";

import { MerchantProvider } from "@/hooks/useMerchant";
import { Dashboard } from "./Dashboard";

/** Loaded only after vault unlock so merchant operations never tax onboarding or lock-screen startup. */
export function UnlockedWalletShell() {
  return (
    <MerchantProvider>
      <Dashboard />
    </MerchantProvider>
  );
}
