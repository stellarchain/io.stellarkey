export type WalletSignalType = "wallet-lock" | "wallet-reset";

export interface WalletSignal {
  type: WalletSignalType;
  senderId: string;
  nonce: string;
}

export interface WalletCoordination {
  post(type: WalletSignalType): void;
  close(): void;
}

const CHANNEL_NAME = "stellarkey.wallet.coordination.v1";
const STORAGE_SIGNAL_KEY = "stellarkey.wallet.coordination-signal.v1";

export function createTabSenderId(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function decodeWalletSignal(raw: string): WalletSignal | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const signal = value as Partial<WalletSignal>;
    if (signal.type !== "wallet-lock" && signal.type !== "wallet-reset") return null;
    if (typeof signal.senderId !== "string" || !signal.senderId) return null;
    if (typeof signal.nonce !== "string" || !signal.nonce) return null;
    return signal as WalletSignal;
  } catch {
    return null;
  }
}

export function openWalletCoordination(
  senderId: string,
  onSignal: (signal: WalletSignal) => void,
): WalletCoordination {
  const deliver = (signal: WalletSignal | null) => {
    if (signal && signal.senderId !== senderId) onSignal(signal);
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_SIGNAL_KEY && event.newValue) {
      deliver(decodeWalletSignal(event.newValue));
    }
  };
  window.addEventListener("storage", onStorage);

  let channel: BroadcastChannel | null = null;
  const onMessage = (event: MessageEvent<unknown>) => {
    try {
      deliver(decodeWalletSignal(JSON.stringify(event.data)));
    } catch {
      // Ignore values that cannot be represented as JSON.
    }
  };
  try {
    if (typeof window.BroadcastChannel !== "undefined") {
      channel = new window.BroadcastChannel(CHANNEL_NAME);
      channel.addEventListener("message", onMessage);
    }
  } catch {
    channel = null;
  }

  return {
    post: (type) => {
      const signal: WalletSignal = {
        type,
        senderId,
        nonce: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
      };
      channel?.postMessage(signal);
      try {
        window.localStorage.setItem(STORAGE_SIGNAL_KEY, JSON.stringify(signal));
        window.localStorage.removeItem(STORAGE_SIGNAL_KEY);
      } catch {
        // BroadcastChannel remains available when local storage is restricted.
      }
    },
    close: () => {
      window.removeEventListener("storage", onStorage);
      if (channel) {
        channel.removeEventListener("message", onMessage);
        channel.close();
      }
    },
  };
}
