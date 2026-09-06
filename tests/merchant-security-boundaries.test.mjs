import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { Keypair } from "@stellar/stellar-sdk";
import * as vault from "../src/lib/vault.ts";
import * as permissions from "../src/lib/merchant/permissions.ts";
import * as operators from "../src/lib/merchant/operators.ts";
import * as setup from "../src/lib/merchant/setup.ts";
import * as refunds from "../src/lib/merchant/refunds.ts";
import * as money from "../src/lib/merchant/money.ts";
import * as submissions from "../src/lib/submission.ts";
import { resetMerchantRecoveryStore } from "../src/lib/merchant/recovery.ts";
import { createMerchantPinCredential } from "../src/lib/merchant/pin.ts";
import { MerchantStorageError } from "../src/lib/merchant/commit.ts";

import { emptyStore } from "../src/lib/merchant/defaults.ts";
import { defaultPermissionsFor } from "../src/lib/merchant/permissions.ts";
import {
  authorizeMerchantWalletExit,
  merchantExitRequired,
  merchantPageAccess,
  voidAwaitingMerchantCharge,
} from "../src/lib/merchant/security-boundaries.ts";

function member(id, role, permissionOverrides = {}) {
  return {
    id,
    name: id,
    role,
    permissions: { ...defaultPermissionsFor(role), ...permissionOverrides },
    pinDigest: null,
    pinSetAt: null,
    active: true,
  };
}

// Execute actual callbacks and their access guard, isolating only React refs
// and the delayed crypto/storage boundary. No test API is added to production.
function merchantCallback(name, context, source = "../src/hooks/useMerchant.tsx") {
  const file = new URL(source, import.meta.url);
  const parsed = ts.createSourceFile(file.pathname, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === name && ts.isCallExpression(node.initializer)) {
      expression = node.initializer.arguments[0].getText(parsed);
    }
    if (name === "merchantWriterEffect" && ts.isCallExpression(node) && node.expression.getText(parsed) === "useEffect" &&
      node.arguments[0].getText(parsed).includes('"stellarkey.merchant.writer.v1"')) {
      expression = node.arguments[0].getText(parsed);
    }
    if (name === "refundReconciliationEffect" && ts.isCallExpression(node) && node.expression.getText(parsed) === "useEffect" &&
      node.arguments[0].getText(parsed).includes("refund.transactionHash")) {
      expression = node.arguments[0].getText(parsed);
    }
    if (name === "pendingStorageEffect" && ts.isCallExpression(node) && node.expression.getText(parsed) === "useEffect" &&
      node.arguments[0].getText(parsed).includes("const refreshPendingTransactions")) {
      expression = node.arguments[0].getText(parsed);
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.ok(expression, "The real merchant callback must exist");
  return vm.runInNewContext(ts.transpileModule(`(${expression})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, context);
}

async function merchantSession() {
  const values = new Map();
  globalThis.window = { localStorage: {
    get length() { return values.size; },
    key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  } };
  vault.lockVault();
  const password = "synthetic merchant correct horse battery staple";
  const { account } = await vault.initializeVault(password, { secret: Keypair.random().secret() });
  const lifetime = { current: 0 };
  const resetting = { current: false };
  return {
    account,
    lifetime,
    resetting,
    replace: async () => { vault.lockVault(); await vault.unlockVault(password); },
    revoke: () => { lifetime.current += 1; },
    capture: () => merchantCallback("captureMerchantAccess", {
      ...vault, MerchantStorageError,
      phase: "unlocked", sessionSnapshot: vault.getSessionSnapshot(),
      merchantMountedRef: { current: true }, merchantResettingRef: resetting,
      merchantLifetimeRef: lifetime,
    }),
  };
}

function deferred() {
  let release;
  let entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  const promise = new Promise(resolve => { release = resolve; });
  return { waiting, release, run: () => { entered(); return promise; } };
}

async function refundHarness() {
  const session = await merchantSession();
  const owner = member("owner", "owner");
  const payment = {
    id: "synthetic-payment", from: "synthetic-customer", amount: "10.0000000",
    asset: { code: "XLM", issuer: null },
  };
  const order = {
    id: "synthetic-order", number: 1, network: "testnet", status: "paid",
    totals: { totalMinor: 5_000 },
  };
  const charge = {
    id: "synthetic-charge", orderId: order.id, status: "paid", network: "testnet",
    amountMinor: 5_000, destination: "synthetic-receiver", payment,
  };
  const storeRef = { current: {
    ...emptyStore(), staff: [owner], activeStaffId: owner.id, orders: [order], charges: [charge],
    paymentReconciliations: [{
      id: "synthetic-surplus", orderId: order.id, invoiceId: null, chargeId: charge.id,
      network: "testnet", payment: { ...payment, id: "synthetic-extra-payment" },
      outcome: "duplicate", amountMinor: 5_000, resolution: null,
    }],
  } };
  let commits = 0;
  let commitsAfterReset = 0;
  const context = {
    ...permissions, ...refunds, ...money, Error, Date,
    captureMerchantAccess: session.capture(), storeRef,
    staffSessionId: owner.id, staffSessionIdRef: { current: owner.id }, network: "testnet",
    activeAccount: { publicKey: charge.destination }, uid: () => "synthetic-refund",
    commitStore: async update => {
      const access = context.captureMerchantAccess();
      access.assertCurrent();
      storeRef.current = typeof update === "function" ? update(storeRef.current) : update;
      commits++;
      if (session.lifetime.current > 0) commitsAfterReset++;
      access.assertCurrent();
    },
    resetMerchantRecoveryStore, storageIssueRef: { current: null },
    authorizeSensitiveAction: async () => {}, invalidateMerchantOperations: session.revoke,
    merchantResettingRef: session.resetting,
    merchantWriterLockRef: { current: "held" },
    repositoryRef: { current: { clear: async () => { throw new Error("Synthetic clear failure"); } } },
    setStorageError: () => {},
  };
  return {
    session, context, storeRef,
    commits: () => commits, commitsAfterReset: () => commitsAfterReset,
    failReset: () => assert.rejects(merchantCallback("resetRecoveryData", context)(), /could not be erased/),
    run: action => merchantCallback(action, context)(action === "refundOrder"
      ? { orderId: order.id, amountMinor: 2_000, reason: "customer_request" }
      : { paymentId: "synthetic-surplus" }),
  };
}

const acceptedRefund = { hash: "a".repeat(64), status: "accepted" };

function walletTrackingHarness() {
  let polls = 0;
  let commits = 0;
  const context = {
    ...submissions, ...vault, Error, Date, window,
    PENDING_TX_STORAGE_KEY: "synthetic.pending", MERGE_RECONCILIATION_STORAGE_KEY: "synthetic.merges",
    transactionTrackingRef: { current: { pending: [], resolutions: {} } },
    trackingTaskGeneration: { current: 0 },
    mergeReconciliationsRef: { current: [] }, mergeReconciliationTimers: { current: new Map() },
    pendingPolls: { current: new Set() }, pendingPollTimers: { current: new Map() },
    pollPendingRef: { current: async () => { polls++; } },
    accountRefreshRef: { current: async () => {} }, toast: () => {},
  };
  context.commitTransactionTracking = update => {
    commits++;
    context.transactionTrackingRef.current = update(context.transactionTrackingRef.current);
  };
  context.commitMergeReconciliations = update => {
    context.mergeReconciliationsRef.current = update(context.mergeReconciliationsRef.current);
  };
  const callback = name => merchantCallback(name, context, "../src/hooks/useWallet.tsx");
  context.prepareSubmissionTracking = callback("prepareSubmissionTracking");
  context.discardPreparedSubmission = callback("discardPreparedSubmission");
  context.trackSubmission = callback("trackSubmission");
  return {
    context, callback, run: callback("runTrackedBroadcast"), polls: () => polls, commits: () => commits,
    reload: () => submissions.loadDurablePendingTransactions(window.localStorage, context.PENDING_TX_STORAGE_KEY),
  };
}

for (const action of ["refundOrder", "refundReconciledPayment"]) {
  for (const outcome of ["accepted", "confirmed", "rejected"]) {
    test(`a current ${action} durably acknowledges only terminal outcome ${outcome}`, async () => {
      const harness = await refundHarness();
      const wallet = walletTrackingHarness();
      harness.context.acknowledgeSubmissionJournal = wallet.callback("acknowledgeSubmissionJournal");
      harness.context.send = params => wallet.run("Synthetic refund", undefined, async onPrepared => {
        await onPrepared({ ...acceptedRefund, network: "testnet", expiresAt: 1 });
        if (outcome === "rejected") throw new Error("Synthetic definite rejection");
        return { ...acceptedRefund, network: "testnet", status: outcome };
      }, result => result, params.submissionJournal, params.authorizeBeforeSigning);
      try {
        if (outcome === "rejected") await assert.rejects(harness.run(action), /Synthetic definite rejection/);
        else await harness.run(action);
        assert.equal(harness.storeRef.current.refunds[0].submissionStatus, outcome === "rejected" ? "failed" : outcome);
        assert.equal(wallet.reload().length, outcome === "accepted" ? 1 : 0);
        if (outcome === "accepted") assert.equal(wallet.reload()[0].journalPending, true);
      } finally { vault.lockVault(); }
    });
  }
  test(`a confirmed ${action} keeps its known result when optional recovery acknowledgement storage fails`, async () => {
    const harness = await refundHarness();
    const wallet = walletTrackingHarness();
    harness.context.acknowledgeSubmissionJournal = wallet.callback("acknowledgeSubmissionJournal");
    harness.context.send = params => wallet.run("Synthetic refund", undefined, async onPrepared => {
      await onPrepared({ ...acceptedRefund, network: "testnet", expiresAt: 1 });
      return { ...acceptedRefund, network: "testnet", status: "confirmed" };
    }, result => result, params.submissionJournal, params.authorizeBeforeSigning);
    const removeItem = window.localStorage.removeItem;
    window.localStorage.removeItem = key => {
      if (key.startsWith(wallet.context.PENDING_TX_STORAGE_KEY)) throw new Error("Synthetic acknowledgement storage failure");
      removeItem(key);
    };
    try {
      const result = await harness.run(action);
      assert.equal(result.submissionStatus, "confirmed");
      assert.equal(harness.storeRef.current.refunds[0].submissionStatus, "confirmed");
      assert.equal(wallet.reload().length, 1);
    } finally {
      window.localStorage.removeItem = removeItem;
      vault.lockVault();
    }
  });
}

test("an authenticated terminal refund loaded after a crash acknowledges durable recovery once without a fresh canonical result", async () => {
  const harness = await refundHarness();
  const wallet = walletTrackingHarness();
  const identity = { ...acceptedRefund, network: "testnet", expiresAt: 1 };
  harness.context.send = async params => {
    wallet.context.prepareSubmissionTracking(identity, "Synthetic refund", undefined, true);
    await params.submissionJournal.onPrepared(identity);
    return { ...identity, status: "accepted" };
  };
  try {
    await harness.run("refundOrder");
    await harness.context.commitStore(current => refunds.reconcileRefundSubmission(current, "synthetic-refund", "confirmed"));
    harness.context.ready = true;
    harness.context.submissionStatus = submission => submission.status;
    harness.context.acknowledgeSubmissionJournal = wallet.callback("acknowledgeSubmissionJournal");
    merchantCallback("refundReconciliationEffect", harness.context)();
    assert.equal(wallet.reload().length, 0);
    const after = wallet.commits();
    merchantCallback("refundReconciliationEffect", harness.context)();
    assert.equal(wallet.commits(), after);
  } finally { vault.lockVault(); }
});

test("journal acknowledgement never removes an ordinary non-journal runtime pending transaction", async () => {
  await merchantSession();
  const wallet = walletTrackingHarness();
  const identity = { ...acceptedRefund, network: "testnet", expiresAt: 1 };
  try {
    wallet.context.prepareSubmissionTracking(identity, "Synthetic ordinary transaction");
    const before = wallet.commits();
    wallet.callback("acknowledgeSubmissionJournal")(identity);
    assert.equal(wallet.context.transactionTrackingRef.current.pending.length, 1);
    assert.equal(wallet.reload().length, 1);
    assert.equal(wallet.commits(), before);
  } finally { vault.lockVault(); }
});

test("journal ownership release retains unresolved transactions, clears only canonically resolved handles, and never recreates reset records", async () => {
  await merchantSession();
  const wallet = walletTrackingHarness();
  const unknown = { ...acceptedRefund, network: "testnet", expiresAt: 1 };
  const failed = { ...unknown, hash: "b".repeat(64) };
  try {
    wallet.context.prepareSubmissionTracking(unknown, "Synthetic unknown", undefined, true);
    wallet.context.prepareSubmissionTracking(failed, "Synthetic failed", undefined, true);
    wallet.context.transactionTrackingRef.current = submissions.applyTransactionPoll(
      wallet.context.transactionTrackingRef.current,
      wallet.context.transactionTrackingRef.current.pending[1], false,
    ).tracking;
    const release = wallet.callback("releaseSubmissionJournals");
    release();
    const stored = wallet.reload();
    assert.equal(stored.length, 1);
    assert.equal(stored[0].hash, unknown.hash);
    assert.equal(stored[0].expiresAt, 1);
    assert.equal(stored[0].journalPending, undefined);
    assert.equal(wallet.context.transactionTrackingRef.current.pending[0].journalPending, undefined);
    submissions.clearDurablePendingTransactions(window.localStorage, wallet.context.PENDING_TX_STORAGE_KEY);
    wallet.context.transactionTrackingRef.current = { pending: [], resolutions: {} };
    const before = wallet.commits();
    release();
    assert.equal(wallet.reload().length, 0);
    assert.equal(wallet.commits(), before);
  } finally { vault.lockVault(); }
});

test("retained journal storage events do not requeue or repoll a known canonical resolution", async () => {
  await merchantSession();
  const wallet = walletTrackingHarness();
  const identity = { ...acceptedRefund, network: "testnet", expiresAt: 1 };
  let listener;
  wallet.context.pendingTxsHydrated = true;
  wallet.context.window = {
    localStorage: window.localStorage,
    addEventListener: (_name, callback) => { listener = callback; },
    removeEventListener: () => {},
  };
  try {
    wallet.context.prepareSubmissionTracking(identity, "Synthetic refund", undefined, true);
    wallet.context.loadWalletApi = async () => ({ resolveCanonicalTransaction: async () => "confirmed" });
    await wallet.callback("pollPending")(wallet.context.transactionTrackingRef.current.pending[0]);
    assert.equal(wallet.reload().length, 1);
    const cleanup = wallet.callback("pendingStorageEffect")();
    listener({ key: wallet.context.PENDING_TX_STORAGE_KEY });
    listener({ key: wallet.context.PENDING_TX_STORAGE_KEY });
    assert.equal(wallet.context.transactionTrackingRef.current.pending.length, 0);
    assert.equal(wallet.polls(), 0);
    assert.equal(submissions.submissionLifecycleStatus(identity, wallet.context.transactionTrackingRef.current.resolutions), "confirmed");
    cleanup();
  } finally { vault.lockVault(); }
});

test("an unmatched journal hint never creates a merchant refund or invents terminal authority", async () => {
  const harness = await refundHarness();
  const wallet = walletTrackingHarness();
  const identity = { ...acceptedRefund, network: "testnet", expiresAt: 1 };
  try {
    wallet.context.prepareSubmissionTracking(identity, "Synthetic unmatched journal", undefined, true);
    wallet.context.loadWalletApi = async () => ({ resolveCanonicalTransaction: async () => "not_found" });
    await wallet.callback("pollPending")(wallet.context.transactionTrackingRef.current.pending[0]);
    harness.context.ready = true;
    harness.context.acknowledgeSubmissionJournal = wallet.callback("acknowledgeSubmissionJournal");
    harness.context.submissionStatus = submission => submissions.submissionLifecycleStatus(
      submission, wallet.context.transactionTrackingRef.current.resolutions,
    );
    merchantCallback("refundReconciliationEffect", harness.context)();
    assert.equal(harness.storeRef.current.refunds.length, 0);
    assert.equal(harness.commits(), 0);
    assert.equal(wallet.context.transactionTrackingRef.current.pending.length, 0);
    const restarted = walletTrackingHarness();
    restarted.context.transactionTrackingRef.current.pending = wallet.reload();
    assert.equal(restarted.reload().length, 1);
    assert.equal(submissions.submissionLifecycleStatus({ ...identity, status: "status_unknown" }, restarted.context.transactionTrackingRef.current.resolutions), "status_unknown");
    assert.equal(restarted.reload()[0].status, "status_unknown");
    wallet.callback("releaseSubmissionJournals")();
    assert.equal(wallet.reload().length, 0);
  } finally { vault.lockVault(); }
});

for (const action of ["refundOrder", "refundReconciledPayment"]) {
  test(`the actual wallet pipeline retains a revoked ${action} intent through reload and canonical expiry resolution`, async () => {
    const harness = await refundHarness();
    const wallet = walletTrackingHarness();
    const gate = deferred();
    const commit = harness.context.commitStore;
    harness.context.commitStore = async update => {
      await commit(update);
      if (harness.commits() === 1) await gate.run();
    };
    let posts = 0;
    harness.context.send = params => wallet.run("Synthetic refund", undefined, async onPrepared => {
      await onPrepared({ ...acceptedRefund, network: "testnet", expiresAt: 1 });
      posts++;
      return acceptedRefund;
    }, result => result, params.submissionJournal, params.authorizeBeforeSigning);
    try {
      const pending = harness.run(action);
      const rejected = assert.rejects(pending, error => error?.code === "vault_locked");
      await gate.waiting;
      await harness.failReset();
      gate.release();
      await rejected;
      assert.equal(posts, 0);
      assert.equal(harness.commitsAfterReset(), 0);
      assert.equal(harness.storeRef.current.refunds[0].submissionStatus, "prepared");
      assert.equal(wallet.polls(), 1);
      // A new wallet runtime hydrates only the already-durable canonical handle.
      const restored = wallet.reload();
      assert.equal(restored.length, 1);
      assert.equal(restored[0].expiresAt, 1);
      const resumed = walletTrackingHarness();
      resumed.context.transactionTrackingRef.current.pending = restored;
      let canonicalLookups = 0;
      resumed.context.loadWalletApi = async () => ({
        resolveCanonicalTransaction: async () => { canonicalLookups++; return "not_found"; },
        waitForTransaction: async () => { throw new Error("Expired envelopes require the canonical expiry lookup"); },
      });
      await resumed.callback("pollPending")(restored[0]);
      assert.equal(canonicalLookups, 1);
      assert.equal(resumed.reload().length, 1);
      harness.context.ready = true;
      harness.context.acknowledgeSubmissionJournal = resumed.callback("acknowledgeSubmissionJournal");
      harness.context.submissionStatus = submission => submissions.submissionLifecycleStatus(
        submission, resumed.context.transactionTrackingRef.current.resolutions,
      );
      harness.context.persist = harness.context.commitStore;
      merchantCallback("refundReconciliationEffect", harness.context)();
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(harness.storeRef.current.refunds[0].submissionStatus, "failed");
      assert.equal(refunds.refundReservesFunds(harness.storeRef.current.refunds[0]), false);
      assert.equal(resumed.reload().length, 0);
    } finally { vault.lockVault(); }
  });
}

for (const boundary of ["locked", "unmounted", "commit failure"]) {
  test(`canonical refund recovery survives a second reload after merchant ${boundary}`, async () => {
    const harness = await refundHarness();
    const wallet = walletTrackingHarness();
    const gate = deferred();
    const commit = harness.context.commitStore;
    harness.context.commitStore = async update => {
      await commit(update);
      if (harness.commits() === 1) await gate.run();
    };
    harness.context.send = params => wallet.run("Synthetic refund", undefined, async onPrepared => {
      await onPrepared({ ...acceptedRefund, network: "testnet", expiresAt: 1 });
      throw new Error("Revoked preparation must not reach POST");
    }, result => result, params.submissionJournal, params.authorizeBeforeSigning);
    try {
      const pending = harness.run("refundOrder");
      const rejected = assert.rejects(pending, error => error?.code === "vault_locked");
      await gate.waiting;
      if (boundary === "locked") vault.lockVault();
      else harness.session.revoke();
      gate.release();
      await rejected;
      assert.equal(wallet.reload().length, 1);
      wallet.context.loadWalletApi = async () => ({ resolveCanonicalTransaction: async () => "not_found" });
      await wallet.callback("pollPending")(wallet.context.transactionTrackingRef.current.pending[0]);
      if (boundary === "commit failure") {
        harness.context.ready = true;
        harness.context.submissionStatus = submission => submissions.submissionLifecycleStatus(
          submission, wallet.context.transactionTrackingRef.current.resolutions,
        );
        harness.context.commitStore = async () => { throw new MerchantStorageError("write_failed"); };
        harness.context.acknowledgeSubmissionJournal = () => { throw new Error("Failed commits must not acknowledge recovery"); };
        harness.context.isMerchantStorageError = error => error instanceof MerchantStorageError;
        harness.context.persist = merchantCallback("persist", harness.context);
        merchantCallback("refundReconciliationEffect", harness.context)();
        await new Promise(resolve => setImmediate(resolve));
      }
      const restarted = walletTrackingHarness();
      restarted.context.transactionTrackingRef.current.pending = wallet.reload();
      assert.equal(restarted.context.transactionTrackingRef.current.pending.length, 1);
      assert.equal(Object.keys(restarted.context.transactionTrackingRef.current.resolutions).length, 0);
      assert.equal(harness.storeRef.current.refunds[0].submissionStatus, "prepared");
    } finally { vault.lockVault(); }
  });
}

for (const journalMode of ["absent", "acknowledged", "deferred", "throws"]) {
  test(`the actual wallet rejection handoff preserves the transaction error with journal mode ${journalMode}`, async () => {
    await merchantSession();
    const wallet = walletTrackingHarness();
    const transactionError = new Error("Synthetic definite transaction rejection");
    const journal = journalMode === "absent" ? undefined : {
      onPrepared: async () => {},
      onRejected: async () => {
        if (journalMode === "throws") throw new Error("Synthetic journal storage error");
        if (journalMode === "deferred") return false;
      },
    };
    try {
      await assert.rejects(wallet.run("Synthetic", undefined, async onPrepared => {
        await onPrepared({ ...acceptedRefund, network: "testnet", expiresAt: 1 });
        throw transactionError;
      }, result => result, journal), error => error === transactionError);
      const retained = journalMode === "deferred" || journalMode === "throws";
      assert.equal(wallet.reload().length, retained ? 1 : 0);
      assert.equal(wallet.polls(), retained ? 1 : 0);
    } finally { vault.lockVault(); }
  });
}

for (const revocation of ["unmount", "wallet reset"]) {
  test(`deferred journal cleanup after ${revocation} never restarts stale polling or recreates removed tracking`, async () => {
    await merchantSession();
    const wallet = walletTrackingHarness();
    const gate = deferred();
    try {
      const pending = wallet.run("Synthetic", undefined, async onPrepared => {
        await onPrepared({ ...acceptedRefund, network: "testnet", expiresAt: 1 });
        throw new Error("Synthetic definite transaction rejection");
      }, result => result, { onPrepared: async () => {}, onRejected: gate.run });
      const rejected = assert.rejects(pending, /Synthetic definite transaction rejection/);
      await gate.waiting;
      wallet.context.trackingTaskGeneration.current++;
      if (revocation === "wallet reset") {
        submissions.clearDurablePendingTransactions(window.localStorage, wallet.context.PENDING_TX_STORAGE_KEY);
        wallet.context.transactionTrackingRef.current = { pending: [], resolutions: {} };
      }
      gate.release(false);
      await rejected;
      assert.equal(wallet.polls(), 0);
      assert.equal(wallet.reload().length, revocation === "wallet reset" ? 0 : 1);
    } finally { vault.lockVault(); }
  });
}

for (const action of ["refundOrder", "refundReconciledPayment"]) {
  test(`the actual ${action} keeps durable intent but rejects a late accepted result after failed reset`, async () => {
    const harness = await refundHarness();
    const gate = deferred();
    harness.context.send = async params => {
      params.authorizeBeforeSigning();
      await params.submissionJournal.onPrepared(acceptedRefund);
      await gate.run();
      return acceptedRefund;
    };
    try {
      const pending = harness.run(action);
      const rejected = assert.rejects(pending, error => error?.code === "vault_locked");
      await gate.waiting;
      await harness.failReset();
      assert.notEqual(vault.getSessionSnapshot(), null);
      assert.equal(harness.storeRef.current.refunds.length, 1);
      gate.release();
      await rejected;
      assert.equal(harness.commitsAfterReset(), 0);
      assert.equal(harness.storeRef.current.refunds[0].submissionStatus, "prepared");
      assert.equal(refunds.refundReservesFunds(harness.storeRef.current.refunds[0]), true);
    } finally { vault.lockVault(); }
  });

  for (const boundary of ["signing", "prepared", "rejected"]) {
    test(`the actual ${action} cannot reacquire access in a stale ${boundary} callback`, async () => {
      const harness = await refundHarness();
      const gate = deferred();
      harness.context.send = async params => {
        if (boundary !== "signing") params.authorizeBeforeSigning();
        if (boundary === "rejected") await params.submissionJournal.onPrepared(acceptedRefund);
        await gate.run();
        if (boundary === "signing") params.authorizeBeforeSigning();
        if (boundary === "rejected") {
          await params.submissionJournal.onRejected();
          throw new Error("Synthetic transaction rejection");
        }
        await params.submissionJournal.onPrepared(acceptedRefund);
        return acceptedRefund;
      };
      try {
        const pending = harness.run(action);
        const rejected = assert.rejects(pending, error => boundary === "rejected"
          ? /Synthetic transaction rejection/.test(error.message) : error?.code === "vault_locked");
        await gate.waiting;
        await harness.failReset();
        gate.release();
        await rejected;
        assert.equal(harness.commitsAfterReset(), 0);
        assert.equal(harness.storeRef.current.refunds.length, boundary === "rejected" ? 1 : 0);
        if (boundary === "rejected") {
          assert.equal(harness.storeRef.current.refunds[0].submissionStatus, "prepared");
        }
      } finally { vault.lockVault(); }
    });
  }

  test(`the actual ${action} suppresses plaintext after its final commit without undoing that commit`, async () => {
    const harness = await refundHarness();
    const gate = deferred();
    const commit = harness.context.commitStore;
    harness.context.commitStore = async update => {
      await commit(update);
      if (harness.commits() === 2) await gate.run();
    };
    harness.context.send = async params => {
      params.authorizeBeforeSigning();
      await params.submissionJournal.onPrepared(acceptedRefund);
      return acceptedRefund;
    };
    try {
      const pending = harness.run(action);
      const rejected = assert.rejects(pending, error => error?.code === "vault_locked");
      await gate.waiting;
      harness.session.revoke();
      gate.release();
      await rejected;
      assert.equal(harness.storeRef.current.refunds[0].submissionStatus, "accepted");
      assert.equal(harness.commits(), 2);
    } finally { vault.lockVault(); }
  });

  test(`a newly invoked ${action} after failed reset records an accepted refund without claiming confirmation`, async () => {
    const harness = await refundHarness();
    harness.context.send = async params => {
      params.authorizeBeforeSigning();
      await params.submissionJournal.onPrepared(acceptedRefund);
      return acceptedRefund;
    };
    try {
      await harness.failReset();
      const result = await harness.run(action);
      assert.equal(result.submissionStatus, "accepted");
      assert.equal(harness.storeRef.current.refunds[0].submissionStatus, "accepted");
      assert.equal(harness.commits(), 2);
    } finally { vault.lockVault(); }
  });
}

for (const action of ["submitRefund", "submitPaymentRefund"]) {
  for (const mode of ["refunded", "requested"]) {
    test(`the actual ${action} suppresses a stale ${mode} result`, async () => {
      const harness = await refundHarness();
      const gate = deferred();
      const actor = mode === "refunded" ? member("owner", "owner")
        : member("server", "server", { refundCeilingMinor: 0 });
      harness.storeRef.current.staff = [actor];
      harness.context.staffSessionId = actor.id;
      harness.context.refundOrder = gate.run;
      harness.context.refundReconciledPayment = gate.run;
      if (mode === "requested") harness.context.commitStore = gate.run;
      try {
        const pending = merchantCallback(action, harness.context)(...(action === "submitRefund"
          ? [{ orderId: "synthetic-order", amountMinor: 2_000, reason: "customer_request" }]
          : ["synthetic-surplus"]));
        const rejected = assert.rejects(pending, error => error?.code === "vault_locked");
        await gate.waiting;
        harness.session.revoke();
        gate.release({ id: "synthetic-refund" });
        await rejected;
      } finally { vault.lockVault(); }
    });
  }
}

for (const boundary of ["refund", "decision"]) {
  test(`the actual approval action stops after a revoked ${boundary} boundary`, async () => {
    const harness = await refundHarness();
    const gate = deferred();
    const server = member("server", "server", { refundCeilingMinor: 0 });
    harness.storeRef.current.staff.push(server);
    const requested = permissions.createRefundRequest(harness.storeRef.current, {
      id: "synthetic-request", orderId: "synthetic-order", amountMinor: 2_000,
      reason: "customer_request", requestedById: server.id, now: 1,
    });
    harness.storeRef.current = requested.store;
    harness.storeRef.current.refunds = [{
      id: "synthetic-refund", requestId: requested.request.id, orderId: "synthetic-order",
      kind: "order", amountMinor: 2_000, reason: "customer_request", submissionStatus: "accepted",
    }];
    harness.context.refundOrder = boundary === "refund" ? gate.run : async () => ({ id: "synthetic-refund" });
    let decisions = 0;
    const commit = harness.context.commitStore;
    harness.context.commitStore = async update => {
      decisions++;
      await commit(update);
      if (boundary === "decision") await gate.run();
    };
    try {
      const pending = merchantCallback("approveRefundRequest", harness.context)("synthetic-request");
      const rejected = assert.rejects(pending, error => error?.code === "vault_locked");
      await gate.waiting;
      harness.session.revoke();
      gate.release({ id: "synthetic-refund" });
      await rejected;
      assert.equal(decisions, boundary === "decision" ? 1 : 0);
    } finally { vault.lockVault(); }
  });
}

test("merchant key finalization erases its own copy without touching a replacement key", () => {
  const oldKey = new Uint8Array(32).fill(17);
  const replacementKey = new Uint8Array(32).fill(18);
  const merchantKeysRef = { current: new Set([replacementKey]) };
  merchantCallback("releaseMerchantKey", { merchantKeysRef })(oldKey);
  assert.equal(oldKey.every(byte => byte === 0), true);
  assert.equal(replacementKey.every(byte => byte === 18), true);
  assert.equal(merchantKeysRef.current.has(replacementKey), true);
  merchantCallback("releaseMerchantKey", { merchantKeysRef })(replacementKey);
  assert.equal(replacementKey.every(byte => byte === 0), true);
  assert.equal(merchantKeysRef.current.size, 0);
});

test("a delayed writer lock cannot publish after synchronous session revocation", async () => {
  const session = await merchantSession();
  let acquired;
  let publications = 0;
  const merchantWriterLockRef = { current: "pending" };
  const effect = merchantCallback("merchantWriterEffect", {
    AbortController, ready: true, phase: "unlocked", captureMerchantAccess: session.capture(),
    merchantWriterLockRef, setStorageError: () => { publications++; },
    navigator: { locks: { request: (_name, _options, callback) => { acquired = callback; return Promise.resolve(); } } },
  });
  try {
    const cleanup = effect();
    vault.lockVault();
    const pending = acquired();
    cleanup();
    await pending;
    assert.equal(publications, 0);
  } finally { vault.lockVault(); }
});

for (const outcome of ["success", "failure"]) {
  for (const writer of ["pending", "held"]) {
    test(`a current reset ${outcome} restarts only a ${writer} writer acquisition`, async () => {
      const harness = await refundHarness();
      let writerRevision = 0;
      Object.assign(harness.context, {
        emptyStore, merchantWriterLockRef: { current: writer },
        setMerchantWriterRevision: update => { writerRevision = update(writerRevision); },
        setStorageIssue: () => {}, setStore: () => {}, updateStaffSessionId: () => {},
        setReady: () => {}, revisionChannelRef: { current: null }, writeMerchantBootstrapState: () => {},
        releaseSubmissionJournals: () => {},
      });
      if (outcome === "success") harness.context.repositoryRef.current.clear = async () => {};
      try {
        const pending = merchantCallback("resetRecoveryData", harness.context)();
        if (outcome === "failure") await assert.rejects(pending, /could not be erased/);
        else await pending;
        assert.equal(writerRevision, writer === "pending" ? 1 : 0);
        assert.equal(harness.context.merchantWriterLockRef.current, writer);
      } finally { vault.lockVault(); }
    });
  }
}

test("an old reset settlement cannot restart or disturb a newer writer", async () => {
  const harness = await refundHarness();
  const gate = deferred();
  let writerRevision = 0;
  Object.assign(harness.context, {
    merchantWriterLockRef: { current: "pending" },
    setMerchantWriterRevision: update => { writerRevision = update(writerRevision); },
  });
  harness.context.repositoryRef.current.clear = gate.run;
  try {
    const pending = merchantCallback("resetRecoveryData", harness.context)();
    const rejected = assert.rejects(pending, error => error?.code === "vault_locked");
    await gate.waiting;
    harness.session.revoke();
    harness.context.merchantWriterLockRef.current = "held";
    gate.release();
    await rejected;
    assert.equal(writerRevision, 0);
    assert.equal(harness.context.merchantWriterLockRef.current, "held");
  } finally { vault.lockVault(); }
});

for (const outcome of ["success", "failure"]) {
  test(`an actual payment poll ignores stale ${outcome} and preserves a newer poll's ownership`, async () => {
    const session = await merchantSession();
    const gate = deferred();
    const polling = { current: false };
    let publications = 0;
    let writes = 0;
    const poll = merchantCallback("pollNow", {
      Error, Date, AbortController, captureMerchantAccess: session.capture(),
      pollControllerRef: { current: null },
      enabled: true, online: true, watchDestinations: ["synthetic"], polling,
      merchantWriterLockRef: { current: "held" },
      watcherLeaseKey: () => "synthetic", network: "testnet", writerId: "synthetic", WATCHER_LEASE_MS: 1,
      claimWatcherLease: () => true, window: { localStorage: {} }, merchantCursorKey: () => "synthetic",
      storeRef: { current: { cursors: {} } },
      fetchIncomingPayments: async () => {
        await gate.run();
        if (outcome === "failure") throw new Error("Synthetic late transport failure");
        return { payments: [], latestLedger: 1, cursor: "synthetic" };
      },
      applyPayments: async () => { writes++; }, persist: async () => { writes++; },
      setWatchedLedger: () => { publications++; }, setWatchError: () => { publications++; },
      isMerchantStorageError: () => false, describeWatchFailure: () => "Synthetic failure",
    });
    try {
      const pending = poll();
      await gate.waiting;
      session.revoke();
      polling.current = true;
      gate.release();
      await pending;
      assert.equal(writes, 0);
      assert.equal(publications, 0);
      assert.equal(polling.current, true);
    } finally { vault.lockVault(); }
  });
}

for (const action of ["completeSetup", "switchStaff", "unlockCustomerDisplay", "addStaff", "resetStaffPin"]) {
  test(`the actual ${action} action cannot use a new session after delayed PIN work`, async () => {
    const session = await merchantSession();
    const pinDigest = await createMerchantPinCredential("4827");
    const owner = { ...member("owner", "owner"), pinDigest };
    const storeRef = { current: { ...emptyStore(), staff: [owner], activeStaffId: owner.id } };
    const gate = deferred();
    let commits = 0;
    let publications = 0;
    const context = {
      ...permissions, ...operators, ...setup, Error, Date,
      captureMerchantAccess: session.capture(), storeRef,
      accounts: [session.account], staffSessionId: owner.id, staffSessionIdRef: { current: owner.id },
      authorizeSensitiveAction: async () => {},
      createMerchantPinCredential: gate.run,
      verifyMerchantPin: gate.run,
      uid: () => "synthetic-new-member",
      updateStaffSessionId: () => { publications++; },
      commitStore: async update => {
        commits++;
        storeRef.current = typeof update === "function" ? update(storeRef.current) : update;
      },
    };
    const input = {
      ...emptyStore().settings, profile: { ...emptyStore().settings.profile, name: "Synthetic shop" },
      receivingPublicKey: session.account.publicKey, textSize: "standard", ownerName: "Synthetic owner", pin: "4827",
    };
    const args = action === "completeSetup" ? [input] : action === "addStaff"
      ? [{ name: "Synthetic server", role: "server", pin: "4827" }]
      : action === "unlockCustomerDisplay" ? ["4827"] : [owner.id, "4827"];
    try {
      const pending = merchantCallback(action, context)(...args);
      const rejected = assert.rejects(pending, error => error?.code === "vault_locked");
      await gate.waiting;
      await session.replace();
      gate.release(action === "switchStaff" || action === "unlockCustomerDisplay" ? true : pinDigest);
      await rejected;
      assert.equal(commits, 0);
      assert.equal(publications, 0);
      // A newly invoked action in the new session still works.
      context.captureMerchantAccess = session.capture();
      context.createMerchantPinCredential = async () => pinDigest;
      context.verifyMerchantPin = async () => true;
      await merchantCallback(action, context)(...args);
      assert.equal(commits, 1);
    } finally { vault.lockVault(); }
  });
}

test("an actual charge action suppresses post-commit UI and plaintext after revocation", async () => {
  const session = await merchantSession();
  const gate = deferred();
  let publications = 0;
  const current = emptyStore();
  const action = merchantCallback("createChargeFromTicket", {
    Error, Date, captureMerchantAccess: session.capture(), storeRef: { current },
    ticket: { lines: [{}], adjustments: [] }, requirePaymentActor: () => ({}),
    buildTicketOrder: () => ({ totals: { totalMinor: 1 } }),
    awaitNewOrder: (store, order) => ({ store, order }),
    cryptoChargeFor: () => ({ id: "synthetic-charge" }),
    commitStore: gate.run,
    setActiveChargeId: () => { publications++; }, clearTicket: () => { publications++; },
  });
  try {
    const pending = action();
    const rejected = assert.rejects(pending, error => error?.code === "vault_locked");
    await gate.waiting;
    session.revoke();
    gate.release();
    await rejected;
    assert.equal(publications, 0);
  } finally { vault.lockVault(); }
});

test("an actual report export cannot return private content after its commit is revoked", async () => {
  const session = await merchantSession();
  const gate = deferred();
  const owner = member("owner", "owner");
  const store = { ...emptyStore(), staff: [owner], activeStaffId: owner.id };
  const action = merchantCallback("createReportExport", {
    Error, Date, captureMerchantAccess: session.capture(), storeRef: { current: store },
    staffSessionId: owner.id, network: "testnet", uid: () => "synthetic-export",
    createPersistedReportExport: () => ({ store, file: { content: "synthetic" }, record: {} }),
    commitStore: gate.run,
  });
  try {
    const pending = action({});
    const rejected = assert.rejects(pending, error => error?.code === "vault_locked");
    await gate.waiting;
    session.revoke();
    gate.release();
    await rejected;
  } finally { vault.lockVault(); }
});

function openShift(network = "testnet") {
  return {
    id: "shift-1",
    number: 1,
    openedAt: 1,
    closedAt: null,
    openedById: "owner",
    openedBy: "owner",
    closedById: null,
    closedBy: null,
    terminalName: "Front counter",
    network,
    floatMinor: 0,
    grossMinor: 0,
    refundsMinor: 0,
    tipsMinor: 0,
    discountsMinor: 0,
    compsMinor: 0,
    voidsMinor: 0,
    taxByRate: {},
    orderCount: 0,
    cash: null,
    openTabs: 0,
    zReport: null,
  };
}

function awaitingStore() {
  const owner = member("owner", "owner");
  return {
    ...emptyStore(),
    staff: [owner],
    activeStaffId: owner.id,
    shifts: [openShift()],
    orders: [{ id: "order-1", status: "awaiting" }],
    charges: [{ id: "charge-1", orderId: "order-1", status: "awaiting" }],
  };
}

test("merchant charge voiding revalidates the active operator, shift, permission, and status", () => {
  const original = awaitingStore();
  const voided = voidAwaitingMerchantCharge(original, {
    chargeId: "charge-1",
    actorId: "owner",
    network: "testnet",
  });

  assert.equal(voided.charges[0].status, "voided");
  assert.equal(voided.orders[0].status, "voided");
  assert.equal(original.charges[0].status, "awaiting");
  assert.throws(
    () => voidAwaitingMerchantCharge({ ...original, activeStaffId: null }, {
      chargeId: "charge-1",
      actorId: "owner",
      network: "testnet",
    }),
    /active staff|active operator|choose/i,
  );
  assert.throws(
    () => voidAwaitingMerchantCharge({
      ...original,
      staff: [member("owner", "owner", { void: false })],
    }, {
      chargeId: "charge-1",
      actorId: "owner",
      network: "testnet",
    }),
    /not allowed to void/i,
  );
  assert.throws(
    () => voidAwaitingMerchantCharge({ ...original, shifts: [] }, {
      chargeId: "charge-1",
      actorId: "owner",
      network: "testnet",
    }),
    /open a shift/i,
  );
  assert.throws(
    () => voidAwaitingMerchantCharge({
      ...original,
      charges: [{ ...original.charges[0], status: "paid" }],
    }, {
      chargeId: "charge-1",
      actorId: "owner",
      network: "testnet",
    }),
    /only an awaiting charge/i,
  );
});

test("merchant record access fails closed for locked, absent, and report-forbidden operators", () => {
  const owner = member("owner", "owner");
  const server = member("server", "server");

  assert.deepEqual(
    merchantPageAccess({ activeStaff: owner, vaultPhase: "unlocked" }),
    { hasActiveOperator: true, canSeeReports: true, canAccessRecords: true },
  );
  assert.equal(
    merchantPageAccess({ activeStaff: owner, vaultPhase: "locked" }).canAccessRecords,
    false,
  );
  assert.equal(
    merchantPageAccess({ activeStaff: null, vaultPhase: "unlocked" }).canAccessRecords,
    false,
  );
  assert.equal(
    merchantPageAccess({ activeStaff: server, vaultPhase: "unlocked" }).canAccessRecords,
    false,
  );
});

test("merchant wallet exit requires a current owner before and after wallet authorization", async () => {
  const owner = member("owner", "owner");
  let store = { ...emptyStore(), staff: [owner], activeStaffId: owner.id };
  const events = [];

  await authorizeMerchantWalletExit({
    getStore: () => store,
    getActorId: () => owner.id,
    authorizeWalletOwner: async () => events.push("wallet-authorized"),
  });
  assert.deepEqual(events, ["wallet-authorized"]);

  await assert.rejects(
    authorizeMerchantWalletExit({
      getStore: () => store,
      getActorId: () => owner.id,
      authorizeWalletOwner: async () => {
        store = { ...store, activeStaffId: null };
      },
    }),
    /active owner/i,
  );
});

test("every merchant-to-wallet navigation except settings crosses the exit gate", () => {
  assert.equal(merchantExitRequired({
    mode: "merchant",
    targetIsMerchantView: false,
    targetIsSettings: false,
  }), true);
  assert.equal(merchantExitRequired({
    mode: "merchant",
    targetIsMerchantView: true,
    targetIsSettings: false,
  }), false);
  assert.equal(merchantExitRequired({
    mode: "merchant",
    targetIsMerchantView: false,
    targetIsSettings: true,
  }), false);
  assert.equal(merchantExitRequired({
    mode: "wallet",
    targetIsMerchantView: false,
    targetIsSettings: false,
  }), false);
});
