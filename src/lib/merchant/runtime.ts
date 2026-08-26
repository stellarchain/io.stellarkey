import type { NetworkKey } from "@/lib/stellar";
import type { CatalogueItem, Charge, Peripheral } from "./types";

export const BROWSER_PERIPHERALS: readonly Peripheral[] = [
  {
    id: "system-print",
    kind: "printer",
    name: "System print / AirPrint",
    connected: true,
    detail: "Browser print dialog · AirPrint when iOS offers it",
  },
  {
    id: "escpos-printer",
    kind: "printer",
    name: "Direct thermal printer",
    connected: false,
    detail: "ESC/POS bridge not installed",
    unavailable: true,
  },
  {
    id: "cash-drawer",
    kind: "drawer",
    name: "Cash drawer",
    connected: false,
    detail: "Requires a supported printer bridge",
    unavailable: true,
  },
  {
    id: "keyboard-scanner",
    kind: "scanner",
    name: "Keyboard barcode scanner",
    connected: true,
    detail: "USB or Bluetooth HID · SKU plus Enter",
  },
  {
    id: "same-device-display",
    kind: "display",
    name: "Same-device display",
    connected: true,
    detail: "Full-screen total with staff-PIN exit",
  },
  {
    id: "external-display",
    kind: "display",
    name: "External customer display",
    connected: false,
    detail: "A paired-screen sync bridge is not installed",
    unavailable: true,
  },
] as const;

export interface MerchantRuntimeInput {
  online: boolean;
  vaultPhase: string;
  watchError: string | null;
  charges: Charge[];
  network: NetworkKey;
  now: number;
}

export interface MerchantRuntimeState {
  connection: "online" | "offline" | "watch_error";
  vaultLocked: boolean;
  queuedChargeCount: number;
  expiredChargeCount: number;
}

/** Live device facts. None of these values is persisted as hardware state. */
export function merchantRuntimeState(input: MerchantRuntimeInput): MerchantRuntimeState {
  let queuedChargeCount = 0;
  let expiredChargeCount = 0;

  for (const charge of input.charges) {
    if (charge.network !== input.network) continue;
    if (charge.status === "expired" || (charge.status === "awaiting" && charge.expiresAt <= input.now)) {
      expiredChargeCount += 1;
    } else if (charge.status === "awaiting") {
      queuedChargeCount += 1;
    }
  }

  return {
    connection: !input.online ? "offline" : input.watchError ? "watch_error" : "online",
    vaultLocked: input.vaultPhase === "locked",
    queuedChargeCount,
    expiredChargeCount,
  };
}

/** HID scanners type a catalogue SKU and terminate it with Enter. */
export function findScannedCatalogueItem(
  catalogue: CatalogueItem[],
  rawCode: string,
): CatalogueItem | null {
  const code = rawCode.trim().toLocaleLowerCase();
  if (!code) return null;
  return (
    catalogue.find(
      (item) => item.active && item.sku.trim().toLocaleLowerCase() === code,
    ) ?? null
  );
}
