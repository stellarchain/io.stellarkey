export const MERCHANT_BOOTSTRAP_STORAGE_KEY = "stellarkey.merchant-bootstrap.v1";
export const MERCHANT_BOOTSTRAP_CHANGED_EVENT = "stellarkey:merchant-bootstrap-changed";

export interface MerchantBootstrapState {
  version: 1;
  enabled: boolean;
  configured: boolean;
}

/**
 * Keep Merchant navigation stable while its encrypted store is opening. The
 * public hint may preserve shell visibility only during hydration; once the
 * archive has been read, its authenticated setting is authoritative.
 */
export function merchantShellEnabled({
  ready,
  encryptedEnabled,
  enabledHint,
}: {
  ready: boolean;
  encryptedEnabled: boolean;
  enabledHint: boolean;
}): boolean {
  return ready ? encryptedEnabled : enabledHint;
}

interface BootstrapStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStorage(): BootstrapStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Invalid or missing hints are unknown, never silently treated as disabled. */
export function readMerchantBootstrapState(
  storage: BootstrapStorage | null = browserStorage(),
): MerchantBootstrapState | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(MERCHANT_BOOTSTRAP_STORAGE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (
      !value ||
      typeof value !== "object" ||
      !("version" in value) ||
      value.version !== 1 ||
      !("enabled" in value) ||
      typeof value.enabled !== "boolean" ||
      !("configured" in value) ||
      typeof value.configured !== "boolean"
    ) {
      return null;
    }
    return { version: 1, enabled: value.enabled, configured: value.configured };
  } catch {
    return null;
  }
}

/**
 * Publish only feature-state booleans. The encrypted merchant archive remains
 * authoritative; failure here may load extra code later but cannot hide data.
 */
export function writeMerchantBootstrapState(
  state: Pick<MerchantBootstrapState, "enabled" | "configured">,
  storage: BootstrapStorage | null = browserStorage(),
): boolean {
  if (!storage) return false;
  const value: MerchantBootstrapState = { version: 1, ...state };
  const raw = JSON.stringify(value);
  try {
    storage.setItem(MERCHANT_BOOTSTRAP_STORAGE_KEY, raw);
    if (storage.getItem(MERCHANT_BOOTSTRAP_STORAGE_KEY) !== raw) return false;
  } catch {
    return false;
  }
  if (
    typeof window !== "undefined" &&
    storage === window.localStorage &&
    typeof window.dispatchEvent === "function" &&
    typeof Event === "function"
  ) {
    window.dispatchEvent(new Event(MERCHANT_BOOTSTRAP_CHANGED_EVENT));
  }
  return true;
}
