export type ShellMode = "wallet" | "merchant";

export const SHELL_MODE_STORAGE_KEY = "stellarkey.shell-mode.v1";
export const SHELL_MODE_CHANGED_EVENT = "stellarkey:shell-mode-changed";

interface ShellModeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStorage(): ShellModeStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readShellMode(
  storage: ShellModeStorage | null = browserStorage(),
): ShellMode {
  if (!storage) return "wallet";
  try {
    return storage.getItem(SHELL_MODE_STORAGE_KEY) === "merchant" ? "merchant" : "wallet";
  } catch {
    return "wallet";
  }
}

export function writeShellMode(
  mode: ShellMode,
  storage: ShellModeStorage | null = browserStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(SHELL_MODE_STORAGE_KEY, mode);
    if (storage.getItem(SHELL_MODE_STORAGE_KEY) !== mode) return false;
    if (
      typeof window !== "undefined" &&
      storage === window.localStorage &&
      typeof window.dispatchEvent === "function"
    ) {
      window.dispatchEvent(new Event(SHELL_MODE_CHANGED_EVENT));
    }
    return true;
  } catch {
    return false;
  }
}

export function subscribeShellMode(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === SHELL_MODE_STORAGE_KEY) onChange();
  };
  window.addEventListener(SHELL_MODE_CHANGED_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(SHELL_MODE_CHANGED_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}
