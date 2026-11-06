import type { MerchantSub } from "../merchant/MerchantPage";
import type { PrivateBalanceRuntimePhase } from "@/hooks/usePrivateBalanceRuntime";

export type View =
  | "home"
  | "activity"
  | "swap"
  | "contacts"
  | "settings"
  | "merchant"
  | "orders"
  | "catalogue"
  | "invoices"
  | "links"
  | "customers"
  | "insights";

/** The views Merchant Mode owns; everything else is the wallet's. */
export const MERCHANT_VIEWS = [
  "merchant",
  "orders",
  "catalogue",
  "invoices",
  "links",
  "customers",
  "insights",
] as const satisfies readonly View[];

export function isMerchantView(view: View): boolean {
  return (MERCHANT_VIEWS as readonly View[]).includes(view);
}

/** The till is the shell's "merchant" view; every other merchant view is its own sub. */
export function merchantSubForView(view: View): MerchantSub {
  return view === "merchant" || !isMerchantView(view) ? "pos" : (view as MerchantSub);
}

export function viewForMerchantSub(sub: MerchantSub): View {
  return sub === "pos" ? "merchant" : sub;
}

/** Window-header title. Merchant views name themselves rather than slugging. */
export function desktopViewTitle(view: View): string {
  switch (view) {
    case "home":
      return "Wallet Overview";
    case "swap":
      return "In-App DEX Swap";
    case "contacts":
      return "Contacts";
    case "merchant":
      return "Point of Sale";
    case "orders":
      return "Orders";
    case "catalogue":
      return "Catalogue";
    case "invoices":
      return "Invoices";
    case "links":
      return "Counter codes";
    case "customers":
      return "Customers";
    case "insights":
      return "Insights";
    default:
      return view.charAt(0).toUpperCase() + view.slice(1);
  }
}

export function mobileViewTitle(view: View): string {
  switch (view) {
    case "home":
      return "Wallet";
    case "merchant":
      return "Point of Sale";
    case "orders":
      return "Orders";
    case "catalogue":
      return "Catalogue";
    case "invoices":
      return "Invoices";
    case "links":
      return "Counter codes";
    case "customers":
      return "Customers";
    case "insights":
      return "Insights";
    default:
      return view.charAt(0).toUpperCase() + view.slice(1);
  }
}

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}
export type ActivityFilter = "all" | "in" | "out" | "swap" | "trust";

export function privateWithdrawOpeningLabel(
  phase: PrivateBalanceRuntimePhase,
  syncProgress: { current: bigint; total: bigint } | null,
): string {
  switch (phase) {
    case "loading-artifacts":
      return "Loading the private wallet";
    case "reading-meta":
      return "Opening the encrypted balance";
    case "scanning-live":
      return syncProgress
        ? `Checking private payment ${syncProgress.current} of ${syncProgress.total}`
        : "Checking recent private activity";
    case "current":
      return "Finishing up";
    case "locked":
      return "Unlock StellarKey to continue";
    case "safe-error":
      return "Private balance needs attention";
    case "status-unknown":
      return "Waiting for independent network checks";
    case "disabled":
    default:
      return "Starting the private wallet";
  }
}

export function assetHue(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 33 + key.charCodeAt(i)) >>> 0;
  return hash % 360;
}
