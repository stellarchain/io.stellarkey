import { emptyStore } from "./defaults";
import type { MerchantStore } from "./types";

/**
 * Merchant data lives under the app's existing `wallet.` prefix, so the wallet's
 * own reset (`wipeVault`) already removes it — a shop that resets its wallet does
 * not leave its takings behind.
 *
 * Nothing here is secret: an order is a record of a public ledger payment plus
 * the shop's own line items. Keys stay in the vault, and a till never needs one.
 */
const KEY = "wallet.merchant.v1";

/** Orders and charges older than this are pruned so the store cannot grow forever. */
const RETAIN_DAYS = 400;

function isStore(value: unknown): value is MerchantStore {
  if (!value || typeof value !== "object") return false;
  const store = value as Partial<MerchantStore>;
  return (
    store.version === 1 &&
    typeof store.settings === "object" &&
    Array.isArray(store.catalogue) &&
    Array.isArray(store.orders) &&
    Array.isArray(store.charges)
  );
}

/** Fills in anything a older build did not write, so a partial store still loads. */
function reconcile(store: MerchantStore): MerchantStore {
  const base = emptyStore();
  return {
    ...base,
    ...store,
    settings: { ...base.settings, ...store.settings },
    modifierGroups: store.modifierGroups ?? base.modifierGroups,
    refunds: store.refunds ?? [],
    unmatched: store.unmatched ?? [],
    cursors: store.cursors ?? {},
  };
}

export function loadMerchantStore(): MerchantStore {
  if (typeof window === "undefined") return emptyStore();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return emptyStore();
    const parsed: unknown = JSON.parse(raw);
    if (!isStore(parsed)) return emptyStore();
    return reconcile(parsed);
  } catch {
    // A corrupted store must not brick the wallet; the shop reconfigures instead.
    return emptyStore();
  }
}

export function saveMerchantStore(store: MerchantStore): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(prune(store)));
  } catch {
    // Quota exhausted — drop the oldest history and try once more.
    try {
      window.localStorage.setItem(KEY, JSON.stringify(prune(store, 30)));
    } catch {
      // Still no room. The in-memory store stays correct for this session.
    }
  }
}

/** Drops history beyond the retention window, keeping anything still open. */
export function prune(store: MerchantStore, retainDays = RETAIN_DAYS): MerchantStore {
  const cutoff = Date.now() - retainDays * 24 * 60 * 60 * 1000;
  const orders = store.orders.filter((o) => o.createdAt >= cutoff || o.status === "open");
  const kept = new Set(orders.map((o) => o.id));
  return {
    ...store,
    orders,
    charges: store.charges.filter(
      (c) => kept.has(c.orderId) || c.status === "awaiting",
    ),
    refunds: store.refunds.filter((r) => kept.has(r.orderId)),
    unmatched: store.unmatched.filter((p) => p.seenAt >= cutoff),
  };
}

export function clearMerchantStore(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
}

export const MERCHANT_STORAGE_KEY = KEY;
