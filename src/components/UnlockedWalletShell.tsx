"use client";

import { Dashboard } from "./Dashboard";
import { MerchantRuntimeBoundary } from "./MerchantRuntimeBoundary";
import { PrivateBalanceRuntimeBoundary } from "./PrivateBalanceRuntimeBoundary";
import { SigningPasswordPrompt } from "./SigningPasswordPrompt";

/** Merchant operations mount only for enabled or explicitly opened tills. */
export function UnlockedWalletShell() {
  return (
    <>
      <PrivateBalanceRuntimeBoundary>
        <MerchantRuntimeBoundary>
          <Dashboard />
        </MerchantRuntimeBoundary>
      </PrivateBalanceRuntimeBoundary>
      <SigningPasswordPrompt />
    </>
  );
}
