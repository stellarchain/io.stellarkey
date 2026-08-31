"use client";

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { writeShellMode } from "@/lib/shell-mode";
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

const LazyMerchantProvider = lazy(() =>
  import("@/hooks/useMerchant").then((module) => ({ default: module.MerchantProvider })),
);

const EMPTY_SHELL: MerchantShellContextValue = {
  enabled: false,
  unmatched: [],
  charges: [],
  activeShift: null,
};

/**
 * Keeps the normal wallet graph lean. The encrypted merchant runtime loads only
 * from a validated enabled hint or an explicit user request.
 */
export function MerchantRuntimeBoundary({ children }: { children: ReactNode }) {
  const [bootstrap, setBootstrap] = useState<MerchantBootstrapState | null>(null);
  const [requested, setRequested] = useState(false);
  const [enableOnReady, setEnableOnReady] = useState(false);
  const [runtimeMounted, setRuntimeMounted] = useState(false);
  const [intent, setIntent] = useState<MerchantRuntimeIntent | null>(null);
  const requestedRef = useRef(false);

  const requestRuntime = useCallback((nextIntent: MerchantRuntimeIntent) => {
    if (nextIntent === "merchant") writeShellMode("merchant");
    requestedRef.current = true;
    setRequested(true);
    setIntent(nextIntent);
  }, []);
  const consumeIntent = useCallback(() => setIntent(null), []);
  const markRuntimeMounted = useCallback(() => setRuntimeMounted(true), []);
  const releaseRuntime = useCallback(() => {
    requestedRef.current = false;
    setRequested(false);
    setEnableOnReady(false);
    setRuntimeMounted(false);
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
        setRuntimeMounted(false);
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === MERCHANT_BOOTSTRAP_STORAGE_KEY) refresh();
    };
    window.addEventListener(MERCHANT_BOOTSTRAP_CHANGED_EVENT, refresh);
    window.addEventListener("storage", onStorage);
    refresh();
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
    mounted: runtimeMounted,
    intent,
    requestRuntime,
    consumeIntent,
    releaseRuntime,
  }), [consumeIntent, intent, releaseRuntime, requestRuntime, runtimeMounted]);
  const fallback = (
    <MerchantRuntimeDataProviders shell={EMPTY_SHELL} settings={fallbackSettings}>
      {children}
    </MerchantRuntimeDataProviders>
  );
  const shouldMount = bootstrap?.enabled === true || requested;

  return (
    <MerchantRuntimeControlProvider value={control}>
      {shouldMount ? (
        <Suspense fallback={fallback}>
          <LazyMerchantProvider
            enableOnReady={enableOnReady}
            enabledHint={bootstrap?.enabled ?? false}
            onRuntimeMounted={markRuntimeMounted}
          >
            {children}
          </LazyMerchantProvider>
        </Suspense>
      ) : fallback}
    </MerchantRuntimeControlProvider>
  );
}
