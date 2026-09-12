import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_BACKUP_FILE_BYTES,
  MAX_CONTACTS_FILE_BYTES,
  MAX_KEYSTORE_FILE_BYTES,
  readBoundedTextFile,
} from "../src/lib/import-limits.ts";

function fakeFile({ size, text }) {
  let reads = 0;
  return {
    size,
    async text() {
      reads += 1;
      return text;
    },
    reads: () => reads,
  };
}

test("oversized imports are rejected before reading attacker-controlled contents", async () => {
  for (const [limit, label] of [
    [MAX_BACKUP_FILE_BYTES, "backup"],
    [MAX_CONTACTS_FILE_BYTES, "contacts"],
    [MAX_KEYSTORE_FILE_BYTES, "keystore"],
  ]) {
    const file = fakeFile({ size: limit + 1, text: "never read" });
    await assert.rejects(() => readBoundedTextFile(file, limit, label), /too large/i);
    assert.equal(file.reads(), 0);
  }
});

test("bounded imports also reject a lying file whose decoded text exceeds the limit", async () => {
  const file = fakeFile({ size: 1, text: "é".repeat(6) });
  await assert.rejects(() => readBoundedTextFile(file, 10, "test file"), /too large/i);
  assert.equal(file.reads(), 1);
});

test("bounded imports return ordinary UTF-8 text within the limit", async () => {
  const file = fakeFile({ size: 2, text: "ok" });
  assert.equal(await readBoundedTextFile(file, 2, "test file"), "ok");
});
