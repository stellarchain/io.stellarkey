import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

class MemoryStorage {
  #items = new Map();

  getItem(key) {
    return this.#items.get(key) ?? null;
  }

  setItem(key, value) {
    this.#items.set(key, String(value));
  }
}

test("backup health ignores malformed local records", async () => {
  const localStorage = new MemoryStorage();
  globalThis.window = { localStorage };
  const { BACKUP_HEALTH_KEY, loadBackupHealth } = await import("../src/lib/backup-health.ts");

  assert.equal(loadBackupHealth(), null);
  localStorage.setItem(BACKUP_HEALTH_KEY, "not-json");
  assert.equal(loadBackupHealth(), null);
  localStorage.setItem(
    BACKUP_HEALTH_KEY,
    JSON.stringify({ version: 99, lastExportedAt: "2026-08-27T09:00:00.000Z" }),
  );
  assert.equal(loadBackupHealth(), null);
});

test("backup health records exports and successful verification locally", async () => {
  const localStorage = new MemoryStorage();
  globalThis.window = { localStorage, dispatchEvent() {} };
  const {
    loadBackupHealth,
    markBackupExported,
    markBackupVerified,
  } = await import("../src/lib/backup-health.ts");
  const exportedAt = "2026-08-27T09:00:00.000Z";
  const verifiedAt = "2026-08-27T09:05:00.000Z";
  const exportedBackup = '{"backup":"exported"}\n';
  const verifiedBackup = '{"backup":"verified"}\n';
  const exportedBackupSha256 = createHash("sha256").update(exportedBackup).digest("hex");
  const verifiedBackupSha256 = createHash("sha256").update(verifiedBackup).digest("hex");

  const vaultId = "a".repeat(64);
  markBackupExported(exportedBackup, { at: exportedAt, vaultId });
  assert.deepEqual(loadBackupHealth(vaultId), {
    version: 3,
    vaultId,
    lastExportedAt: exportedAt,
    lastExportedBackupSha256: exportedBackupSha256,
    lastVerifiedAt: null,
    lastVerifiedBackupSha256: null,
  });
  markBackupVerified(verifiedBackup, { at: verifiedAt, vaultId });
  assert.deepEqual(loadBackupHealth(vaultId), {
    version: 3,
    vaultId,
    lastExportedAt: exportedAt,
    lastExportedBackupSha256: exportedBackupSha256,
    lastVerifiedAt: verifiedAt,
    lastVerifiedBackupSha256: verifiedBackupSha256,
  });
  assert.equal(loadBackupHealth("b".repeat(64)), null);
});

test("backup health rejects records whose byte identities are missing or malformed", async () => {
  const localStorage = new MemoryStorage();
  globalThis.window = { localStorage };
  const { BACKUP_HEALTH_KEY, loadBackupHealth } = await import("../src/lib/backup-health.ts");
  const vaultId = "c".repeat(64);

  localStorage.setItem(BACKUP_HEALTH_KEY, JSON.stringify({
    version: 3,
    vaultId,
    lastExportedAt: "2026-08-27T09:00:00.000Z",
    lastExportedBackupSha256: null,
    lastVerifiedAt: null,
    lastVerifiedBackupSha256: null,
  }));
  assert.equal(loadBackupHealth(vaultId), null);

  localStorage.setItem(BACKUP_HEALTH_KEY, JSON.stringify({
    version: 3,
    vaultId,
    lastExportedAt: null,
    lastExportedBackupSha256: null,
    lastVerifiedAt: "2026-08-27T09:05:00.000Z",
    lastVerifiedBackupSha256: "not-a-digest",
  }));
  assert.equal(loadBackupHealth(vaultId), null);
});
