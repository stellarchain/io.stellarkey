export type NetworkKey = "testnet" | "mainnet";

export interface NetworkConfig {
  id: NetworkKey;
  label: string;
  horizonUrl: string;
  rpcUrl: string | null;
  networkPassphrase: string;
  friendbotUrl: string | null;
  explorerTxUrl: (hash: string) => string;
  explorerAccountUrl: (pk: string) => string;
}

export const NETWORKS: Record<NetworkKey, NetworkConfig> = {
  testnet: {
    id: "testnet",
    label: "Testnet",
    horizonUrl: "https://horizon-testnet.stellar.org",
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
    friendbotUrl: "https://friendbot.stellar.org",
    explorerTxUrl: (hash) => `https://testnet.stellarchain.io/tx/${hash}`,
    explorerAccountUrl: (pk) => `https://testnet.stellarchain.io/address/${pk}`,
  },
  mainnet: {
    id: "mainnet",
    label: "Mainnet",
    horizonUrl: "https://horizon.stellar.org",
    rpcUrl: null,
    networkPassphrase: "Public Global Stellar Network ; September 2015",
    friendbotUrl: null,
    explorerTxUrl: (hash) => `https://stellarchain.io/tx/${hash}`,
    explorerAccountUrl: (pk) => `https://stellarchain.io/address/${pk}`,
  },
};

export const BASE_RESERVE_XLM = 0.5;

export function loadCustomHorizon(network: NetworkKey): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(`wallet.horizon.${network}.v1`);
}

export function saveCustomHorizon(network: NetworkKey, url: string | null): void {
  if (typeof window === "undefined") return;
  if (!url || !url.trim()) {
    window.localStorage.removeItem(`wallet.horizon.${network}.v1`);
  } else {
    window.localStorage.setItem(`wallet.horizon.${network}.v1`, url.trim());
  }
}

export function getHorizonUrl(network: NetworkKey): string {
  const custom = loadCustomHorizon(network);
  if (custom && custom.trim().startsWith("http")) return custom.trim();
  return NETWORKS[network].horizonUrl;
}

export async function testHorizonPing(
  url: string,
): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = performance.now();
  try {
    const res = await fetch(url.replace(/\/+$/, "") + "/", { method: "GET" });
    const latencyMs = Math.round(performance.now() - start);
    if (!res.ok) return { ok: false, latencyMs, error: `HTTP ${res.status}` };
    return { ok: true, latencyMs };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - start);
    return {
      ok: false,
      latencyMs,
      error: err instanceof Error ? err.message : "Connection failed",
    };
  }
}
