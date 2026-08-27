export type StoragePersistence = "persistent" | "best-effort" | "unavailable";

export interface StorageHealth {
  persistence: StoragePersistence;
  usage: number | null;
  quota: number | null;
  usageRatio: number | null;
}

interface StorageManagerLike {
  persisted?: () => Promise<boolean>;
  persist?: () => Promise<boolean>;
  estimate?: () => Promise<{ usage?: number; quota?: number }>;
}

export async function inspectStorageHealth(
  manager: StorageManagerLike | undefined =
    typeof navigator === "undefined" ? undefined : navigator.storage,
): Promise<StorageHealth> {
  if (!manager) {
    return { persistence: "unavailable", usage: null, quota: null, usageRatio: null };
  }
  const [persistent, estimate]: [boolean, { usage?: number; quota?: number }] = await Promise.all([
    manager.persisted?.().catch(() => false) ?? Promise.resolve(false),
    manager.estimate?.().catch(() => ({ usage: undefined, quota: undefined })) ??
      Promise.resolve({ usage: undefined, quota: undefined }),
  ]);
  const usage = typeof estimate.usage === "number" && Number.isFinite(estimate.usage)
    ? estimate.usage
    : null;
  const quota = typeof estimate.quota === "number" && Number.isFinite(estimate.quota)
    ? estimate.quota
    : null;
  return {
    persistence: persistent ? "persistent" : "best-effort",
    usage,
    quota,
    usageRatio: usage !== null && quota !== null && quota > 0 ? usage / quota : null,
  };
}

export async function requestPersistentStorage(
  manager: StorageManagerLike | undefined =
    typeof navigator === "undefined" ? undefined : navigator.storage,
): Promise<boolean> {
  if (!manager?.persist) return false;
  try {
    return await manager.persist();
  } catch {
    return false;
  }
}
