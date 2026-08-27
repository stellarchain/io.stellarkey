import assert from "node:assert/strict";
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

  markBackupExported(exportedAt);
  assert.deepEqual(loadBackupHealth(), {
    version: 1,
    lastExportedAt: exportedAt,
    lastVerifiedAt: null,
  });
  markBackupVerified(verifiedAt);
  assert.deepEqual(loadBackupHealth(), {
    version: 1,
    lastExportedAt: exportedAt,
    lastVerifiedAt: verifiedAt,
  });
});
