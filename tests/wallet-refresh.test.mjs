import assert from "node:assert/strict";
import test from "node:test";

import {
  describeResourceFailures,
  settleResourceMap,
  withAbortDeadline,
} from "../src/lib/wallet-refresh.ts";

test("wallet resources settle independently when one request fails", async () => {
  const resources = await settleResourceMap({
    balances: Promise.resolve([{ code: "XLM", balance: "12.5" }]),
    reserve: Promise.reject(new Error("reserve unavailable")),
    activity: Promise.resolve([{ id: "op-1" }]),
  });

  assert.deepEqual(resources.balances, {
    ok: true,
    value: [{ code: "XLM", balance: "12.5" }],
  });
  assert.deepEqual(resources.activity, { ok: true, value: [{ id: "op-1" }] });
  assert.equal(resources.reserve.ok, false);
  assert.match(resources.reserve.error.message, /reserve unavailable/);
  assert.equal(describeResourceFailures(resources), "Reserve: reserve unavailable");
});

test("wallet resource deadlines reject even when work ignores abort", async () => {
  const startedAt = Date.now();
  await assert.rejects(
    () => withAbortDeadline(
      () => new Promise(() => {}),
      { timeoutMs: 15, label: "Market price" },
    ),
    /Market price timed out/,
  );
  assert.ok(Date.now() - startedAt < 250, "deadline did not settle promptly");
});

test("wallet resource deadlines forward caller cancellation", async () => {
  const caller = new AbortController();
  const task = withAbortDeadline(
    (signal) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
    { timeoutMs: 5_000, label: "Account data", signal: caller.signal },
  );

  caller.abort(new Error("refresh superseded"));
  await assert.rejects(() => task, /refresh superseded/);
});
