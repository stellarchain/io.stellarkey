"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Charge, Shift, UnmatchedPayment } from "@/lib/merchant/types";

export interface MerchantShellContextValue {
  enabled: boolean;
  unmatched: UnmatchedPayment[];
  charges: Charge[];
  activeShift: Shift | null;
}

export interface MerchantSettingsContextValue {
  enabled: boolean;
  configured: boolean;
  setEnabled: (on: boolean) => Promise<void>;
  profileName: string;
}

export type MerchantRuntimeIntent = "setup" | "settings" | "merchant";

export interface MerchantRuntimeControlValue {
  mounted: boolean;
  intent: MerchantRuntimeIntent | null;
  requestRuntime: (intent: MerchantRuntimeIntent) => void;
  consumeIntent: () => void;
  releaseRuntime: () => void;
}

const MerchantShellContext = createContext<MerchantShellContextValue | null>(null);
const MerchantSettingsContext = createContext<MerchantSettingsContextValue | null>(null);
const MerchantRuntimeControlContext = createContext<MerchantRuntimeControlValue | null>(null);

export function MerchantRuntimeDataProviders({
  shell,
  settings,
  children,
}: {
  shell: MerchantShellContextValue;
  settings: MerchantSettingsContextValue;
  children: ReactNode;
}) {
  return (
    <MerchantShellContext.Provider value={shell}>
      <MerchantSettingsContext.Provider value={settings}>
        {children}
      </MerchantSettingsContext.Provider>
    </MerchantShellContext.Provider>
  );
}

export function MerchantRuntimeControlProvider({
  value,
  children,
}: {
  value: MerchantRuntimeControlValue;
  children: ReactNode;
}) {
  return (
    <MerchantRuntimeControlContext.Provider value={value}>
      {children}
    </MerchantRuntimeControlContext.Provider>
  );
}

export function useMerchantShell(): MerchantShellContextValue {
  const context = useContext(MerchantShellContext);
  if (!context) throw new Error("useMerchantShell must be used inside the merchant runtime boundary");
  return context;
}

export function useMerchantSettings(): MerchantSettingsContextValue {
  const context = useContext(MerchantSettingsContext);
  if (!context) throw new Error("useMerchantSettings must be used inside the merchant runtime boundary");
  return context;
}

export function useMerchantRuntime(): MerchantRuntimeControlValue {
  const context = useContext(MerchantRuntimeControlContext);
  if (!context) throw new Error("useMerchantRuntime must be used inside the merchant runtime boundary");
  return context;
}
