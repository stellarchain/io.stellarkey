import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createLatestRequestLane } from "../src/hooks/useWalletResources.ts";
import { isMarketObservationFresh } from "../src/lib/prices.ts";

// Execute the actual event handler with synthetic inputs and React/UI seams.
function handler(file, name, context) {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) expression = node.getText(parsed);
    if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === name && ts.isCallExpression(node.initializer)) {
      expression = node.initializer.arguments[0].getText(parsed);
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.ok(expression);
  return vm.runInNewContext(ts.transpileModule(`(${expression})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, context);
}

test("the actual till handler presents an asynchronous stale-quote rejection without clearing the ticket", async () => {
  const notices = [];
  const failure = Promise.reject(new Error("No fresh price is available"));
  void failure.catch(() => {});
  const raise = handler("../src/components/merchant/PosTerminal.tsx", "raiseCharge", {
    Error,
    setTipPromptOpen() {},
    createChargeFromTicket: () => failure,
    triggerHaptic() {},
    toast: (...args) => notices.push(args),
  });
  await raise(0);
  assert.deepEqual(notices, [["No fresh price is available", "error"]]);
});

test("an unpriceable actual ticket action does not commit an order or clear the draft", async () => {
  let commits = 0;
  let clears = 0;
  const draft = { lines: [{ id: "synthetic-line" }], adjustments: [] };
  const create = handler("../src/hooks/useMerchant.tsx", "createChargeFromTicket", {
    Error, Date,
    storeRef: { current: {} },
    ticket: draft,
    requirePaymentActor: () => ({}),
    buildTicketOrder: () => ({ totals: { totalMinor: 100 } }),
    awaitNewOrder: (store, order) => ({ store, order }),
    cryptoChargeFor: () => { throw new Error("No fresh price is available"); },
    commitStore: async () => { commits++; },
    setActiveChargeId() {},
    clearTicket: () => { clears++; },
  });
  await assert.rejects(create(), /No fresh price/);
  assert.equal(commits, 0);
  assert.equal(clears, 0);
  assert.equal(draft.lines.length, 1);
});

test("an expired quote action updates visible availability immediately so retry does not wait for a timer", () => {
  let checked = false;
  const quotes = handler("../src/hooks/useMerchant.tsx", "quoteInputs", {
    Date,
    settings: { acceptedAssets: [{ code: "XLM", issuer: null }] },
    rateFor: () => null,
    setPriceCheckedAt: () => { checked = true; },
  });
  assert.equal(quotes().length, 0);
  assert.equal(checked, true);
});

test("a fixed counter-code action exposes stale pricing immediately without publishing", async () => {
  let checked = false;
  const create = handler("../src/hooks/useMerchant.tsx", "createCounterCode", {
    Date, Error,
    storeRef: { current: { settings: { receivingPublicKey: "synthetic-destination" } } },
    requireCounterCodeActor: () => ({}),
    rateFor: () => null,
    setPriceCheckedAt: () => { checked = true; },
  });
  await assert.rejects(create({ kind: "fixed", acceptedAssets: [{ code: "XLM", issuer: null }] }), /No live price/);
  assert.equal(checked, true);
});

for (const file of ["LinkEditorModal", "InvoiceDetailModal", "CashTenderSheet"]) {
  test(`${file} retries prices within its own shell without closing or changing form fields`, async () => {
    let resolve;
    const pending = new Promise((yes) => { resolve = yes; });
    const changes = [];
    let requests = 0;
    const retry = handler(`../src/components/merchant/${file}.tsx`, "retryPrices", {
      priceRetryPending: { current: false },
      setPricesRefreshing: (value) => changes.push(value),
      retryMarketPrices: () => { requests++; return pending; },
    });
    const first = retry();
    await retry();
    assert.equal(requests, 1);
    assert.deepEqual(changes, [true]);
    resolve();
    await first;
    assert.deepEqual(changes, [true, false]);
    const source = readFileSync(new URL(`../src/components/merchant/${file}.tsx`, import.meta.url), "utf8");
    assert.match(source, /onClick=\{retryPrices\}/);
    assert.match(source, /disabled=\{pricesRefreshing\}/);
    assert.match(source, /Retry prices/);
  });
}

function chartHarness() {
  const now = 1_800_000_000_000;
  const old = { range: "7D", observedAt: now - 3600_000, points: [{ t: now - 1, p: 0.2 }, { t: now, p: 0.25 }], current: 0.25, changePct: 25 };
  const state = { series: old, selected: "7D", status: "idle" };
  const pending = [];
  const cache = { current: { "7D": old } };
  const context = {
    priceCache: cache,
    marketRefreshLane: createLatestRequestLane(),
    isMarketObservationFresh: (at) => isMarketObservationFresh(at, now),
    setPriceRangeState: (value) => { state.selected = value; },
    setPriceData: (value) => { state.series = value; },
    setPriceRequestStatus: (value) => { state.status = value; },
    loadWalletApi: async () => ({ fetchXlmSeries: (range, signal) => new Promise((resolve, reject) => {
      pending.push({ range, signal, resolve, reject });
    }) }),
  };
  return { now, old, state, pending, cache, context, change: handler("../src/hooks/useWallet.tsx", "changePriceRange", context) };
}

test("the actual range callback retains an expired cache entry, retries null results, and keeps the requested range on thrown failures", async () => {
  const view = chartHarness();
  const first = view.change("7D");
  assert.equal(view.state.series, view.old);
  assert.equal(view.state.status, "pending");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(view.pending.length, 1, "an expired revisit performs another fetch");
  view.pending[0].resolve(null);
  await first;
  assert.equal(view.state.series, view.old);
  assert.equal(view.state.status, "error");
  const retry = view.change("7D");
  await new Promise((resolve) => setImmediate(resolve));
  const current = { ...view.old, observedAt: view.now };
  view.pending[1].resolve(current);
  await retry;
  assert.equal(view.state.series, current);
  assert.equal(view.state.status, "idle");
  await view.change("7D");
  assert.equal(view.pending.length, 2, "a fresh cache read does not repeat the fetch or reset its time");
  const failed = view.change("1M");
  await new Promise((resolve) => setImmediate(resolve));
  view.pending[2].reject(new Error("Synthetic failure"));
  await failed;
  assert.equal(view.state.series, current);
  assert.equal(view.state.selected, "1M", "retry still targets the user's requested range");
  assert.equal(view.state.status, "error");
});

test("the actual range lane ignores obsolete results and cleanup even if the transport ignores abort", async () => {
  const view = chartHarness();
  const older = view.change("1M");
  await new Promise((resolve) => setImmediate(resolve));
  const latest = view.change("1Y");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(view.pending[0].signal.aborted, true);
  const current = { ...view.old, range: "1Y", observedAt: view.now };
  view.pending[1].resolve(current);
  await latest;
  view.pending[0].resolve({ ...view.old, range: "1M", observedAt: view.now });
  await older;
  assert.equal(view.state.series, current);
  assert.equal(view.state.status, "idle");
  assert.equal(view.cache.current["1M"], undefined);
});

test("the actual market refresh scopes a lazy API failure to the chart status", async () => {
  const view = chartHarness();
  const refresh = handler("../src/hooks/useWallet.tsx", "refreshMarketData", {
    ...view.context,
    activeAccount: { id: "synthetic-account" },
    priceRange: "7D",
    loadWalletApi: async () => { throw new Error("Synthetic import failed"); },
  });
  await refresh();
  assert.equal(view.state.series, view.old);
  assert.equal(view.state.status, "error");
});
