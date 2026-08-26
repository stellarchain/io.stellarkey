import assert from "node:assert/strict";
import test from "node:test";

async function commitDomain() {
  try {
    return await import("../src/lib/merchant/commit.ts");
  } catch (error) {
    assert.fail(
      `The merchant commit domain is missing: ${error instanceof Error ? error.message : error}`,
    );
  }
}

test("merchant updates publish only after a durable save", async () => {
  const { commitMerchantUpdate } = await commitDomain();
  const current = { count: 1 };
  let published = null;

  assert.throws(
    () =>
      commitMerchantUpdate({
        current,
        update: (value) => ({ count: value.count + 1 }),
        save: () => false,
        publish: (value) => {
          published = value;
        },
      }),
    (error) => error?.name === "MerchantStorageError" && error?.code === "write_failed",
  );
  assert.equal(published, null);
  assert.deepEqual(current, { count: 1 });
});

test("merchant update functions run once and publish the saved value", async () => {
  const { commitMerchantUpdate } = await commitDomain();
  const saved = [];
  const published = [];
  let calls = 0;

  const next = commitMerchantUpdate({
    current: { count: 4 },
    update: (value) => {
      calls += 1;
      return { count: value.count + 1 };
    },
    save: (value) => {
      saved.push(value);
      return true;
    },
    publish: (value) => published.push(value),
  });

  assert.equal(calls, 1);
  assert.deepEqual(next, { count: 5 });
  assert.deepEqual(saved, [next]);
  assert.deepEqual(published, [next]);
});

test("recovery locks are a distinct merchant storage failure", async () => {
  const { commitMerchantUpdate } = await commitDomain();

  assert.throws(
    () =>
      commitMerchantUpdate({
        current: { count: 1 },
        update: { count: 2 },
        locked: true,
        save: () => true,
        publish: () => {},
      }),
    (error) => error?.name === "MerchantStorageError" && error?.code === "recovery_required",
  );
});
