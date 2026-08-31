import { getHorizonJson } from "./horizon";
import { NETWORKS, type NetworkKey } from "./stellar";

export type StellarEndpointKind = "horizon" | "rpc";

export interface EndpointStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface EndpointHealth {
  ok: true;
  kind: StellarEndpointKind;
  url: string;
  network: NetworkKey;
  latencyMs: number;
  latestLedger?: number;
  protocolVersion?: number;
}

export interface EndpointTestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  now?: () => number;
}

export const STELLAR_ENDPOINTS_CHANGED_EVENT = "wallet:stellar-endpoints-changed";

const ENDPOINT_KEY_PREFIX = "wallet.endpoint";

function browserStorage(): EndpointStorage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

function endpointKey(network: NetworkKey, kind: StellarEndpointKind): string {
  return `${ENDPOINT_KEY_PREFIX}.${kind}.${network}.v1`;
}

export function normalizeStellarEndpointUrl(value: string): string {
  const trimmed = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Enter a valid HTTPS endpoint URL.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Custom Stellar endpoints must use HTTPS.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Endpoint URLs cannot contain embedded credentials.");
  }
  if (parsed.hash) {
    throw new Error("Endpoint URLs cannot contain a fragment.");
  }
  if (parsed.href.length > 2_048) {
    throw new Error("Endpoint URL is too long.");
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString().replace(/\/$/, "");
}

export function loadCustomEndpoint(
  network: NetworkKey,
  kind: StellarEndpointKind,
  storage: EndpointStorage | null = browserStorage(),
): string | null {
  if (!storage) return null;
  const stored = storage.getItem(endpointKey(network, kind));
  if (!stored) return null;
  try {
    return normalizeStellarEndpointUrl(stored);
  } catch {
    return null;
  }
}

export function saveCustomEndpoint(
  network: NetworkKey,
  kind: StellarEndpointKind,
  value: string | null,
  storage: EndpointStorage | null = browserStorage(),
): void {
  if (!storage) return;
  const key = endpointKey(network, kind);
  const previous = storage.getItem(key);
  const normalized = value === null || !value.trim()
    ? null
    : normalizeStellarEndpointUrl(value);
  try {
    if (normalized === null) storage.removeItem(key);
    else storage.setItem(key, normalized);
    if (storage.getItem(key) !== normalized) {
      throw new Error("Browser storage did not retain the endpoint preference.");
    }
  } catch (error) {
    try {
      if (previous === null) storage.removeItem(key);
      else storage.setItem(key, previous);
    } catch {
      throw new Error("Endpoint preference failed and browser storage could not be rolled back.");
    }
    throw error;
  }
  if (typeof window !== "undefined" && storage === window.localStorage) {
    window.dispatchEvent(new CustomEvent(STELLAR_ENDPOINTS_CHANGED_EVENT, {
      detail: { network, kind },
    }));
  }
}

export function resetCustomEndpoints(
  network: NetworkKey,
  storage: EndpointStorage | null = browserStorage(),
): void {
  if (!storage) return;
  const keys = [
    endpointKey(network, "horizon"),
    endpointKey(network, "rpc"),
  ];
  const previous = new Map(keys.map((key) => [key, storage.getItem(key)]));
  try {
    for (const key of keys) storage.removeItem(key);
    if (keys.some((key) => storage.getItem(key) !== null)) {
      throw new Error("Browser storage did not reset the endpoint preferences.");
    }
  } catch (error) {
    try {
      for (const [key, value] of previous) {
        if (value === null) storage.removeItem(key);
        else storage.setItem(key, value);
      }
    } catch {
      throw new Error("Endpoint reset failed and browser storage could not be rolled back.");
    }
    throw error;
  }
  if (typeof window !== "undefined" && storage === window.localStorage) {
    window.dispatchEvent(new CustomEvent(STELLAR_ENDPOINTS_CHANGED_EVENT, {
      detail: { network, kind: "all" },
    }));
  }
}

export function getHorizonUrl(
  network: NetworkKey,
  storage: EndpointStorage | null = browserStorage(),
): string {
  return loadCustomEndpoint(network, "horizon", storage) ?? NETWORKS[network].horizonUrl;
}

/**
 * Account activity deliberately uses SDF's public Horizon history service.
 * Custom endpoints remain available for operational reads and submissions,
 * but must not silently change the source or retention behavior of history.
 */
export function getAccountHistoryHorizonUrl(network: NetworkKey): string {
  return NETWORKS[network].horizonUrl;
}

export function getRpcUrl(
  network: NetworkKey,
  storage: EndpointStorage | null = browserStorage(),
): string | null {
  return loadCustomEndpoint(network, "rpc", storage) ?? NETWORKS[network].rpcUrl;
}

function networkForPassphrase(passphrase: string): NetworkKey | null {
  if (passphrase === NETWORKS.testnet.networkPassphrase) return "testnet";
  if (passphrase === NETWORKS.mainnet.networkPassphrase) return "mainnet";
  return null;
}

function assertExpectedNetwork(passphrase: unknown, expected: NetworkKey): void {
  if (typeof passphrase !== "string") {
    throw new Error("The endpoint did not report its Stellar network passphrase.");
  }
  if (passphrase === NETWORKS[expected].networkPassphrase) return;
  const actual = networkForPassphrase(passphrase);
  if (actual) {
    throw new Error(
      `This endpoint serves ${NETWORKS[actual].label}, but you selected ${NETWORKS[expected].label}.`,
    );
  }
  throw new Error("The endpoint serves an unknown Stellar network.");
}

export async function testHorizonEndpoint(
  network: NetworkKey,
  value: string,
  options: EndpointTestOptions = {},
): Promise<EndpointHealth> {
  const url = normalizeStellarEndpointUrl(value);
  const now = options.now ?? (() => performance.now());
  const startedAt = now();
  const root = await getHorizonJson<{
    network_passphrase?: unknown;
    history_latest_ledger?: unknown;
    core_latest_ledger?: unknown;
  }>(url, { signal: options.signal }, options.timeoutMs ?? 8_000);
  assertExpectedNetwork(root.network_passphrase, network);
  const ledger = root.history_latest_ledger ?? root.core_latest_ledger;
  const latestLedger = typeof ledger === "number" && Number.isSafeInteger(ledger) && ledger >= 0
    ? ledger
    : undefined;
  return {
    ok: true,
    kind: "horizon",
    url,
    network,
    latencyMs: Math.max(0, Math.round(now() - startedAt)),
    ...(latestLedger === undefined ? {} : { latestLedger }),
  };
}

export async function testRpcEndpoint(
  network: NetworkKey,
  value: string,
  options: EndpointTestOptions = {},
): Promise<EndpointHealth> {
  const url = normalizeStellarEndpointUrl(value);
  const now = options.now ?? (() => performance.now());
  const startedAt = now();
  const id = Math.floor(startedAt) || 1;
  let response: {
    jsonrpc?: unknown;
    id?: unknown;
    result?: { passphrase?: unknown; protocolVersion?: unknown };
    error?: unknown;
  };
  try {
    response = await getHorizonJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method: "getNetwork" }),
      signal: options.signal,
    }, options.timeoutMs ?? 8_000);
  } catch (cause) {
    throw new Error(
      `RPC endpoint could not be verified: ${cause instanceof Error ? cause.message : "request failed"}`,
    );
  }
  if (response.jsonrpc !== "2.0" || response.id !== id || !response.result || response.error) {
    throw new Error("The RPC endpoint returned an invalid getNetwork response.");
  }
  assertExpectedNetwork(response.result.passphrase, network);
  const protocol = response.result.protocolVersion;
  const protocolVersion = typeof protocol === "number" && Number.isSafeInteger(protocol) && protocol > 0
    ? protocol
    : undefined;
  return {
    ok: true,
    kind: "rpc",
    url,
    network,
    latencyMs: Math.max(0, Math.round(now() - startedAt)),
    ...(protocolVersion === undefined ? {} : { protocolVersion }),
  };
}
