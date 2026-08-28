import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  describeResourceFailures,
  settleResourceMap,
  withAbortDeadline,
} from "../src/lib/wallet-refresh.ts";
import {
  createLatestRequestLane,
  createVisibleWalletRefreshScheduler,
  horizonStreamPollInterval,
  walletBackgroundStaggerMs,
  WALLET_ACCOUNT_POLL_MS,
  WALLET_BACKGROUND_POLL_MS,
  WALLET_STREAM_SAFETY_POLL_MS,
  WALLET_MARKET_POLL_MS,
} from "../src/hooks/useWalletResources.ts";

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

test("wallet refresh lanes keep live account data faster than market data", () => {
  assert.equal(WALLET_ACCOUNT_POLL_MS, 15_000);
  assert.equal(WALLET_STREAM_SAFETY_POLL_MS, 60_000);
  assert.equal(WALLET_BACKGROUND_POLL_MS, 120_000);
  assert.equal(WALLET_MARKET_POLL_MS, 60_000);
  assert.ok(WALLET_BACKGROUND_POLL_MS > WALLET_STREAM_SAFETY_POLL_MS);
});

test("healthy Horizon streams reduce safety polling and errors restore fallback polling", () => {
  assert.equal(horizonStreamPollInterval("connecting"), WALLET_ACCOUNT_POLL_MS);
  assert.equal(horizonStreamPollInterval("degraded"), WALLET_ACCOUNT_POLL_MS);
  assert.equal(horizonStreamPollInterval("open"), WALLET_STREAM_SAFETY_POLL_MS);

  const wallet = readFileSync(new URL("../src/hooks/useWallet.tsx", import.meta.url), "utf8");
  assert.match(wallet, /es\.onopen\s*=\s*\(\)\s*=>\s*\{\s*reportStreamState\("open"\)/);
  assert.match(wallet, /es\.onerror\s*=\s*\(\)\s*=>\s*\{\s*reportStreamState\("degraded"\)/);
  assert.match(wallet, /horizonStreamPollInterval\(horizonStreamState\)/);
});

test("visibility recovery refreshes immediately and background work starts staggered", async () => {
  class VisibilityTarget extends EventTarget {
    visibilityState = "visible";
  }
  const documentTarget = new VisibilityTarget();
  const intervals = new Map();
  const timeouts = new Map();
  let nextTimer = 1;
  const timerTarget = {
    setInterval(callback, delay) {
      const id = nextTimer++;
      intervals.set(id, { callback, delay });
      return id;
    },
    clearInterval(id) {
      intervals.delete(id);
    },
    setTimeout(callback, delay) {
      const id = nextTimer++;
      timeouts.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      timeouts.delete(id);
    },
  };
  let refreshes = 0;
  const staggerMs = walletBackgroundStaggerMs("testnet:GACTIVE");
  const stop = createVisibleWalletRefreshScheduler({
    refresh: async () => { refreshes += 1; },
    intervalMs: WALLET_BACKGROUND_POLL_MS,
    initialDelayMs: staggerMs,
    documentTarget,
    timerTarget,
  });

  assert.equal(refreshes, 0, "background refresh must not burst with active-account startup");
  assert.ok(staggerMs > 0 && staggerMs < WALLET_ACCOUNT_POLL_MS);
  assert.deepEqual([...timeouts.values()].map(({ delay }) => delay), [staggerMs]);
  const [timeoutId, timeout] = timeouts.entries().next().value;
  timeouts.delete(timeoutId);
  timeout.callback();
  await Promise.resolve();
  assert.equal(refreshes, 1);

  documentTarget.visibilityState = "hidden";
  intervals.values().next().value.callback();
  await Promise.resolve();
  assert.equal(refreshes, 1, "hidden documents must not poll");

  documentTarget.visibilityState = "visible";
  documentTarget.dispatchEvent(new Event("visibilitychange"));
  await Promise.resolve();
  assert.equal(refreshes, 2, "visibility restoration must reconcile immediately");

  stop();
  assert.equal(intervals.size, 0);
  assert.equal(timeouts.size, 0);
});

test("starting a refresh aborts obsolete work in the same lane", () => {
  const lane = createLatestRequestLane();
  const first = lane.begin();
  const second = lane.begin();

  assert.equal(first.signal.aborted, true);
  assert.equal(first.isCurrent(), false);
  assert.equal(second.signal.aborted, false);
  assert.equal(second.isCurrent(), true);

  lane.cancel();
  assert.equal(second.signal.aborted, true);
  assert.equal(second.isCurrent(), false);
});
