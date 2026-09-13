import assert from "node:assert/strict";
import test from "node:test";

import { getHorizonJson, HorizonRequestError } from "../src/lib/horizon.ts";

test("bounded Horizon reads retry transient server failures and then succeed", async (t) => {
  let requests = 0;
  const waits = [];
  t.mock.method(globalThis, "fetch", async () => {
    requests += 1;
    return requests === 1
      ? new Response(JSON.stringify({ title: "busy" }), { status: 503 })
      : new Response(JSON.stringify({ ok: true }), { status: 200 });
  });

  const value = await getHorizonJson(
    "https://horizon.example/accounts/GABC",
    undefined,
    5_000,
    { maxReadAttempts: 3, random: () => 0, sleep: async (ms) => { waits.push(ms); } },
  );

  assert.deepEqual(value, { ok: true });
  assert.equal(requests, 2);
  assert.deepEqual(waits, [250]);
});

test("bounded Horizon reads retry a transient network failure", async (t) => {
  let requests = 0;
  const waits = [];
  t.mock.method(globalThis, "fetch", async () => {
    requests += 1;
    if (requests === 1) throw new TypeError("network connection lost");
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });

  const value = await getHorizonJson(
    "https://horizon.example/accounts/GABC",
    undefined,
    5_000,
    { maxReadAttempts: 2, random: () => 0, sleep: async (ms) => { waits.push(ms); } },
  );

  assert.deepEqual(value, { ok: true });
  assert.equal(requests, 2);
  assert.deepEqual(waits, [250]);
});

test("Retry-After controls a bounded rate-limit retry", async (t) => {
  let requests = 0;
  const waits = [];
  t.mock.method(globalThis, "fetch", async () => {
    requests += 1;
    return requests === 1
      ? new Response(JSON.stringify({ title: "rate limited" }), {
          status: 429,
          headers: { "Retry-After": "2" },
        })
      : new Response(JSON.stringify({ ok: true }), { status: 200 });
  });

  await getHorizonJson("https://horizon.example/fee_stats", undefined, 5_000, {
    maxReadAttempts: 2,
    sleep: async (ms) => { waits.push(ms); },
  });

  assert.equal(requests, 2);
  assert.deepEqual(waits, [2_000]);
});

test("reads stop at their attempt cap and non-idempotent requests never retry", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests += 1;
    return new Response(JSON.stringify({ title: "busy" }), { status: 503 });
  });

  await assert.rejects(
    getHorizonJson("https://horizon.example/accounts/GABC", undefined, 5_000, {
      maxReadAttempts: 3,
      sleep: async () => {},
    }),
    (error) => error instanceof HorizonRequestError && error.kind === "server",
  );
  assert.equal(requests, 3);

  requests = 0;
  await assert.rejects(
    getHorizonJson("https://horizon.example/transactions", { method: "POST" }, 5_000, {
      maxReadAttempts: 3,
      sleep: async () => {},
    }),
    (error) => error instanceof HorizonRequestError && error.kind === "server",
  );
  assert.equal(requests, 1);
});

test("validation failures and caller cancellation are never retried", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests += 1;
    return new Response(JSON.stringify({ title: "bad request" }), { status: 400 });
  });

  await assert.rejects(
    getHorizonJson("https://horizon.example/resource", undefined, 5_000, {
      maxReadAttempts: 3,
      sleep: async () => {},
    }),
    (error) => error instanceof HorizonRequestError && error.kind === "validation",
  );
  assert.equal(requests, 1);
});
