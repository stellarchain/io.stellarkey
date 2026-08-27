export const BACKUP_HEALTH_KEY = "wallet.backup-health.v1";
export const BACKUP_HEALTH_CHANGED_EVENT = "wallet:backup-health-changed";

export interface BackupHealth {
  version: 1;
  lastExportedAt: string | null;
  lastVerifiedAt: string | null;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function loadBackupHealth(): BackupHealth | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(BACKUP_HEALTH_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<BackupHealth>;
    if (value.version !== 1) return null;
    if (value.lastExportedAt !== null && !isTimestamp(value.lastExportedAt)) return null;
    if (value.lastVerifiedAt !== null && !isTimestamp(value.lastVerifiedAt)) return null;
    return {
      version: 1,
      lastExportedAt: value.lastExportedAt,
      lastVerifiedAt: value.lastVerifiedAt,
    };
  } catch {
    return null;
  }
}

function persistBackupHealth(health: BackupHealth): void {
  window.localStorage.setItem(BACKUP_HEALTH_KEY, JSON.stringify(health));
  if (typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new Event(BACKUP_HEALTH_CHANGED_EVENT));
  }
}

export function markBackupExported(at = new Date().toISOString()): BackupHealth {
  if (!isTimestamp(at)) throw new Error("Backup export time is invalid.");
  const current = loadBackupHealth();
  const next: BackupHealth = {
    version: 1,
    lastExportedAt: at,
    lastVerifiedAt: current?.lastVerifiedAt ?? null,
  };
  persistBackupHealth(next);
  return next;
}

export function markBackupVerified(at = new Date().toISOString()): BackupHealth {
  if (!isTimestamp(at)) throw new Error("Backup verification time is invalid.");
  const current = loadBackupHealth();
  const next: BackupHealth = {
    version: 1,
    lastExportedAt: current?.lastExportedAt ?? null,
    lastVerifiedAt: at,
  };
  persistBackupHealth(next);
  return next;
}
