"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import {
  MERCHANT_BOOTSTRAP_CHANGED_EVENT,
  MERCHANT_BOOTSTRAP_STORAGE_KEY,
  readMerchantBootstrapState,
  type MerchantBootstrapState,
} from "@/lib/merchant/bootstrap";
import {
  MerchantRuntimeControlProvider,
  MerchantRuntimeDataProviders,
  type MerchantRuntimeControlValue,
  type MerchantRuntimeIntent,
  type MerchantSettingsContextValue,
  type MerchantShellContextValue,
} from "@/hooks/useMerchantRuntime";

const MerchantProvider = dynamic(
  () => import("@/hooks/useMerchant").then((module) => module.MerchantProvider),
  {
    ssr: false,
    loading: () => (
      <div role="status" className="app-safe-top flex min-h-screen items-center justify-center gap-3 text-sm text-neutral-400">
        <span className="spinner text-accent" />
        Opening merchant tools…
      </div>
    ),
  },
);

const EMPTY_SHELL: MerchantShellContextValue = {
  enabled: false,
  unmatched: [],
  charges: [],
  activeShift: null,
};

/**
 * Keeps the normal wallet graph lean. Missing hints are treated conservatively:
 * older wallets load once, then the encrypted store publishes a validated hint.
 */
export function MerchantRuntimeBoundary({ children }: { children: ReactNode }) {
  const [bootstrap, setBootstrap] = useState<MerchantBootstrapState | null>(() =>
    readMerchantBootstrapState(),
  );
  const [requested, setRequested] = useState(false);
  const [enableOnReady, setEnableOnReady] = useState(false);
  const [intent, setIntent] = useState<MerchantRuntimeIntent | null>(null);
  const requestedRef = useRef(false);

  const requestRuntime = useCallback((nextIntent: MerchantRuntimeIntent) => {
    requestedRef.current = true;
    setRequested(true);
    setIntent(nextIntent);
  }, []);
  const consumeIntent = useCallback(() => setIntent(null), []);
  const releaseRuntime = useCallback(() => {
    requestedRef.current = false;
    setRequested(false);
    setEnableOnReady(false);
    setIntent(null);
  }, []);

  useEffect(() => {
    const refresh = () => {
      const next = readMerchantBootstrapState();
      if (!next) return;
      setBootstrap(next);
      if (next.enabled) {
        requestedRef.current = false;
        setRequested(false);
        setEnableOnReady(false);
      } else if (!requestedRef.current) {
        setRequested(false);
        setEnableOnReady(false);
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === MERCHANT_BOOTSTRAP_STORAGE_KEY) refresh();
    };
    window.addEventListener(MERCHANT_BOOTSTRAP_CHANGED_EVENT, refresh);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(MERCHANT_BOOTSTRAP_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const fallbackSettings = useMemo<MerchantSettingsContextValue>(() => ({
    enabled: false,
    configured: bootstrap?.configured ?? false,
    profileName: "",
    setEnabled: async (on) => {
      if (!on) return;
      setEnableOnReady(true);
      requestRuntime("settings");
    },
  }), [bootstrap?.configured, requestRuntime]);
  const control = useMemo<MerchantRuntimeControlValue>(() => ({
    intent,
    requestRuntime,
    consumeIntent,
    releaseRuntime,
  }), [consumeIntent, intent, releaseRuntime, requestRuntime]);
  const shouldMount = bootstrap === null || bootstrap.enabled || requested;

  return (
    <MerchantRuntimeControlProvider value={control}>
      {shouldMount ? (
        <MerchantProvider enableOnReady={enableOnReady}>{children}</MerchantProvider>
      ) : (
        <MerchantRuntimeDataProviders shell={EMPTY_SHELL} settings={fallbackSettings}>
          {children}
        </MerchantRuntimeDataProviders>
      )}
    </MerchantRuntimeControlProvider>
  );
}
