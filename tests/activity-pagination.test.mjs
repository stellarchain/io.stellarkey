import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createLatestRequestLane } from "../src/hooks/useWalletResources.ts";
import { UNAVAILABLE_MARKET_SAMPLE } from "../src/lib/prices.ts";

const source = readFileSync(new URL("../src/hooks/useWallet.tsx", import.meta.url), "utf8");
const sourceFile = ts.createSourceFile("useWallet.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

// Execute the production callback bodies, not a second implementation of their
// orchestration. Only React state setters and the external ledger boundary are
// replaced; all values here are opaque synthetic labels, not wallet material.
function callback(name, context) {
  let expression;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(sourceFile) === name
      && node.initializer && ts.isCallExpression(node.initializer)) {
      expression = node.initializer.arguments[0]?.getText(sourceFile);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  assert.ok(expression, `Production callback ${name} must exist`);
  const compiled = ts.transpileModule(`(${expression})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return vm.runInContext(compiled, context);
}

function mountEffect(fragment, context) {
  let expression;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(sourceFile) === "useEffect"
      && node.arguments[0]?.getText(sourceFile).includes(fragment)) {
      expression = node.arguments[0].getText(sourceFile);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  assert.ok(expression, "The production ownership cleanup must exist");
  const compiled = ts.transpileModule(`(${expression})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return vm.runInContext(compiled, context)();
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness() {
  const page = deferred();
  const started = deferred();
  const requests = [];
  const pages = [page];
  let sessionActive = true;
  const state = { activity: [{ id: "first-page" }], cursor: "first-cursor", error: null, loading: false };
  const context = vm.createContext({
    phase: "unlocked",
    activeAccount: { id: "first", publicKey: "synthetic-first" },
    activityCursor: state.cursor,
    loadingMore: false,
    activityPaginationLane: createLatestRequestLane(),
    marketRefreshLane: createLatestRequestLane(),
    UNAVAILABLE_MARKET_SAMPLE,
    activityPageStateRef: { current: "idle" },
    network: "testnet",
    endpointRevision: 0,
    endpointRevisionRef: { current: 0 }, setEndpointRevision() {},
    STELLAR_ENDPOINTS_CHANGED_EVENT: "synthetic-endpoint-change",
    window: new EventTarget(),
    refreshGeneration: { current: 0 },
    accountBalanceGeneration: { current: 0 },
    snapshotCache: { current: new Map() },
    setActiveStoredAccount: id => ({ accounts: [{ id, publicKey: `synthetic-${id}` }] }),
    setActivity: update => { state.activity = typeof update === "function" ? update(state.activity) : update; },
    setActivityCursor: value => { state.cursor = value; },
    setDataError: value => { state.error = value; },
    setLoadingMore: value => { state.loading = value; },
    setActivityPageState: value => { state.pageState = value; state.loading = value === "pending"; },
    setBalances() {}, setMinimumBalanceXlm() {}, setClaimableBalances() {}, setActiveId() {},
    setAccounts() {}, setArchivedAccounts() {}, stripSecret: account => account,
    addStoredAccount: async () => ({ id: "second", publicKey: "synthetic-second" }),
    addHardwareAccountVault: async () => ({ id: "second", publicKey: "synthetic-second" }),
    addWatchOnlyAccount: async () => ({ id: "second", publicKey: "synthetic-second" }),
    restoreArchivedAccountVault: async () => ({ id: "second", publicKey: "synthetic-second" }),
    restoreAccountByIndexVault: async () => ({ id: "second", publicKey: "synthetic-second" }),
    removeStoredAccount: () => null, getArchivedAccounts: () => [], refresh: async () => {},
    invalidateTrackingTasks() {}, setTrackingRestartNonce() {},
    restoreVaultBackup: async () => ({ privateNotes: 0 }),
    loadVault: () => ({ accounts: [{ id: "second", publicKey: "synthetic-second" }], activeAccountId: "second" }),
    commitSigningPasswordRequired() {}, commitTransactionTracking() {}, commitMergeReconciliations() {},
    clearDurableMergeReconciliations() {}, clearDurablePendingTransactions() {}, clearSessionSecrets() {},
    MERGE_RECONCILIATION_STORAGE_KEY: "synthetic-merge", PENDING_TX_STORAGE_KEY: "synthetic-pending",
    setAccountBalances() {}, setAccountPortfolioSnapshots() {}, setXlmPriceSample() {}, setPriceRequestStatus() {}, setPriceData() {},
    saveNetworkPref() {}, setNetworkState() {},
    cancelSigningAuthorization() {}, closePaperWalletPrints() {}, setContacts() {}, setPhase() {}, setDataLoading() {},
    loadContacts: async () => [], toast() {},
    lockVault: () => { sessionActive = false; },
    createSessionRevocationGuard: () => () => {
      if (!sessionActive) throw new Error("Synthetic session revoked");
    },
    walletCoordinationRef: { current: null },
    loadWalletApi: async () => ({ fetchActivity: (...args) => {
      const next = pages[requests.length] ?? page;
      requests.push(args);
      started.resolve();
      return next.promise;
    } }),
  });
  context.commitActivityPageState = callback("commitActivityPageState", context);
  context.cancelActivityPagination = callback("cancelActivityPagination", context);
  return { state, page, pages, requests, context, started, load: callback("loadMoreActivity", context),
    select: callback("selectAccount", context), network: callback("switchNetwork", context),
    lock: callback("lockVaultAndReset", context), mutate: (name, ...args) => callback(name, context)(...args) };
}

for (const change of ["account", "network", "lock"]) {
  test(`an old activity page cannot append after ${change} changes`, async () => {
    const scope = harness();
    const pending = scope.load();
    await scope.started.promise;
    if (change === "account") scope.select("second");
    else if (change === "network") scope.network("mainnet");
    else scope.lock();
    scope.state.activity = [{ id: "replacement-first-page" }];
    scope.state.cursor = "replacement-cursor";
    scope.page.resolve({ items: [{ id: "obsolete-page" }], nextCursor: "obsolete-cursor" });
    await pending;
    assert.deepEqual(Array.from(scope.state.activity, item => item.id), ["replacement-first-page"]);
    assert.equal(scope.state.cursor, "replacement-cursor");
  });
}

test("a duplicate pagination callback cannot start a second physical request", async () => {
  const scope = harness();
  const first = scope.load();
  const second = scope.load();
  await scope.started.promise;
  scope.page.resolve({ items: [], nextCursor: null });
  await Promise.all([first, second]);
  assert.equal(scope.requests.length, 1);
});

test("a failed activity page preserves history and does not repeat before explicit retry", async () => {
  const scope = harness();
  const pending = scope.load();
  await scope.started.promise;
  scope.page.reject(new Error("Synthetic transport failure with unsafe details"));
  await pending;
  await scope.load();
  assert.equal(scope.requests.length, 1);
  assert.equal(scope.state.error, null, "Pagination failure must not replace the account error");
  assert.deepEqual(Array.from(scope.state.activity, item => item.id), ["first-page"]);
});

test("normal background refresh generation does not discard an outstanding history page", async () => {
  const scope = harness();
  const pending = scope.load();
  await scope.started.promise;
  scope.context.refreshGeneration.current += 1;
  scope.page.resolve({ items: [{ id: "next-page" }], nextCursor: "next-cursor" });
  await pending;
  assert.deepEqual(Array.from(scope.state.activity, item => item.id), ["first-page", "next-page"]);
  assert.equal(scope.state.cursor, "next-cursor");
});

for (const mutation of ["addAccount", "addHardwareAccount", "addWatchOnly", "removeAccount", "restoreArchivedAccount", "restoreAccountByIndex", "restoreWalletFromBackup"]) {
  test(`${mutation} revokes the previous activity page before replacing account state`, async () => {
    const scope = harness();
    const pending = scope.load();
    await scope.started.promise;
    await scope.mutate(mutation, "synthetic-input");
    scope.page.resolve({ items: [{ id: "obsolete-page" }], nextCursor: "obsolete-cursor" });
    await pending;
    assert.deepEqual(Array.from(scope.state.activity, item => item.id), []);
    assert.notEqual(scope.state.cursor, "obsolete-cursor");
  });
}

test("explicit pagination retry is single-flight and preserves prior rows", async () => {
  const scope = harness();
  const first = scope.load();
  await scope.started.promise;
  scope.page.reject(new Error("Synthetic transport failure"));
  await first;
  const retryPage = deferred();
  scope.pages.push(retryPage);
  const retry = scope.load({ retry: true });
  const duplicate = scope.load({ retry: true });
  await Promise.resolve();
  retryPage.resolve({ items: [{ id: "first-page" }, { id: "retried-page" }], nextCursor: null });
  await Promise.all([retry, duplicate]);
  assert.equal(scope.requests.length, 2);
  assert.deepEqual(Array.from(scope.state.activity, item => item.id), ["first-page", "retried-page"]);
  assert.equal(scope.state.cursor, null);
  assert.equal(scope.state.pageState, "idle");
});

for (const boundary of ["endpoint", "unmount"]) {
  test(`${boundary} cancellation aborts and ignores an outstanding history page`, async () => {
    const scope = harness();
    const cleanup = mountEffect(boundary === "endpoint"
      ? "STELLAR_ENDPOINTS_CHANGED_EVENT" : "() => activityPaginationLane.cancel()", scope.context);
    const pending = scope.load();
    await scope.started.promise;
    if (boundary === "endpoint") scope.context.window.dispatchEvent(new Event("synthetic-endpoint-change"));
    else cleanup();
    assert.equal(scope.requests[0][4].aborted, true);
    scope.page.resolve({ items: [{ id: "obsolete-page" }], nextCursor: "obsolete-cursor" });
    await pending;
    assert.deepEqual(Array.from(scope.state.activity, item => item.id), ["first-page"]);
    if (boundary === "endpoint") cleanup();
  });
}

test("obsolete failure and finally cannot overwrite a replacement pending request", async () => {
  const scope = harness();
  const first = scope.load();
  await scope.started.promise;
  scope.select("second");
  const replacement = deferred();
  scope.pages.push(replacement);
  const next = scope.load();
  await Promise.resolve();
  scope.page.reject(new Error("Synthetic obsolete failure"));
  await first;
  assert.equal(scope.state.pageState, "pending");
  assert.equal(scope.state.error, null);
  replacement.resolve({ items: [{ id: "current-page" }], nextCursor: null });
  await next;
  assert.equal(scope.state.pageState, "idle");
});

test("pagination forwards cancellation to the physical ledger request", async () => {
  const scope = harness();
  const pending = scope.load();
  await scope.started.promise;
  const signal = scope.requests[0][4];
  assert.equal(signal.aborted, false);
  scope.lock();
  assert.equal(signal.aborted, true);
  scope.page.resolve({ items: [], nextCursor: null });
  await pending;
});

test("installing an unlocked vault clears its previous cursor before the first page is ready", async () => {
  const scope = harness();
  await scope.mutate("installUnlockedVault", { accounts: [{ id: "second" }] });
  assert.equal(scope.state.activity.length, 0);
  assert.equal(scope.state.cursor, null);
  // A new provider render receives the committed cursor. It must not resume
  // the old session's deep continuation while the new first page is pending.
  scope.context.activityCursor = scope.state.cursor;
  await scope.load();
  assert.equal(scope.requests.length, 0);
});

test("installing an unlocked vault revokes any previous continuation", async () => {
  const scope = harness();
  const pending = scope.load();
  await scope.started.promise;
  await scope.mutate("installUnlockedVault", { accounts: [{ id: "second" }] });
  assert.equal(scope.requests[0][4].aborted, true);
  scope.page.resolve({ items: [{ id: "obsolete-page" }], nextCursor: "obsolete-cursor" });
  await pending;
  assert.equal(scope.state.activity.length, 0);
  assert.equal(scope.state.cursor, null);
});

test("the activity sentinel pauses after a local error and offers an explicit inline retry", () => {
  const dashboard = readFileSync(new URL("../src/components/Dashboard.tsx", import.meta.url), "utf8");
  const observer = dashboard.slice(dashboard.indexOf("const activitySentinelRef"), dashboard.indexOf("const xlm ="));
  assert.match(observer, /if\s*\([^\n]*loadMoreError/);
  assert.match(dashboard, /loadMoreActivity\(\{ retry: true \}\)/);
  assert.match(dashboard, /role="alert"[^>]*>\{loadMoreError\}/);
});

test("the browser activity fixture retains its external-network deny guard through teardown", async () => {
  const browserSource = readFileSync(new URL("../e2e/activity-pagination.spec.ts", import.meta.url), "utf8");
  const browserFile = ts.createSourceFile("activity-pagination.spec.ts", browserSource, ts.ScriptTarget.Latest, true);
  const declaration = browserFile.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "activityFixture");
  assert.ok(declaration);
  const compiled = ts.transpileModule(`(${declaration.getText(browserFile)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const routes = new Map();
  const context = {
    route: async (pattern, handler) => routes.set(pattern, handler),
    routeWebSocket: async () => {},
    unrouteAll: async () => routes.clear(),
  };
  const createFixture = vm.runInNewContext(compiled, {
    URL, installQuietEventSource: async () => {}, installNetworkFixtures: async () => {},
  });
  const fixture = await createFixture(context, "http://127.0.0.1:3187");
  const handlePage = routes.get("https://horizon-testnet.stellar.org/accounts/*/operations?*");
  const statuses = [];
  const route = {
    request: () => ({ url: () => "https://horizon-testnet.stellar.org/accounts/synthetic/operations?cursor=synthetic" }),
    fulfill: async ({ status }) => { await Promise.resolve(); statuses.push(status); },
  };
  await handlePage(route);
  const heldRetry = handlePage(route);
  await fixture.dispose();
  assert.deepEqual(statuses, [400, 400], "Teardown must drain the held retry without unguarding the page");
  await heldRetry;
  assert.equal(routes.has("**/*"), true, "The deny-external route must live until context closure");
  let aborted = false;
  await routes.get("**/*")({
    request: () => ({ url: () => "https://external.invalid/synthetic" }),
    abort: async () => { aborted = true; },
  });
  assert.equal(aborted, true);
});
