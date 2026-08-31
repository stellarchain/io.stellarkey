import assert from "node:assert/strict";
import test from "node:test";

async function shellModeDomain() {
  try {
    return await import("../src/lib/shell-mode.ts");
  } catch (error) {
    assert.fail(
      `The shell-mode domain is missing: ${error instanceof Error ? error.message : error}`,
    );
  }
}

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
  };
}

test("shell mode persists only validated wallet or merchant values", async () => {
  const { SHELL_MODE_STORAGE_KEY, readShellMode, writeShellMode } = await shellModeDomain();
  const storage = memoryStorage();

  assert.equal(readShellMode(storage), "wallet");
  assert.equal(writeShellMode("merchant", storage), true);
  assert.equal(storage.getItem(SHELL_MODE_STORAGE_KEY), "merchant");
  assert.equal(readShellMode(storage), "merchant");
  assert.equal(writeShellMode("wallet", storage), true);
  assert.equal(readShellMode(storage), "wallet");

  storage.setItem(SHELL_MODE_STORAGE_KEY, "private");
  assert.equal(readShellMode(storage), "wallet");
});

test("unavailable storage keeps the wallet mode usable", async () => {
  const { readShellMode, writeShellMode } = await shellModeDomain();
  const unavailable = {
    getItem() { throw new DOMException("Storage disabled", "SecurityError"); },
    setItem() { throw new DOMException("Storage disabled", "SecurityError"); },
  };

  assert.equal(readShellMode(unavailable), "wallet");
  assert.equal(writeShellMode("merchant", unavailable), false);
});
