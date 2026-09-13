export interface BackupArchiveStorage {
  read(): Promise<string | null>;
  replace(value: string | null): Promise<void>;
}

export interface BackupStorageReplacement {
  storage: Storage;
  keys: readonly string[];
  writes: ReadonlyMap<string, string | null>;
  archive?: BackupArchiveStorage | null;
  archiveValue?: string | null;
  archives?: ReadonlyArray<{
    archive: BackupArchiveStorage;
    value: string | null;
  }>;
}

function writeVerified(storage: Storage, key: string, value: string | null): void {
  if (value === null) storage.removeItem(key);
  else storage.setItem(key, value);
  if (storage.getItem(key) !== value) {
    throw new Error(`Storage did not retain ${key}.`);
  }
}

/**
 * Replace a backup's synchronous browser records and its asynchronous archive
 * as one recoverable operation. A failed archive write may already have
 * mutated IndexedDB, so rollback always restores its exact previous bytes.
 */
export async function replaceBackupStorage({
  storage,
  keys,
  writes,
  archive = null,
  archiveValue = null,
  archives = [],
}: BackupStorageReplacement): Promise<void> {
  if (archive && archives.length > 0) {
    throw new Error("Backup restore cannot mix single and multiple archive options.");
  }
  const replacements = archive
    ? [{ archive, value: archiveValue }]
    : [...archives];
  const before = new Map(keys.map((key) => [key, storage.getItem(key)]));
  const previousArchives = await Promise.all(
    replacements.map(replacement => replacement.archive.read()),
  );
  const startedArchives: number[] = [];

  try {
    for (const [key, value] of writes) writeVerified(storage, key, value);
    for (const [index, replacement] of replacements.entries()) {
      startedArchives.push(index);
      await replacement.archive.replace(replacement.value);
    }
  } catch (error) {
    let rollbackFailed = false;
    for (const index of startedArchives.reverse()) {
      try {
        await replacements[index].archive.replace(previousArchives[index]);
      } catch {
        rollbackFailed = true;
      }
    }
    for (const [key, value] of before) {
      try {
        writeVerified(storage, key, value);
      } catch {
        rollbackFailed = true;
      }
    }
    const reason = error instanceof Error ? error.message : "Browser storage failed.";
    throw new Error(
      rollbackFailed
        ? `Wallet restore failed and browser storage could not be fully rolled back: ${reason}`
        : `Wallet restore failed; the previous wallet was restored unchanged: ${reason}`,
    );
  }
}
