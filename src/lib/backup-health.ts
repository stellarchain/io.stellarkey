import { sha256 } from "@noble/hashes/sha2.js";
import { backupVaultIdentity } from "./vault";

export const BACKUP_HEALTH_KEY = "wallet.backup-health.v1";
export const BACKUP_HEALTH_CHANGED_EVENT = "wallet:backup-health-changed";

export interface BackupHealth {
  version: 3;
  vaultId: string;
  lastExportedAt: string | null;
  lastExportedBackupSha256: string | null;
  lastVerifiedAt: string | null;
  lastVerifiedBackupSha256: string | null;
}

interface MarkBackupHealthOptions {
  at?: string;
  vaultId?: string | null;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isNullableTimestamp(value: unknown): value is string | null {
  return value === null || isTimestamp(value);
}

function isNullableSha256(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && /^[0-9a-f]{64}$/.test(value));
}

function backupSha256(backupJson: string): string {
  if (typeof backupJson !== "string" || backupJson.length === 0) {
    throw new Error("Backup bytes are required before recording backup health.");
  }
  return [...sha256(new TextEncoder().encode(backupJson))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function loadBackupHealth(vaultId = backupVaultIdentity()): BackupHealth | null {
  if (typeof window === "undefined") return null;
  if (!vaultId || !/^[0-9a-f]{64}$/.test(vaultId)) return null;
  try {
    const raw = window.localStorage.getItem(BACKUP_HEALTH_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<BackupHealth>;
    if (value.version !== 3 || value.vaultId !== vaultId) return null;
    if (!isNullableTimestamp(value.lastExportedAt)) return null;
    if (!isNullableSha256(value.lastExportedBackupSha256)) return null;
    if (!isNullableTimestamp(value.lastVerifiedAt)) return null;
    if (!isNullableSha256(value.lastVerifiedBackupSha256)) return null;
    if ((value.lastExportedAt === null) !== (value.lastExportedBackupSha256 === null)) return null;
    if ((value.lastVerifiedAt === null) !== (value.lastVerifiedBackupSha256 === null)) return null;
    return {
      version: 3,
      vaultId,
      lastExportedAt: value.lastExportedAt,
      lastExportedBackupSha256: value.lastExportedBackupSha256,
      lastVerifiedAt: value.lastVerifiedAt,
      lastVerifiedBackupSha256: value.lastVerifiedBackupSha256,
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
  backupJson: string,
  options: MarkBackupHealthOptions = {},
): BackupHealth {
  const at = options.at ?? new Date().toISOString();
  const vaultId = options.vaultId ?? backupVaultIdentity();
  if (!isTimestamp(at)) throw new Error("Backup export time is invalid.");
  if (!vaultId || !/^[0-9a-f]{64}$/.test(vaultId)) throw new Error("Wallet backup identity is unavailable.");
  const current = loadBackupHealth(vaultId);
  const next: BackupHealth = {
    version: 3,
    vaultId,
    lastExportedAt: at,
    lastExportedBackupSha256: backupSha256(backupJson),
    lastVerifiedAt: current?.lastVerifiedAt ?? null,
    lastVerifiedBackupSha256: current?.lastVerifiedBackupSha256 ?? null,
  };
  persistBackupHealth(next);
  return next;
}

export function markBackupVerified(
  backupJson: string,
  options: MarkBackupHealthOptions = {},
): BackupHealth {
  const at = options.at ?? new Date().toISOString();
  const vaultId = options.vaultId ?? backupVaultIdentity();
  if (!isTimestamp(at)) throw new Error("Backup verification time is invalid.");
  if (!vaultId || !/^[0-9a-f]{64}$/.test(vaultId)) throw new Error("Wallet backup identity is unavailable.");
  const current = loadBackupHealth(vaultId);
  const next: BackupHealth = {
    version: 3,
    vaultId,
    lastExportedAt: current?.lastExportedAt ?? null,
    lastExportedBackupSha256: current?.lastExportedBackupSha256 ?? null,
    lastVerifiedAt: at,
    lastVerifiedBackupSha256: backupSha256(backupJson),
  };
  persistBackupHealth(next);
  return next;
}
