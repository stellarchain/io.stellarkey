import type { MerchantStore } from "./types";

const WATCHER_LEASE_PREFIX = "stellarkey.merchant.watcher-lease.v1";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface WatcherLease {
  ownerId: string;
  expiresAt: number;
}

export class MerchantRevisionConflictError extends Error {
  constructor() {
    super("Merchant data changed in another tab. The newer version has been loaded; try again.");
    this.name = "MerchantRevisionConflictError";
  }
}

export function createMerchantWriterId(): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) return randomId;
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function prepareMerchantCommit({
  current,
  candidate,
  persisted,
  writerId,
  now = Date.now(),
}: {
  current: MerchantStore;
  candidate: MerchantStore;
  persisted: MerchantStore | null;
  writerId: string;
  now?: number;
}): MerchantStore {
  const persistedRevision = persisted?.revision ?? 0;
  if (persistedRevision !== current.revision) throw new MerchantRevisionConflictError();
  return {
    ...candidate,
    revision: current.revision + 1,
    writerId,
    updatedAt: now,
  };
}

export function newerMerchantStore(
  current: MerchantStore,
  incoming: MerchantStore,
): MerchantStore | null {
  return incoming.revision > current.revision ? incoming : null;
}

export function watcherLeaseKey(network: string, publicKey: string): string {
  return `${WATCHER_LEASE_PREFIX}:${network}:${publicKey}`;
}

function readLease(storage: StorageLike, key: string): WatcherLease | null {
  const raw = storage.getItem(key);
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const lease = value as Partial<WatcherLease>;
    if (typeof lease.ownerId !== "string" || !Number.isFinite(lease.expiresAt)) return null;
    return { ownerId: lease.ownerId, expiresAt: lease.expiresAt as number };
  } catch {
    return null;
  }
}

export function claimWatcherLease(
  storage: StorageLike,
  key: string,
  ownerId: string,
  now: number,
  ttlMs: number,
): boolean {
  const current = readLease(storage, key);
  if (current && current.ownerId !== ownerId && current.expiresAt > now) return false;
  const desired: WatcherLease = { ownerId, expiresAt: now + ttlMs };
  try {
    storage.setItem(key, JSON.stringify(desired));
    const confirmed = readLease(storage, key);
    return confirmed?.ownerId === ownerId && confirmed.expiresAt === desired.expiresAt;
  } catch {
    return false;
  }
}

export function releaseWatcherLease(
  storage: StorageLike,
  key: string,
  ownerId: string,
): boolean {
  const current = readLease(storage, key);
  if (!current || current.ownerId !== ownerId) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export interface MerchantRevisionChannel {
  postRevision(store: MerchantStore): void;
  close(): void;
}

export function openMerchantRevisionChannel(
  onRevision: () => void,
): MerchantRevisionChannel {
  if (typeof window === "undefined" || typeof window.BroadcastChannel === "undefined") {
    return { postRevision: () => {}, close: () => {} };
  }
  try {
    const channel = new window.BroadcastChannel("stellarkey.merchant.revisions.v1");
    channel.addEventListener("message", onRevision);
    return {
      postRevision: (store) => {
        channel.postMessage({ revision: store.revision, writerId: store.writerId });
      },
      close: () => {
        channel.removeEventListener("message", onRevision);
        channel.close();
      },
    };
  } catch {
    return { postRevision: () => {}, close: () => {} };
  }
}
