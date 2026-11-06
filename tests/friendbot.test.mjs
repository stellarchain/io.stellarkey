import assert from "node:assert/strict";
import test from "node:test";
import { fundWithFriendbot } from "../src/lib/api.ts";

const PUBLIC_KEY = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

test("friendbot: resolves after a successful funding response", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 200 }));
  await fundWithFriendbot(PUBLIC_KEY, "testnet");
});

test("friendbot: rejects on mainnet without calling fetch", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 200 }));
  await assert.rejects(
    () => fundWithFriendbot(PUBLIC_KEY, "mainnet"),
    /only available on testnet/i,
  );
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("friendbot: bounds the request with an abort signal", async (t) => {
  let seenSignal = null;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    seenSignal = init?.signal ?? null;
    return new Response(null, { status: 200 });
  });
  await fundWithFriendbot(PUBLIC_KEY, "testnet");
  assert.ok(seenSignal instanceof AbortSignal, "fetch must receive an AbortSignal");
});

test("friendbot: truncates an oversized error body in the thrown message", async (t) => {
  const oversized = "x".repeat(5000);
  t.mock.method(globalThis, "fetch", async () => new Response(oversized, { status: 500 }));
  await assert.rejects(
    () => fundWithFriendbot(PUBLIC_KEY, "testnet"),
    (error) => {
      assert.ok(error.message.length < 500, `message should be truncated, got ${error.message.length} chars`);
      return true;
    },
  );
});

test("friendbot: deadline includes an error body that ignores cancellation", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
    pull: () => new Promise(() => {}),
  }), { status: 500 }));
  const outcome = fundWithFriendbot(PUBLIC_KEY, "testnet");
  const rejection = assert.rejects(outcome, /Friendbot funding timed out/);
  await Promise.resolve();
  t.mock.timers.tick(30_000);
  await rejection;
});
