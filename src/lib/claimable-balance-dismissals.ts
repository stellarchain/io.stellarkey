import type { NetworkKey } from "./stellar";

export const CLAIMABLE_BALANCE_DISMISSALS_KEY =
  "stellarkey.claimable-balance-dismissals.v1";

const CLAIMABLE_BALANCE_ID_PATTERN = /^00000000[0-9a-f]{64}$/;
const ACCOUNT_PATTERN = /^G[A-Z2-7]{55}$/;
const MAX_SCOPES = 50;
const MAX_IDS_PER_SCOPE = 1_000;

interface DismissalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface ClaimableBalanceDismissalStore {
  version: 1;
  scopes: Record<string, string[]>;
}

function emptyStore(): ClaimableBalanceDismissalStore {
  return { version: 1, scopes: {} };
}

function scopeKey(network: NetworkKey, account: string): string {
  if (!ACCOUNT_PATTERN.test(account)) throw new Error("Invalid Stellar account for dismissals.");
  return `${network}:${account}`;
}

function normalizeBalanceId(balanceId: string): string {
  const normalized = balanceId.trim().toLowerCase();
  if (!CLAIMABLE_BALANCE_ID_PATTERN.test(normalized)) {
    throw new Error("Invalid claimable balance ID.");
  }
  return normalized;
}

function readStore(storage: DismissalStorage): ClaimableBalanceDismissalStore {
  let parsed: unknown;
  try {
    const raw = storage.getItem(CLAIMABLE_BALANCE_DISMISSALS_KEY);
    if (raw === null) return emptyStore();
    parsed = JSON.parse(raw);
  } catch {
    return emptyStore();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return emptyStore();
  const candidate = parsed as { version?: unknown; scopes?: unknown };
  if (
    candidate.version !== 1 ||
    !candidate.scopes ||
    typeof candidate.scopes !== "object" ||
    Array.isArray(candidate.scopes)
  ) {
    return emptyStore();
  }

  const scopes: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(candidate.scopes).slice(0, MAX_SCOPES)) {
    if (!/^(?:mainnet|testnet):G[A-Z2-7]{55}$/.test(key) || !Array.isArray(value)) continue;
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const entry of value) {
      if (typeof entry !== "string") continue;
      const normalized = entry.trim().toLowerCase();
      if (!CLAIMABLE_BALANCE_ID_PATTERN.test(normalized) || seen.has(normalized)) continue;
      seen.add(normalized);
      ids.push(normalized);
      if (ids.length === MAX_IDS_PER_SCOPE) break;
    }
    if (ids.length > 0) scopes[key] = ids;
  }
  return { version: 1, scopes };
}

function writeStore(storage: DismissalStorage, store: ClaimableBalanceDismissalStore): void {
  const serialized = JSON.stringify(store);
  storage.setItem(CLAIMABLE_BALANCE_DISMISSALS_KEY, serialized);
  if (storage.getItem(CLAIMABLE_BALANCE_DISMISSALS_KEY) !== serialized) {
    throw new Error("Browser storage did not retain the dismissed balances.");
  }
}

export function loadDismissedClaimableBalanceIds(
  storage: DismissalStorage,
  network: NetworkKey,
  account: string,
): string[] {
  return [...(readStore(storage).scopes[scopeKey(network, account)] ?? [])];
}

export function dismissClaimableBalance(
  storage: DismissalStorage,
  network: NetworkKey,
  account: string,
  balanceId: string,
): void {
  const key = scopeKey(network, account);
  const normalized = normalizeBalanceId(balanceId);
  const store = readStore(storage);
  const current = store.scopes[key] ?? [];
  if (current.includes(normalized)) return;

  if (!(key in store.scopes) && Object.keys(store.scopes).length >= MAX_SCOPES) {
    const oldestScope = Object.keys(store.scopes)[0];
    if (oldestScope) delete store.scopes[oldestScope];
  }
  store.scopes[key] = [...current, normalized].slice(-MAX_IDS_PER_SCOPE);
  writeStore(storage, store);
}

export function restoreClaimableBalance(
  storage: DismissalStorage,
  network: NetworkKey,
  account: string,
  balanceId: string,
): void {
  const key = scopeKey(network, account);
  const normalized = normalizeBalanceId(balanceId);
  const store = readStore(storage);
  const next = (store.scopes[key] ?? []).filter((id) => id !== normalized);
  if (next.length > 0) store.scopes[key] = next;
  else delete store.scopes[key];
  writeStore(storage, store);
}
