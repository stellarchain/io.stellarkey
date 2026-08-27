import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { emptyStore } from "../src/lib/merchant/defaults.ts";

async function coordinationDomain() {
  try {
    return await import("../src/lib/merchant/coordination.ts");
  } catch (error) {
    assert.fail(
      `The merchant coordination domain is missing: ${error instanceof Error ? error.message : error}`,
    );
  }
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

test("merchant commits increment their revision and reject a stale tab", async () => {
  const { prepareMerchantCommit } = await coordinationDomain();
  const current = emptyStore();
  const candidate = { ...current, nextOrderNumber: 1002 };
  const first = prepareMerchantCommit({
    current,
    candidate,
    persisted: current,
    writerId: "tab-a",
    now: 500,
  });

  assert.equal(first.revision, 1);
  assert.equal(first.writerId, "tab-a");
  assert.equal(first.updatedAt, 500);
  assert.throws(
    () =>
      prepareMerchantCommit({
        current,
        candidate,
        persisted: first,
        writerId: "tab-b",
        now: 600,
      }),
    (error) => error?.name === "MerchantRevisionConflictError",
  );
});

test("only strictly newer external merchant revisions replace local state", async () => {
  const { newerMerchantStore } = await coordinationDomain();
  const current = { ...emptyStore(), revision: 3, writerId: "tab-a", updatedAt: 300 };
  const older = { ...current, revision: 2, writerId: "tab-b" };
  const newer = { ...current, revision: 4, writerId: "tab-b", updatedAt: 400 };

  assert.equal(newerMerchantStore(current, older), null);
  assert.equal(newerMerchantStore(current, current), null);
  assert.equal(newerMerchantStore(current, newer), newer);
});

test("watcher leases elect one tab and transfer after expiry without Web Locks", async () => {
  const { claimWatcherLease, releaseWatcherLease } = await coordinationDomain();
  const storage = memoryStorage();
  const key = "watch:testnet:account";

  assert.equal(claimWatcherLease(storage, key, "tab-a", 100, 50), true);
  assert.equal(claimWatcherLease(storage, key, "tab-b", 120, 50), false);
  assert.equal(releaseWatcherLease(storage, key, "tab-b"), false);
  assert.equal(claimWatcherLease(storage, key, "tab-b", 151, 50), true);
  assert.equal(releaseWatcherLease(storage, key, "tab-a"), false);
  assert.equal(releaseWatcherLease(storage, key, "tab-b"), true);
});

test("the merchant provider reloads revisions and leases Horizon polling", () => {
  const hook = readFileSync(new URL("../src/hooks/useMerchant.tsx", import.meta.url), "utf8");
  assert.match(hook, /openMerchantRevisionChannel/);
  assert.match(hook, /getMerchantRepository/);
  assert.match(hook, /repositoryRef\.current\.commit/);
  assert.match(hook, /requestedRevision/);
  assert.doesNotMatch(hook, /window\.addEventListener\("storage"/);
  assert.match(hook, /prepareMerchantCommit/);
  assert.match(hook, /claimWatcherLease/);
  assert.match(hook, /releaseWatcherLease/);
  assert.match(hook, /merchantWatchDestinations/);
  assert.match(hook, /merchantCursorKey/);
  assert.doesNotMatch(hook, /store\.cursors\[network\]/);
  assert.match(hook, /window\.addEventListener\("pagehide", release\)/);
  assert.match(hook, /navigator\.locks\.request/);
  assert.match(hook, /merchantWriterLockRef/);
  assert.match(hook, /polaris\.merchant\.writer\.v1/);
});
