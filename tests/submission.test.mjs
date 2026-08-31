import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

import { explainSubmitError, submitSignedTx } from "../src/lib/api.ts";
import * as walletApi from "../src/lib/api.ts";
import { getHorizonJson, HorizonRequestError } from "../src/lib/horizon.ts";
import * as submission from "../src/lib/submission.ts";

function buildSignedTransaction() {
  const source = Keypair.random();
  const transaction = new TransactionBuilder(new Account(source.publicKey(), "0"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.payment({
      destination: Keypair.random().publicKey(),
      asset: Asset.native(),
      amount: "1",
    }))
    .setTimeout(180)
    .build();
  transaction.sign(source);
  return transaction;
}

function canonicalHash(transaction) {
  return Buffer.from(transaction.hash()).toString("hex");
}

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    get length() {
      return values.size;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
    values,
  };
}

function notFoundResponse() {
  return new Response(JSON.stringify({ title: "Resource Missing" }), { status: 404 });
}

test("Horizon timeout covers waiting for response headers", async (t) => {
  assert.equal(getHorizonJson.length, 4, "expected testable timeout and retry policy seams");
  t.mock.method(globalThis, "fetch", async (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
    }));

  await assert.rejects(
    getHorizonJson("https://horizon.invalid/resource", undefined, 5),
    (error) => error instanceof HorizonRequestError && error.kind === "network",
  );
});

test("Horizon caller abort covers waiting for response headers", async (t) => {
  const caller = new AbortController();
  t.mock.method(globalThis, "fetch", async (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
    }));

  const request = getHorizonJson(
    "https://horizon.invalid/resource",
    { signal: caller.signal },
    1_000,
  );
  caller.abort(new Error("caller stopped waiting for headers"));
  await assert.rejects(
    request,
    (error) => error instanceof HorizonRequestError && error.kind === "network",
  );
});

test("Horizon timeout cancels a hanging response body", async (t) => {
  let bodyCancelled = false;
  t.mock.method(globalThis, "fetch", async () =>
    new Response(new ReadableStream({
      pull() {},
      cancel() {
        bodyCancelled = true;
      },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

  await assert.rejects(
    getHorizonJson("https://horizon.invalid/resource", undefined, 5),
    (error) => error instanceof HorizonRequestError && error.kind === "network",
  );
  assert.equal(bodyCancelled, true);
});

test("Horizon preserves a known 429 response when its body hangs", async (t) => {
  let bodyCancelled = false;
  t.mock.method(globalThis, "fetch", async () =>
    new Response(new ReadableStream({
      pull() {},
      cancel() {
        bodyCancelled = true;
      },
    }), { status: 429 }));

  await assert.rejects(
    getHorizonJson("https://horizon.invalid/resource", undefined, 5),
    (error) =>
      error instanceof HorizonRequestError &&
      error.kind === "rate_limited" &&
      error.status === 429,
  );
  assert.equal(bodyCancelled, true);
});

test("Horizon caller abort covers a hanging response body", async (t) => {
  const caller = new AbortController();
  let bodyStarted = false;
  t.mock.method(globalThis, "fetch", async () =>
    new Response(new ReadableStream({
      start() {
        bodyStarted = true;
      },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

  const request = getHorizonJson(
    "https://horizon.invalid/resource",
    { signal: caller.signal },
    1_000,
  );
  caller.abort(new Error("caller stopped waiting"));

  await assert.rejects(
    request,
    (error) => error instanceof HorizonRequestError && error.kind === "network",
  );
  assert.equal(bodyStarted, true);
});

test("Horizon removes caller listeners and clears its timer after body completion", async (t) => {
  let added = 0;
  let removed = 0;
  let lateAbort = 0;
  const callerSignal = {
    aborted: false,
    reason: undefined,
    addEventListener() {
      added += 1;
    },
    removeEventListener() {
      removed += 1;
    },
  };
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    init.signal.addEventListener("abort", () => {
      lateAbort += 1;
    });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });

  assert.deepEqual(
    await getHorizonJson("https://horizon.invalid/resource", { signal: callerSignal }, 5),
    { ok: true },
  );
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(added, 1);
  assert.equal(removed, 1);
  assert.equal(lateAbort, 0);
});

test("Horizon cancels an oversized body without waiting for a slow stream cancel", async (t) => {
  let cancelled = false;
  t.mock.method(globalThis, "fetch", async () =>
    new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(1_048_577));
      },
      cancel() {
        cancelled = true;
        return new Promise((resolve) => setTimeout(resolve, 60));
      },
    }), { status: 200 }));

  const started = performance.now();
  await assert.rejects(
    getHorizonJson("https://horizon.invalid/oversized"),
    (error) =>
      error instanceof HorizonRequestError &&
      error.kind === "response_too_large",
  );
  assert.ok(performance.now() - started < 40, "typed failure waited for stream cancellation");
  assert.equal(cancelled, true);
});

test("submission returns the deterministic local transaction hash", async (t) => {
  const transaction = buildSignedTransaction();
  const expectedHash = canonicalHash(transaction);
  t.mock.method(globalThis, "fetch", async (url) => {
    assert.match(String(url), /\/transactions$/);
    return new Response(JSON.stringify({ hash: expectedHash }), { status: 200 });
  });

  assert.deepEqual(await submitSignedTx(transaction, "testnet"), {
    hash: expectedHash,
    network: "testnet",
    status: "accepted",
  });
});

test("submission exposes canonical recovery identity synchronously before POST", async (t) => {
  const transaction = buildSignedTransaction();
  const expectedHash = canonicalHash(transaction);
  const events = [];
  let prepared;
  t.mock.method(globalThis, "fetch", async () => {
    events.push("fetch");
    return new Response(JSON.stringify({ hash: expectedHash }), { status: 200 });
  });

  await submitSignedTx(transaction, "testnet", 15_000, (identity) => {
    events.push("prepared");
    prepared = identity;
  });

  assert.deepEqual(events, ["prepared", "fetch"]);
  assert.equal(prepared.hash, expectedHash);
  assert.equal(prepared.network, "testnet");
  assert.equal(typeof prepared.expiresAt, "number");
});

test("prepared-recovery persistence failure prevents any Horizon POST", async (t) => {
  const transaction = buildSignedTransaction();
  let fetches = 0;
  t.mock.method(globalThis, "fetch", async () => {
    fetches += 1;
    throw new Error("must not fetch");
  });

  await assert.rejects(
    submitSignedTx(transaction, "testnet", 15_000, () => {
      throw new Error("session storage quota exceeded");
    }),
    /session storage quota exceeded/,
  );
  assert.equal(fetches, 0);
});

test("a 2xx response that does not acknowledge the canonical hash is ambiguous", async (t) => {
  const transaction = buildSignedTransaction();
  const expectedHash = canonicalHash(transaction);
  let request = 0;
  t.mock.method(globalThis, "fetch", async () => {
    request += 1;
    return request === 1
      ? new Response(JSON.stringify({ hash: "not-the-canonical-hash" }), { status: 200 })
      : notFoundResponse();
  });

  assert.deepEqual(await submitSignedTx(transaction, "testnet"), {
    hash: expectedHash,
    network: "testnet",
    status: "status_unknown",
  });
});

test("malformed 2xx submission response becomes status unknown after a not-found lookup", async (t) => {
  const transaction = buildSignedTransaction();
  const expectedHash = canonicalHash(transaction);
  let request = 0;
  t.mock.method(globalThis, "fetch", async () => {
    request += 1;
    return request === 1
      ? new Response("{not-json", { status: 200 })
      : notFoundResponse();
  });

  assert.deepEqual(await submitSignedTx(transaction, "testnet"), {
    hash: expectedHash,
    network: "testnet",
    status: "status_unknown",
  });
});

test("5xx submission response becomes status unknown when its hash is not found", async (t) => {
  const transaction = buildSignedTransaction();
  let request = 0;
  t.mock.method(globalThis, "fetch", async () => {
    request += 1;
    return request === 1
      ? new Response(JSON.stringify({ title: "Internal Server Error" }), { status: 503 })
      : notFoundResponse();
  });

  assert.equal((await submitSignedTx(transaction, "testnet")).status, "status_unknown");
});

test("POST timeout before headers becomes status unknown after canonical lookup", async (t) => {
  const transaction = buildSignedTransaction();
  let request = 0;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    request += 1;
    if (request === 1) {
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      });
    }
    return notFoundResponse();
  });

  assert.equal((await submitSignedTx(transaction, "testnet", 5)).status, "status_unknown");
});

test("POST timeout while reading the response body becomes status unknown", async (t) => {
  const transaction = buildSignedTransaction();
  let request = 0;
  t.mock.method(globalThis, "fetch", async () => {
    request += 1;
    return request === 1
      ? new Response(new ReadableStream({ pull() {} }), { status: 200 })
      : notFoundResponse();
  });

  assert.equal((await submitSignedTx(transaction, "testnet", 5)).status, "status_unknown");
});

test("a hanging 429 POST body remains a definite rejection", async (t) => {
  const transaction = buildSignedTransaction();
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    return new Response(new ReadableStream({ pull() {} }), { status: 429 });
  });

  await assert.rejects(
    submitSignedTx(transaction, "testnet", 5),
    (error) => error instanceof HorizonRequestError && error.status === 429,
  );
  assert.equal(calls, 1);
});

test("canonical lookup is bounded while waiting for response headers", async (t) => {
  const transaction = buildSignedTransaction();
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    calls += 1;
    if (calls === 1) throw new TypeError("submission connection reset");
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
    });
  });

  assert.equal((await submitSignedTx(transaction, "testnet", 5)).status, "status_unknown");
  assert.equal(calls, 2);
});

test("canonical lookup is bounded while reading a response body", async (t) => {
  const transaction = buildSignedTransaction();
  let calls = 0;
  let lookupBodyCancelled = false;
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    if (calls === 1) throw new TypeError("submission connection reset");
    return new Response(new ReadableStream({
      pull() {},
      cancel() {
        lookupBodyCancelled = true;
      },
    }), { status: 200 });
  });

  assert.equal((await submitSignedTx(transaction, "testnet", 5)).status, "status_unknown");
  assert.equal(calls, 2);
  assert.equal(lookupBodyCancelled, true);
});

for (const status of [404, 429]) {
  test(`an explicit ${status} POST response is a definite rejection`, async (t) => {
    const transaction = buildSignedTransaction();
    let calls = 0;
    const body = { title: status === 404 ? "Not Found" : "Rate Limited" };
    t.mock.method(globalThis, "fetch", async () => {
      calls += 1;
      return new Response(JSON.stringify(body), { status });
    });

    await assert.rejects(
      submitSignedTx(transaction, "testnet"),
      (error) =>
        error instanceof HorizonRequestError &&
        error.status === status &&
        error.body.title === body.title,
    );
    assert.equal(calls, 1);
  });
}

test("clear Horizon validation rejection retains parsed result codes", async (t) => {
  const transaction = buildSignedTransaction();
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    return new Response(JSON.stringify({
      title: "Transaction Failed",
      extras: {
        result_codes: {
          transaction: "tx_insufficient_fee",
          operations: ["op_underfunded"],
        },
      },
    }), { status: 400 });
  });

  await assert.rejects(
    submitSignedTx(transaction, "testnet"),
    (error) =>
      error instanceof HorizonRequestError &&
      error.kind === "validation" &&
      error.body.extras.result_codes.transaction === "tx_insufficient_fee",
  );
  assert.equal(calls, 1);
});

test("bodyless Horizon failures retain their safe error explanation", () => {
  const error = new HorizonRequestError("Transaction was found on-chain but failed.", {
    kind: "validation",
  });
  assert.equal(explainSubmitError(error), "Transaction was found on-chain but failed.");
});

test("ambiguous submission is confirmed by canonical hash lookup", async (t) => {
  const transaction = buildSignedTransaction();
  const expectedHash = canonicalHash(transaction);
  let request = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    request += 1;
    if (request === 1) throw new TypeError("connection reset");
    assert.ok(String(url).endsWith(`/transactions/${expectedHash}`));
    return new Response(JSON.stringify({ hash: expectedHash, successful: true }), { status: 200 });
  });

  assert.equal((await submitSignedTx(transaction, "testnet")).status, "confirmed");
});

test("ambiguous submission remains status unknown when hash lookup is unavailable", async (t) => {
  const transaction = buildSignedTransaction();
  t.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("Horizon unavailable");
  });

  const result = await submitSignedTx(transaction, "testnet");
  assert.equal(result.status, "status_unknown");
  assert.equal(result.hash, canonicalHash(transaction));
});

test("tx_bad_seq checks whether the canonical hash was accepted previously", async (t) => {
  const transaction = buildSignedTransaction();
  const expectedHash = canonicalHash(transaction);
  let request = 0;
  t.mock.method(globalThis, "fetch", async () => {
    request += 1;
    if (request === 1) {
      return new Response(JSON.stringify({
        title: "Transaction Failed",
        extras: { result_codes: { transaction: "tx_bad_seq" } },
      }), { status: 400 });
    }
    return new Response(JSON.stringify({ hash: expectedHash, successful: true }), { status: 200 });
  });

  assert.equal((await submitSignedTx(transaction, "testnet")).status, "confirmed");
});

test("tx_bad_seq remains a definite rejection when canonical lookup is not found", async (t) => {
  const transaction = buildSignedTransaction();
  let request = 0;
  t.mock.method(globalThis, "fetch", async () => {
    request += 1;
    return request === 1
      ? new Response(JSON.stringify({
        title: "Transaction Failed",
        extras: { result_codes: { transaction: "tx_bad_seq" } },
      }), { status: 400 })
      : notFoundResponse();
  });

  await assert.rejects(
    submitSignedTx(transaction, "testnet"),
    (error) =>
      error instanceof HorizonRequestError &&
      error.body.extras.result_codes.transaction === "tx_bad_seq",
  );
});

test("tx_bad_seq remains status unknown when canonical lookup is unavailable", async (t) => {
  const transaction = buildSignedTransaction();
  let request = 0;
  t.mock.method(globalThis, "fetch", async () => {
    request += 1;
    if (request === 1) {
      return new Response(JSON.stringify({
        title: "Transaction Failed",
        extras: { result_codes: { transaction: "tx_bad_seq" } },
      }), { status: 400 });
    }
    throw new TypeError("lookup unavailable");
  });

  assert.equal((await submitSignedTx(transaction, "testnet")).status, "status_unknown");
});

test("canonical hash lookup reports an on-chain failed transaction", async (t) => {
  const transaction = buildSignedTransaction();
  let request = 0;
  t.mock.method(globalThis, "fetch", async () => {
    request += 1;
    if (request === 1) throw new TypeError("connection reset");
    return new Response(JSON.stringify({ successful: false }), { status: 200 });
  });

  await assert.rejects(
    submitSignedTx(transaction, "testnet"),
    (error) =>
      error instanceof HorizonRequestError &&
      error.kind === "validation" &&
      /found on-chain but failed/i.test(error.message),
  );
});

test("pending transaction insertion preserves accepted certainty for a canonical hash", () => {
  assert.equal(typeof submission.pendingTransactionFromSubmission, "function");
  assert.equal(typeof submission.upsertPendingTransaction, "function");
  const accepted = submission.pendingTransactionFromSubmission({
    hash: "ab".repeat(32),
    network: "testnet",
    status: "accepted",
  }, "Payment");
  const unknown = submission.pendingTransactionFromSubmission({
    hash: "ab".repeat(32),
    network: "testnet",
    status: "status_unknown",
  }, "Payment");
  assert.equal(accepted.status, "confirming");
  assert.equal(unknown.status, "status_unknown");

  const pending = submission.upsertPendingTransaction(
    submission.upsertPendingTransaction([], accepted),
    unknown,
  );
  assert.equal(pending.length, 1);
  assert.equal(pending[0].status, "confirming");
  assert.equal(
    submission.upsertPendingTransaction([unknown], accepted)[0].status,
    "confirming",
  );
  assert.equal(
    submission.upsertPendingTransaction(pending, { ...accepted, network: "mainnet" }).length,
    2,
  );
});

test("an inconclusive poll preserves accepted versus ambiguous tracking status", () => {
  assert.equal(typeof submission.applyTransactionPoll, "function");
  const accepted = submission.pendingTransactionFromSubmission({
    hash: "aa".repeat(32),
    network: "testnet",
    status: "accepted",
  }, "Payment");
  const ambiguous = submission.pendingTransactionFromSubmission({
    hash: "bb".repeat(32),
    network: "mainnet",
    status: "status_unknown",
  }, "Swap");
  const tracking = { pending: [accepted, ambiguous], resolutions: {} };

  const acceptedPoll = submission.applyTransactionPoll(tracking, accepted, null, 10);
  const ambiguousPoll = submission.applyTransactionPoll(tracking, ambiguous, null, 10);
  assert.equal(acceptedPoll.tracking, tracking);
  assert.equal(acceptedPoll.resolution, null);
  assert.equal(acceptedPoll.tracking.pending[0].status, "confirming");
  assert.equal(ambiguousPoll.tracking.pending[1].status, "status_unknown");
});

test("confirmed and failed polls resolve and unlock submissions by network and hash", () => {
  assert.equal(typeof submission.applyTransactionPoll, "function");
  assert.equal(typeof submission.submissionLifecycleStatus, "function");
  const acceptedSubmission = {
    hash: "ca".repeat(32),
    network: "testnet",
    status: "accepted",
  };
  const failedSubmission = {
    hash: "fa".repeat(32),
    network: "mainnet",
    status: "status_unknown",
  };
  const accepted = submission.pendingTransactionFromSubmission(
    acceptedSubmission,
    "Account merge",
    { kind: "reconcile_account_merge" },
  );
  const ambiguous = submission.pendingTransactionFromSubmission(failedSubmission, "Swap");
  let tracking = { pending: [accepted, ambiguous], resolutions: {} };

  const confirmed = submission.applyTransactionPoll(tracking, accepted, true, 11);
  tracking = confirmed.tracking;
  assert.equal(tracking.pending.length, 1);
  assert.deepEqual(confirmed.resolution, {
    hash: accepted.hash,
    network: accepted.network,
    status: "confirmed",
    resolvedAt: 11,
    action: { kind: "reconcile_account_merge" },
  });
  assert.equal(submission.submissionLifecycleStatus(acceptedSubmission, tracking.resolutions), "confirmed");

  const failed = submission.applyTransactionPoll(tracking, ambiguous, false, 12);
  assert.equal(failed.tracking.pending.length, 0);
  assert.equal(submission.submissionLifecycleStatus(failedSubmission, failed.tracking.resolutions), "failed");
  assert.equal(
    submission.submissionLifecycleStatus(
      { ...acceptedSubmission, network: "mainnet" },
      failed.tracking.resolutions,
    ),
    "accepted",
  );
});

test("pending status presentation warns against blind resubmission and exposes recovery identity", () => {
  assert.equal(typeof submission.pendingTransactionPresentation, "function");
  const hash = "cd".repeat(32);
  const unknown = submission.pendingTransactionPresentation({
    hash,
    network: "mainnet",
    label: "Swap",
    status: "status_unknown",
  });
  assert.match(unknown.title, /status unknown/i);
  assert.match(unknown.detail, /do not resubmit blindly/i);
  assert.match(unknown.detail, new RegExp(hash));
  assert.match(unknown.detail, /mainnet/i);

  const confirming = submission.pendingTransactionPresentation({
    hash,
    network: "testnet",
    label: "Payment",
    status: "confirming",
  });
  assert.match(confirming.title, /confirming/i);
  assert.doesNotMatch(confirming.detail, /status unknown/i);
});

test("pending transaction state restores only valid deduplicated recovery handles", () => {
  assert.equal(typeof submission.parsePendingTransactions, "function");
  const hash = "ef".repeat(32);
  const restored = submission.parsePendingTransactions(JSON.stringify([
    {
      hash,
      network: "testnet",
      label: "Payment",
      status: "confirming",
      createdAt: 10,
      action: { kind: "reconcile_account_merge" },
    },
    { hash, network: "testnet", label: "Payment", status: "status_unknown", createdAt: 11 },
    { hash: "invalid", network: "mainnet", label: "Bad", status: "confirming", createdAt: 12 },
  ]));

  assert.deepEqual(restored, [{
    hash,
    network: "testnet",
    label: "Payment",
    status: "confirming",
    createdAt: 10,
    action: { kind: "reconcile_account_merge" },
  }]);
  assert.deepEqual(submission.parsePendingTransactions("not json"), []);
});

test("current pending recovery survives browser close without reading POC session state", () => {
  assert.equal(typeof submission.loadDurablePendingTransactions, "function");
  assert.equal(typeof submission.persistPendingTransactionQueue, "function");
  assert.equal(typeof submission.clearDurablePendingTransactions, "function");
  const durableKey = "wallet.pending-transactions.v2";
  const durableHash = "d1".repeat(32);
  const durable = memoryStorage();
  const record = {
    hash: durableHash,
    network: "mainnet",
    label: "Swap",
    status: "confirming",
    createdAt: 10,
  };
  submission.persistDurablePendingTransaction(durable, durableKey, record);

  assert.deepEqual(submission.loadDurablePendingTransactions(durable, durableKey), [record]);
  submission.clearDurablePendingTransactions(durable, durableKey);
  assert.equal(durable.getItem(durableKey), null);
});

test("prepared tracking survives a simulated crash with its exact expiry", () => {
  assert.equal(typeof submission.pendingTransactionFromPrepared, "function");
  const hash = "ed".repeat(32);
  const prepared = { hash, network: "testnet", expiresAt: 2_000_000_000 };
  const pending = submission.pendingTransactionFromPrepared(prepared, "Payment", undefined, 10);
  const storage = memoryStorage();
  storage.setItem("pending", JSON.stringify([pending]));

  assert.deepEqual(submission.parsePendingTransactions(storage.getItem("pending")), [pending]);
  assert.equal(pending.status, "status_unknown");
  assert.equal(pending.expiresAt, prepared.expiresAt);

  const sanitized = submission.parsePendingTransactions(JSON.stringify([
    { ...pending, hash: "ee".repeat(32), expiresAt: -1 },
    { ...pending, hash: "ef".repeat(32), expiresAt: Number.MAX_SAFE_INTEGER + 1 },
  ]));
  assert.equal("expiresAt" in sanitized[0], false);
  assert.equal("expiresAt" in sanitized[1], false);
});

test("different tabs persist pending recovery records without replacing each other", () => {
  assert.equal(typeof submission.persistDurablePendingTransaction, "function");
  assert.equal(typeof submission.removeDurablePendingTransaction, "function");
  const durable = memoryStorage();
  const first = submission.pendingTransactionFromPrepared(
    { hash: "a1".repeat(32), network: "mainnet", expiresAt: 2_000_000_000 },
    "Payment",
    undefined,
    10,
  );
  const second = submission.pendingTransactionFromPrepared(
    { hash: "b2".repeat(32), network: "testnet", expiresAt: 2_000_000_100 },
    "Swap",
    undefined,
    11,
  );

  // These writes model two tabs that hydrated before either transaction began.
  submission.persistDurablePendingTransaction(durable, "pending", first);
  submission.persistDurablePendingTransaction(durable, "pending", second);
  assert.deepEqual(
    submission.loadDurablePendingTransactions(durable, "pending"),
    [first, second],
  );

  submission.removeDurablePendingTransaction(durable, "pending", first);
  assert.deepEqual(
    submission.loadDurablePendingTransactions(durable, "pending"),
    [second],
  );
});

test("definite rejection removes provisional tracking and allows retry", () => {
  assert.equal(typeof submission.removeTrackedTransaction, "function");
  const prepared = { hash: "f0".repeat(32), network: "mainnet", expiresAt: 100 };
  const pending = submission.pendingTransactionFromPrepared(prepared, "Swap", undefined, 1);
  const provisional = submission.trackPendingTransaction({ pending: [], resolutions: {} }, pending);
  assert.equal(
    submission.trackedEnvelopeSubmissionStatus("not-xdr", "mainnet", provisional),
    null,
  );

  const cleared = submission.removeTrackedTransaction(provisional, prepared);
  assert.deepEqual(cleared, { pending: [], resolutions: {} });
  const retry = submission.trackPendingTransaction(cleared, pending);
  assert.equal(retry.pending.length, 1);

  const accepted = submission.pendingTransactionFromSubmission({
    hash: prepared.hash,
    network: prepared.network,
    status: "accepted",
  }, "Swap");
  assert.equal(
    submission.trackPendingTransaction(provisional, accepted).pending[0].status,
    "confirming",
    "accepted certainty must upgrade a provisional unknown monotonically",
  );
});

test("post-response storage failure preserves the accepted result and recovery handle", async () => {
  assert.equal(typeof submission.runPreparedBroadcast, "function");
  const prepared = {
    hash: "7".repeat(64),
    network: "testnet",
    expiresAt: 1_800_000_000,
  };
  const events = [];

  const result = await submission.runPreparedBroadcast({
    broadcast: async (onPrepared) => {
      await onPrepared(prepared);
      events.push("post-return");
      return { status: "accepted" };
    },
    prepare: () => events.push("persist provisional recovery"),
    discard: () => events.push("discard"),
    finalize: () => {
      events.push("persist accepted status");
      throw new Error("local storage quota exceeded");
    },
  });
  assert.deepEqual(result, { status: "accepted" });
  assert.deepEqual(events, [
    "persist provisional recovery",
    "post-return",
    "persist accepted status",
  ]);

  events.length = 0;
  await assert.rejects(
    submission.runPreparedBroadcast({
      broadcast: async (onPrepared) => {
        onPrepared(prepared);
        throw new Error("definite rejection");
      },
      prepare: () => events.push("persist"),
      discard: () => events.push("discard"),
      finalize: () => events.push("finalize"),
    }),
    /definite rejection/,
  );
  assert.deepEqual(events, ["persist", "discard"]);
});

test("broadcast waits for durable domain intent before POST and journals definite rejection", async () => {
  const prepared = {
    hash: "8".repeat(64),
    network: "testnet",
    expiresAt: 1_800_000_000,
  };
  const events = [];

  await assert.rejects(
    submission.runPreparedBroadcast({
      broadcast: async (onPrepared) => {
        events.push("signed");
        await onPrepared(prepared);
        events.push("post");
        throw new Error("definite rejection");
      },
      prepare: async () => {
        await Promise.resolve();
        events.push("persist-intent");
      },
      discard: async () => {
        await Promise.resolve();
        events.push("record-rejection");
      },
      finalize: () => events.push("finalize"),
    }),
    /definite rejection/,
  );
  assert.deepEqual(events, [
    "signed",
    "persist-intent",
    "post",
    "record-rejection",
  ]);

  events.length = 0;
  const result = await submission.runPreparedBroadcast({
    broadcast: async (onPrepared) => {
      await onPrepared(prepared);
      events.push("post");
      return { status: "accepted" };
    },
    prepare: async () => events.push("persist-intent"),
    discard: async () => events.push("record-rejection"),
    finalize: () => {
      events.push("finalize");
      throw new Error("result persistence failed");
    },
  });
  assert.deepEqual(result, { status: "accepted" });
  assert.deepEqual(events, ["persist-intent", "post", "finalize"]);
});

test("expired pending envelopes unlock only after authoritative not-found", () => {
  assert.equal(typeof submission.resolutionForExpiredLookup, "function");
  assert.equal(submission.resolutionForExpiredLookup("confirmed"), true);
  assert.equal(submission.resolutionForExpiredLookup("failed"), false);
  assert.equal(submission.resolutionForExpiredLookup("not_found"), false);
  assert.equal(submission.resolutionForExpiredLookup("unavailable"), null);
});

test("wallet submission tracking is shared, persistent, and preserves unknown status", () => {
  const source = readFileSync(
    new URL("../src/hooks/useWallet.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /PendingTransaction/);
  assert.match(
    source,
    /loadDurablePendingTransactions\(\s*window\.localStorage,\s*PENDING_TX_STORAGE_KEY/,
  );
  assert.doesNotMatch(source, /loadDurable(?:PendingTransactions|MergeReconciliations)\([^)]*sessionStorage/);
  assert.match(source, /persistDurablePendingTransaction\(\s*window\.localStorage/);
  assert.match(source, /removeDurablePendingTransaction\(\s*window\.localStorage/);
  assert.match(source, /event\.key\?\.startsWith\(pendingTransactionStoragePrefix/);
  assert.doesNotMatch(
    source,
    /window\.sessionStorage\.setItem\(\s*PENDING_TX_STORAGE_KEY/,
  );
  assert.match(source, /trackPendingTransaction/);
  assert.match(source, /function trackSubmission|const trackSubmission/);
  assert.ok(
    (source.match(/runTrackedBroadcast\(/g) ?? []).length >= 10,
    "every broadcast flow must share the pre-submit preparation boundary",
  );
  assert.match(source, /prepareSubmissionTracking/);
  assert.match(source, /discardPreparedSubmission/);
  assert.match(source, /applyTransactionPoll/);
  assert.match(source, /submissionResolutions/);
  assert.match(source, /submissionStatus/);
  assert.match(source, /loadDurableMergeReconciliations\([\s\S]*window\.localStorage/);
  assert.doesNotMatch(
    source,
    /persistMergeRecoveryForSubmission/,
    "post-response tracking must not repeat the pre-POST durable merge write",
  );
  assert.ok(
    (source.match(/clearDurableMergeReconciliations\(/g) ?? []).length >= 2,
    "wallet reset and backup restore must clear durable merge recovery state",
  );
  assert.ok(
    (source.match(/clearDurablePendingTransactions\(/g) ?? []).length >= 2,
    "wallet reset and backup restore must clear durable transaction recovery state",
  );
  assert.ok(
    (source.match(/isTrackingTaskCurrent\(/g) ?? []).length >= 4,
    "late poll and merge results must be guarded by generation and current queue identity",
  );
  assert.ok(
    (source.match(/invalidateTrackingTasks\(\)/g) ?? []).length >= 2,
    "wallet reset and backup restore must cancel scheduled recovery work",
  );
  const polling = source.split("const pollPending = useCallback")[1]?.split("useEffect(() => {")[0];
  assert.ok(polling, "expected pending transaction poller");
  assert.ok(
    polling.indexOf("persistMergeReconciliation(") <
      polling.indexOf("commitTransactionTracking("),
    "confirmed merge recovery must be persisted synchronously before pending state is dropped",
  );
  assert.ok(
    polling.indexOf("persistMergeReconciliationQueue(") <
      polling.indexOf("commitTransactionTracking("),
    "expired/failed merge recovery must be removed durably before its generic lock is dropped",
  );
  assert.doesNotMatch(source, /const unknown = \{ \.\.\.transaction, status: "status_unknown"/);
});

test("active transaction flows render status unknown without claiming success", () => {
  const send = readFileSync(new URL("../src/components/SendModal.tsx", import.meta.url), "utf8");
  const batch = readFileSync(
    new URL("../src/components/BatchSendModal.tsx", import.meta.url),
    "utf8",
  );
  const swap = readFileSync(new URL("../src/components/SwapPage.tsx", import.meta.url), "utf8");
  const settings = readFileSync(
    new URL("../src/components/SettingsPage.tsx", import.meta.url),
    "utf8",
  );
  const multisig = readFileSync(
    new URL("../src/components/MultiSigStudioModal.tsx", import.meta.url),
    "utf8",
  );

  for (const source of [send, batch, swap, settings, multisig]) {
    assert.match(source, /status_unknown/);
  }
  assert.match(send, /Do not resubmit blindly/i);
  assert.match(batch, /Do not resubmit blindly/i);
  assert.match(swap, /Do not resubmit blindly/i);
  assert.match(settings, /do not resubmit blindly/i);
  assert.match(multisig, /do not resubmit blindly/i);
});

test("the send dialog cannot be dismissed while signing or broadcasting", () => {
  const send = readFileSync(new URL("../src/components/SendModal.tsx", import.meta.url), "utf8");
  assert.match(send, /onBusyChange\(stage === "sending"\)/);
  assert.match(send, /<Modal open onClose=\{requestClose\} wide dismissable=\{!surfaceBusy\}>/);
  assert.match(send, /closeDisabled=\{surfaceBusy\}/);
  assert.match(send, /if \(next === sendMode \|\| surfaceBusy\) return/);
  assert.match(send, /onClose=\{stage === "sending" \? undefined : onClose\}/);
});

test("every locked transaction flow consumes shared confirmed and failed resolutions", () => {
  const componentNames = [
    "SendModal.tsx",
    "BatchSendModal.tsx",
    "SwapPage.tsx",
    "SettingsPage.tsx",
    "AddAssetModal.tsx",
    "AssetDetailModal.tsx",
    "MultiSigStudioModal.tsx",
  ];
  for (const name of componentNames) {
    const source = readFileSync(new URL(`../src/components/${name}`, import.meta.url), "utf8");
    assert.match(source, /submissionStatus/, `${name} must consume shared resolution state`);
    assert.match(source, /(?:===|!==) "failed"/, `${name} must unlock or retry after on-chain failure`);
  }

  const send = readFileSync(new URL("../src/components/SendModal.tsx", import.meta.url), "utf8");
  const batch = readFileSync(
    new URL("../src/components/BatchSendModal.tsx", import.meta.url),
    "utf8",
  );
  assert.match(send, /Payment Confirmed/);
  assert.match(send, /Payment Accepted/);
  assert.match(batch, /Batch Confirmed/);
  assert.match(batch, /Batch Accepted/);
});

test("the selective airdrop flow cannot immediately resubmit a pending claim", () => {
  const dashboard = readFileSync(
    new URL("../src/components/Dashboard.tsx", import.meta.url),
    "utf8",
  );
  const review = readFileSync(
    new URL("../src/components/ClaimableBalancesModal.tsx", import.meta.url),
    "utf8",
  );
  assert.match(dashboard, /disabled=\{pendingAirdropClaim\}/);
  assert.match(review, /pendingAirdropClaim/);
  assert.match(
    review,
    /disabled=\{[\s\S]*?pendingAirdropClaim[\s\S]*?Boolean\(pendingSubmission\)/,
  );
});

test("asset-detail submission status is visible even without an error", () => {
  assert.equal(typeof submission.assetDetailSubmissionView, "function");
  const accepted = {
    hash: "10".repeat(32),
    network: "testnet",
    status: "accepted",
  };
  const acceptedView = submission.assetDetailSubmissionView(null, accepted, "accepted");
  assert.equal(acceptedView.error, null);
  assert.match(acceptedView.notice?.message ?? "", /accepted and confirming/i);

  const unknownView = submission.assetDetailSubmissionView(null, accepted, "status_unknown");
  assert.equal(unknownView.error, null);
  assert.match(unknownView.notice?.message ?? "", /do not resubmit blindly/i);
  assert.equal(unknownView.notice?.tone, "warn");
});

test("confirmed multisig configuration unlocks while unresolved configuration stays locked", () => {
  assert.equal(typeof submission.configSubmissionAfterResolution, "function");
  const current = {
    hash: "20".repeat(32),
    network: "mainnet",
    status: "accepted",
  };
  assert.equal(submission.configSubmissionAfterResolution(current, "confirmed"), null);
  assert.equal(submission.configSubmissionAfterResolution(current, "failed"), null);
  assert.equal(submission.configSubmissionAfterResolution(current, "accepted"), current);
  assert.equal(submission.configSubmissionAfterResolution(current, "status_unknown"), current);
});

test("shared transaction tracking blocks an exact envelope across modal remounts", () => {
  assert.equal(typeof submission.trackedEnvelopeSubmissionStatus, "function");
  assert.equal(typeof submission.approvalSubmissionGuard, "function");
  const transaction = buildSignedTransaction();
  const xdr = transaction.toXdr();
  const hash = canonicalHash(transaction);
  const accepted = {
    hash,
    network: "testnet",
    label: "Co-signed transaction",
    status: "confirming",
    createdAt: 1,
  };
  const tracking = { pending: [accepted], resolutions: {} };

  // Both calls intentionally have no component-local attempt state: this is
  // the invariant used after closing and reopening the modal.
  const beforeUnmount = submission.trackedEnvelopeSubmissionStatus(xdr, "testnet", tracking);
  const afterRemount = submission.trackedEnvelopeSubmissionStatus(xdr, "testnet", tracking);
  assert.equal(beforeUnmount, "accepted");
  assert.equal(afterRemount, "accepted");
  assert.match(
    submission.approvalSubmissionGuard(afterRemount) ?? "",
    /already accepted|still being tracked/i,
  );

  const unknownTracking = {
    pending: [{ ...accepted, status: "status_unknown" }],
    resolutions: {},
  };
  assert.match(
    submission.approvalSubmissionGuard(
      submission.trackedEnvelopeSubmissionStatus(xdr, "testnet", unknownTracking),
    ) ?? "",
    /do not resubmit/i,
  );

  const identity = submission.transactionIdentity(accepted);
  const confirmedTracking = {
    pending: [],
    resolutions: {
      [identity]: { hash, network: "testnet", status: "confirmed", resolvedAt: 2 },
    },
  };
  assert.match(
    submission.approvalSubmissionGuard(
      submission.trackedEnvelopeSubmissionStatus(xdr, "testnet", confirmedTracking),
    ) ?? "",
    /already confirmed/i,
  );

  const failedTracking = {
    pending: [],
    resolutions: {
      [identity]: { hash, network: "testnet", status: "failed", resolvedAt: 2 },
    },
  };
  assert.equal(
    submission.approvalSubmissionGuard(
      submission.trackedEnvelopeSubmissionStatus(xdr, "testnet", failedTracking),
    ),
    null,
  );
  assert.equal(typeof submission.trackPendingTransaction, "function");
  const retryTracking = submission.trackPendingTransaction(failedTracking, accepted);
  assert.equal(
    submission.trackedEnvelopeSubmissionStatus(xdr, "testnet", retryTracking),
    "accepted",
    "a new tracked retry must supersede its prior failed resolution",
  );
  assert.equal(
    submission.trackedEnvelopeSubmissionStatus(xdr, "mainnet", tracking),
    null,
  );

  const component = readFileSync(
    new URL("../src/components/MultiSigStudioModal.tsx", import.meta.url),
    "utf8",
  );
  assert.match(component, /envelopeSubmissionStatus\(xdrInput, network\)/);
  assert.doesNotMatch(component, /approvalSubmissionAttempt/);
});

test("persisted merge reconciliation stores no local account authority", () => {
  assert.equal(typeof submission.parseMergeReconciliations, "function");
  assert.equal(typeof submission.serializeMergeReconciliations, "function");
  const hash = "40".repeat(32);
  const restored = submission.parseMergeReconciliations(JSON.stringify([{
    hash,
    network: "testnet",
    accountId: "attacker-selected-account",
    sourcePublicKey: "attacker-selected-source",
    status: "removed",
    expiresAt: 1_900_000_000,
  }]));

  assert.deepEqual(restored, [{
    hash,
    network: "testnet",
    status: "pending",
    expiresAt: 1_900_000_000,
  }]);
  const serialized = submission.serializeMergeReconciliations(restored);
  assert.doesNotMatch(serialized, /accountId|sourcePublicKey|removed/);
  assert.match(serialized, /1900000000/);
  assert.deepEqual(submission.parseMergeReconciliations(JSON.stringify([{
    hash: "3f".repeat(32),
    network: "mainnet",
    expiresAt: Number.MAX_SAFE_INTEGER + 1,
  }])), [{ hash: "3f".repeat(32), network: "mainnet", status: "pending" }]);

  const pending = submission.parsePendingTransactions(JSON.stringify([{
    hash,
    network: "testnet",
    label: "Account merge",
    status: "confirming",
    createdAt: 1,
    action: { kind: "reconcile_account_merge", accountId: "attacker-selected-account" },
  }]));
  assert.deepEqual(pending[0].action, { kind: "reconcile_account_merge" });
});

test("confirmed merge reconciliation is durably queued before local processing", () => {
  assert.equal(typeof submission.persistMergeReconciliation, "function");
  const stored = new Map();
  const storage = {
    getItem(key) {
      return stored.get(key) ?? null;
    },
    setItem(key, value) {
      stored.set(key, value);
    },
  };
  const key = "merge-recovery";
  const first = {
    hash: "41".repeat(32),
    network: "testnet",
    status: "pending",
    expiresAt: 1_900_000_000,
  };
  const second = { hash: "42".repeat(32), network: "mainnet", status: "pending" };

  assert.deepEqual(submission.persistMergeReconciliation(storage, key, first), [first]);
  assert.deepEqual(submission.persistMergeReconciliation(storage, key, second), [first, second]);
  assert.deepEqual(submission.parseMergeReconciliations(stored.get(key)), [first, second]);
});

test("expired merge recovery follows authoritative lookup and stops unavailable loops", async () => {
  assert.equal(typeof submission.reconcileMergeRecovery, "function");
  const sourcePublicKey = Keypair.random().publicKey();
  const accounts = [
    { id: "source", publicKey: sourcePublicKey },
    { id: "other", publicKey: Keypair.random().publicKey() },
  ];
  const expired = {
    hash: "42".repeat(32),
    network: "testnet",
    status: "pending",
    expiresAt: 100,
  };
  let inspected = 0;
  const inspect = async () => {
    inspected += 1;
    return { sourcePublicKey, sourceAccountExists: false };
  };

  const notFound = await submission.reconcileMergeRecovery(
    expired,
    accounts,
    101_000,
    async () => "not_found",
    inspect,
    () => assert.fail("expired not-found must not remove an account"),
  );
  assert.deepEqual(notFound, { outcome: "discarded", record: null });
  assert.equal(inspected, 0);

  const unavailable = await submission.reconcileMergeRecovery(
    expired,
    accounts,
    101_000,
    async () => "unavailable",
    inspect,
    () => assert.fail("unavailable lookup must not remove an account"),
  );
  assert.equal(unavailable.outcome, "status_unknown");
  assert.equal(unavailable.record?.status, "status_unknown");
  assert.equal(inspected, 0);

  const removed = [];
  const confirmed = await submission.reconcileMergeRecovery(
    expired,
    accounts,
    101_000,
    async () => "confirmed",
    inspect,
    (accountId) => removed.push(accountId),
  );
  assert.equal(confirmed.outcome, "removed");
  assert.deepEqual(removed, ["source"]);
  assert.equal(inspected, 1);

  const legacy = { hash: "43".repeat(32), network: "testnet", status: "pending" };
  const legacyUnknown = await submission.reconcileMergeRecovery(
    legacy,
    accounts,
    101_000,
    async () => "not_found",
    inspect,
    () => assert.fail("expiry-less legacy record must stay fail closed"),
  );
  assert.equal(legacyUnknown.outcome, "status_unknown");
});

test("discarding a merge recovery is storage-first and unlocks its flow", () => {
  assert.equal(typeof submission.persistMergeReconciliationQueue, "function");
  const key = "merge-recovery.v2";
  const record = {
    hash: "44".repeat(32),
    network: "testnet",
    status: "pending",
    expiresAt: 100,
  };
  const storage = memoryStorage({ [key]: submission.serializeMergeReconciliations([record]) });
  const remaining = submission.persistMergeReconciliationQueue(storage, key, []);
  assert.deepEqual(remaining, []);
  assert.equal(storage.getItem(key), null);
  assert.equal(
    remaining.some((candidate) => submission.transactionIdentity(candidate) ===
      submission.transactionIdentity(record)),
    false,
    "Settings derives its merge lock from this queue",
  );
});

test("current merge reconciliation survives browser close without session migration", () => {
  assert.equal(typeof submission.loadDurableMergeReconciliations, "function");
  assert.equal(typeof submission.clearDurableMergeReconciliations, "function");
  const localKey = "merge-recovery.v2";
  const localHash = "43".repeat(32);
  const local = memoryStorage({
    [localKey]: JSON.stringify([{ hash: localHash, network: "mainnet" }]),
  });
  const restored = submission.loadDurableMergeReconciliations(local, localKey);
  assert.deepEqual(restored, [
    { hash: localHash, network: "mainnet", status: "pending" },
  ]);
  assert.deepEqual(
    submission.loadDurableMergeReconciliations(local, localKey),
    restored,
  );

  submission.clearDurableMergeReconciliations(local, localKey);
  assert.equal(local.getItem(localKey), null);
});

test("an unresolved account merge queues a durable authority-free recovery handle", () => {
  assert.equal(typeof submission.persistMergeRecoveryForSubmission, "function");
  const storage = memoryStorage();
  const key = "merge-recovery.v2";
  const hash = "45".repeat(32);
  const record = submission.persistMergeRecoveryForSubmission(
    storage,
    key,
    { hash, network: "mainnet", status: "status_unknown" },
    { kind: "reconcile_account_merge" },
  );

  assert.deepEqual(record, { hash, network: "mainnet", status: "pending" });
  assert.equal(
    storage.getItem(key),
    JSON.stringify([{ hash, network: "mainnet" }]),
  );
  assert.equal(
    submission.persistMergeRecoveryForSubmission(
      storage,
      key,
      { hash: "46".repeat(32), network: "testnet", status: "accepted" },
      undefined,
    ),
    null,
  );
});

test("unverified merge recovery presentation never claims on-chain confirmation", () => {
  assert.equal(typeof submission.mergeReconciliationPresentation, "function");
  for (const status of ["pending", "retry", "status_unknown"]) {
    const presentation = submission.mergeReconciliationPresentation(status);
    assert.equal(presentation.verified, false);
    assert.doesNotMatch(presentation.message, /confirm(?:ed|ation)?/i);
    assert.match(presentation.message, /track|verif|retry|checking/i);
    assert.equal(presentation.manualCheck, status === "status_unknown");
  }

  for (const status of ["last_account", "source_active"]) {
    const presentation = submission.mergeReconciliationPresentation(status);
    assert.equal(presentation.verified, true);
    assert.match(presentation.message, /verified|confirmed/i);
  }

  const restored = submission.parseMergeReconciliations(JSON.stringify([{
    hash: "46".repeat(32),
    network: "mainnet",
  }]));
  assert.equal(restored[0].status, "pending");
  assert.doesNotMatch(
    submission.mergeReconciliationPresentation(restored[0].status).message,
    /confirm(?:ed|ation)?/i,
  );

  const settings = readFileSync(
    new URL("../src/components/SettingsPage.tsx", import.meta.url),
    "utf8",
  );
  const wallet = readFileSync(
    new URL("../src/hooks/useWallet.tsx", import.meta.url),
    "utf8",
  );
  assert.match(settings, /mergeReconciliationPresentation\(activeMergeReconciliation\.status\)/);
  assert.match(settings, /retryMergeReconciliation\(activeMergeReconciliation\)/);
  assert.match(wallet, /mergeReconciliationPresentation\("retry"\)\.message/);
  assert.match(wallet, /record\.status === "status_unknown"/);
  assert.doesNotMatch(settings, /merge is confirmed\. The wallet is verifying/i);
  assert.doesNotMatch(wallet, /Merge confirmed; local reconciliation will retry/i);
});

test("reset or queue removal invalidates asynchronous transaction recovery work", () => {
  assert.equal(typeof submission.isTrackingTaskCurrent, "function");
  const transaction = { hash: "47".repeat(32), network: "testnet" };
  const queued = [{ ...transaction, label: "Account merge", status: "confirming", createdAt: 1 }];

  assert.equal(submission.isTrackingTaskCurrent(3, 3, transaction, queued), true);
  assert.equal(
    submission.isTrackingTaskCurrent(3, 4, transaction, queued),
    false,
    "a wallet reset/restore generation change must invalidate the old task",
  );
  assert.equal(
    submission.isTrackingTaskCurrent(3, 3, transaction, []),
    false,
    "removed queue entries must not be revived by a late async result",
  );
});

test("merge reconciliation retries a failed removal and clears only after success", async () => {
  assert.equal(typeof submission.reconcileConfirmedMerge, "function");
  const sourcePublicKey = Keypair.random().publicKey();
  const otherPublicKey = Keypair.random().publicKey();
  const record = { hash: "50".repeat(32), network: "testnet", status: "pending" };
  const accounts = [
    { id: "source-account", publicKey: sourcePublicKey },
    { id: "other-account", publicKey: otherPublicKey },
  ];
  let removals = 0;
  const inspect = async () => ({ sourcePublicKey, sourceAccountExists: false });
  const failRemoval = () => {
    removals += 1;
    throw new Error("vault write failed");
  };

  const failed = await submission.reconcileConfirmedMerge(record, accounts, inspect, failRemoval);
  assert.equal(failed.outcome, "retry");
  assert.equal(failed.record?.status, "retry");
  assert.equal(removals, 1);

  const succeeded = await submission.reconcileConfirmedMerge(
    failed.record,
    accounts,
    inspect,
    (accountId) => {
      removals += 1;
      assert.equal(accountId, "source-account");
    },
  );
  assert.equal(succeeded.outcome, "removed");
  assert.equal(succeeded.record, null);
  assert.equal(removals, 2);
});

test("merge reconciliation never silently removes the last local account", async () => {
  const sourcePublicKey = Keypair.random().publicKey();
  let removed = false;
  const result = await submission.reconcileConfirmedMerge(
    { hash: "60".repeat(32), network: "mainnet", status: "pending" },
    [{ id: "only-account", publicKey: sourcePublicKey }],
    async () => ({ sourcePublicKey, sourceAccountExists: false }),
    () => {
      removed = true;
    },
  );

  assert.equal(removed, false);
  assert.equal(result.outcome, "last_account");
  assert.equal(result.record?.status, "last_account");
  assert.equal(result.record?.sourcePublicKey, sourcePublicKey);
});

test("merge reconciliation refuses a replay when the source account is active again", async () => {
  const sourcePublicKey = Keypair.random().publicKey();
  let removed = false;
  const result = await submission.reconcileConfirmedMerge(
    { hash: "61".repeat(32), network: "mainnet", status: "pending" },
    [
      { id: "source-account", publicKey: sourcePublicKey },
      { id: "other-account", publicKey: Keypair.random().publicKey() },
    ],
    async () => ({ sourcePublicKey, sourceAccountExists: true }),
    () => {
      removed = true;
    },
  );

  assert.equal(removed, false);
  assert.equal(result.outcome, "source_active");
  assert.equal(result.record?.status, "source_active");
});

test("confirmed merge inspection derives the source from the on-chain envelope", async (t) => {
  assert.equal(typeof walletApi.inspectConfirmedAccountMerge, "function");
  const source = Keypair.random();
  const transaction = new TransactionBuilder(new Account(source.publicKey(), "0"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.accountMerge({ destination: Keypair.random().publicKey() }))
    .setTimeout(180)
    .build();
  transaction.sign(source);
  const hash = canonicalHash(transaction);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    calls += 1;
    if (calls === 1) {
      assert.match(String(url), new RegExp(`/transactions/${hash}$`));
      return new Response(JSON.stringify({
        hash,
        successful: true,
        envelope_xdr: transaction.toXdr(),
      }), { status: 200 });
    }
    assert.match(String(url), new RegExp(`/accounts/${source.publicKey()}$`));
    return notFoundResponse();
  });

  assert.deepEqual(
    await walletApi.inspectConfirmedAccountMerge("testnet", hash, 20),
    { sourcePublicKey: source.publicKey(), sourceAccountExists: false },
  );
  assert.equal(calls, 2);
});

test("confirmed merge inspection rejects mismatched response and envelope hashes", async (t) => {
  const source = Keypair.random();
  const transaction = new TransactionBuilder(new Account(source.publicKey(), "0"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.accountMerge({ destination: Keypair.random().publicKey() }))
    .setTimeout(180)
    .build();
  transaction.sign(source);
  const hash = canonicalHash(transaction);
  const other = buildSignedTransaction();
  let responseMode = "response";
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    return new Response(JSON.stringify({
      hash: responseMode === "response" ? "ff".repeat(32) : hash,
      successful: true,
      envelope_xdr: responseMode === "response" ? transaction.toXdr() : other.toXdr(),
    }), { status: 200 });
  });

  assert.equal(await walletApi.inspectConfirmedAccountMerge("testnet", hash, 20), null);
  responseMode = "envelope";
  assert.equal(await walletApi.inspectConfirmedAccountMerge("testnet", hash, 20), null);
  assert.equal(calls, 2, "invalid evidence must not trigger an account lookup");
});

test("confirmed merge inspection rejects wrong and multiple operations", async (t) => {
  const source = Keypair.random();
  const wrong = buildSignedTransaction();
  const multiple = new TransactionBuilder(new Account(source.publicKey(), "0"), {
    fee: "200",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.accountMerge({ destination: Keypair.random().publicKey() }))
    .addOperation(Operation.payment({
      destination: Keypair.random().publicKey(),
      asset: Asset.native(),
      amount: "1",
    }))
    .setTimeout(180)
    .build();
  multiple.sign(source);
  const records = [wrong, multiple];
  let index = 0;
  t.mock.method(globalThis, "fetch", async () => {
    const transaction = records[index++];
    return new Response(JSON.stringify({
      hash: canonicalHash(transaction),
      successful: true,
      envelope_xdr: transaction.toXdr(),
    }), { status: 200 });
  });

  assert.equal(
    await walletApi.inspectConfirmedAccountMerge("testnet", canonicalHash(wrong), 20),
    null,
  );
  assert.equal(
    await walletApi.inspectConfirmedAccountMerge("testnet", canonicalHash(multiple), 20),
    null,
  );
  assert.equal(index, 2);
});

test("confirmed merge inspection uses the operation-level effective source", async (t) => {
  const transactionSource = Keypair.random();
  const operationSource = Keypair.random();
  const transaction = new TransactionBuilder(new Account(transactionSource.publicKey(), "0"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.accountMerge({
      source: operationSource.publicKey(),
      destination: Keypair.random().publicKey(),
    }))
    .setTimeout(180)
    .build();
  transaction.sign(transactionSource, operationSource);
  const hash = canonicalHash(transaction);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({
        hash,
        successful: true,
        envelope_xdr: transaction.toXdr(),
      }), { status: 200 });
    }
    assert.match(String(url), new RegExp(`/accounts/${operationSource.publicKey()}$`));
    return notFoundResponse();
  });

  assert.deepEqual(
    await walletApi.inspectConfirmedAccountMerge("testnet", hash, 20),
    { sourcePublicKey: operationSource.publicKey(), sourceAccountExists: false },
  );
});

test("confirmed merge inspection supports fee-bump envelopes and detects an active source", async (t) => {
  const source = Keypair.random();
  const feeSource = Keypair.random();
  const inner = new TransactionBuilder(new Account(source.publicKey(), "0"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.accountMerge({ destination: Keypair.random().publicKey() }))
    .setTimeout(180)
    .build();
  inner.sign(source);
  const feeBump = TransactionBuilder.buildFeeBumpTransaction(
    feeSource.publicKey(),
    "100",
    inner,
    Networks.TESTNET,
  );
  feeBump.sign(feeSource);
  const hash = canonicalHash(feeBump);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({
        hash,
        successful: true,
        envelope_xdr: feeBump.toXdr(),
      }), { status: 200 });
    }
    assert.match(String(url), new RegExp(`/accounts/${source.publicKey()}$`));
    return new Response(JSON.stringify({ account_id: source.publicKey() }), { status: 200 });
  });

  assert.deepEqual(
    await walletApi.inspectConfirmedAccountMerge("testnet", hash, 20),
    { sourcePublicKey: source.publicKey(), sourceAccountExists: true },
  );
});
