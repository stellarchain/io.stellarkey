"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui";

/**
 * Global error boundary (Next.js App Router convention).
 * A crashed view never white-screens the wallet — the user can always recover.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the failure for diagnostics without leaking sensitive state
    console.error("[wallet-error-boundary]", error);
  }, [error]);

  return (
    <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-3xl border border-[#FF453A]/30 bg-[#FF453A]/10 text-2xl text-[#FF453A]">
        ⚠️
      </span>
      <h1 className="display-h mt-5 text-[26px] font-bold text-white">
        Something went wrong
      </h1>
      <p className="mt-2 max-w-sm text-[14px] leading-relaxed text-neutral-400">
        An unexpected error occurred while rendering this view. Your keys and
        funds are safe — the encrypted vault is untouched on this device.
      </p>
      <div className="mt-7 flex w-full max-w-xs flex-col gap-3">
        <Button className="w-full !py-3.5 text-[15px] font-semibold" onClick={reset}>
          Try Again
        </Button>
        <Button
          variant="ghost"
          className="w-full !py-3 text-[14px]"
          onClick={() => window.location.reload()}
        >
          Reload Wallet
        </Button>
      </div>
      <p className="mt-6 mono max-w-sm break-all text-[10.5px] leading-relaxed text-neutral-600">
        {error.digest ? `Ref: ${error.digest}` : error.message}
      </p>
    </div>
  );
}
