import { backupVaultIdentity } from "./vault";

export const BACKUP_HEALTH_KEY = "wallet.backup-health.v1";
export const BACKUP_HEALTH_CHANGED_EVENT = "wallet:backup-health-changed";

export interface BackupHealth {
  version: 2;
  vaultId: string;
  lastExportedAt: string | null;
  lastVerifiedAt: string | null;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function loadBackupHealth(vaultId = backupVaultIdentity()): BackupHealth | null {
  if (typeof window === "undefined") return null;
  if (!vaultId || !/^[0-9a-f]{64}$/.test(vaultId)) return null;
  try {
    const raw = window.localStorage.getItem(BACKUP_HEALTH_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<BackupHealth>;
    if (value.version !== 2 || value.vaultId !== vaultId) return null;
    if (value.lastExportedAt !== null && !isTimestamp(value.lastExportedAt)) return null;
    if (value.lastVerifiedAt !== null && !isTimestamp(value.lastVerifiedAt)) return null;
    return {
      version: 2,
      vaultId,
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

export function markBackupExported(
  at = new Date().toISOString(),
  vaultId = backupVaultIdentity(),
): BackupHealth {
  if (!isTimestamp(at)) throw new Error("Backup export time is invalid.");
  if (!vaultId || !/^[0-9a-f]{64}$/.test(vaultId)) throw new Error("Wallet backup identity is unavailable.");
  const current = loadBackupHealth(vaultId);
  const next: BackupHealth = {
    version: 2,
    vaultId,
    lastExportedAt: at,
    lastVerifiedAt: current?.lastVerifiedAt ?? null,
  };
  persistBackupHealth(next);
  return next;
}

export function markBackupVerified(
  at = new Date().toISOString(),
  vaultId = backupVaultIdentity(),
): BackupHealth {
  if (!isTimestamp(at)) throw new Error("Backup verification time is invalid.");
  if (!vaultId || !/^[0-9a-f]{64}$/.test(vaultId)) throw new Error("Wallet backup identity is unavailable.");
  const current = loadBackupHealth(vaultId);
  const next: BackupHealth = {
    version: 2,
    vaultId,
    lastExportedAt: current?.lastExportedAt ?? null,
    lastVerifiedAt: at,
  };
  persistBackupHealth(next);
  return next;
}
