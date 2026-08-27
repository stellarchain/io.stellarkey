"use client";

import { Dashboard } from "./Dashboard";
import { MerchantRuntimeBoundary } from "./MerchantRuntimeBoundary";

/** Merchant operations mount only for enabled, legacy, or explicitly opened tills. */
export function UnlockedWalletShell() {
  return (
    <MerchantRuntimeBoundary>
      <Dashboard />
    </MerchantRuntimeBoundary>
  );
}
