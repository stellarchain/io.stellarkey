import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/components/ServiceWorkerRegistration.tsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('ServiceWorkerRegistration.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let effect;
let identityFunction;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'workerMatchesPage') {
    identityFunction = ts.transpileModule(`(${node.getText(parsed)})`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText;
  }
  if (ts.isCallExpression(node) && node.expression.getText(parsed) === 'useEffect') {
    effect = ts.transpileModule(`(${node.arguments[0].getText(parsed)})`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText;
  }
  ts.forEachChild(node, visit);
}
visit(parsed);
assert.ok(effect, 'exercise the production registration effect');

class TrackedTarget extends EventTarget {
  listeners = new Set();
  addEventListener(type, listener, options) {
    this.listeners.add(listener);
    super.addEventListener(type, listener, options);
  }
  removeEventListener(type, listener, options) {
    this.listeners.delete(listener);
    super.removeEventListener(type, listener, options);
  }
}

function harness(readyState = 'complete') {
  const pending = [];
  const offers = [];
  const serviceWorker = new TrackedTarget();
  serviceWorker.controller = {};
  serviceWorker.register = (url, options) => {
    assert.equal(url, '/sw.js');
    assert.equal(options.scope, '/');
    assert.equal(options.updateViaCache, 'none');
    return new Promise((resolve, reject) => pending.push({ resolve, reject }));
  };
  const window = new TrackedTarget();
  let reloads = 0;
  window.location = { reload() { reloads++; } };
  const reloadRequested = { current: false };
  const activateUpdateRef = { current: () => {} };
  const activationStates = [];
  const errors = [];
  const timers = new Map();
  let now = 0;
  window.setTimeout = callback => { const id = Symbol(); timers.set(id, callback); return id; };
  window.clearTimeout = id => timers.delete(id);
  const matches = [];
  const mount = vm.runInNewContext(effect, {
    navigator: { serviceWorker }, document: { readyState }, window,
    process: { env: { NODE_ENV: 'production' } },
    setWaiting: worker => offers.push(worker), reloadRequested,
    activateUpdateRef,
    setActivationRequested: value => activationStates.push(value),
    setUpdateError: value => errors.push(value),
    AbortController,
    Date: { now: () => now },
    workerMatchesPage: (...args) => matches.length ? matches.shift()(...args) : Promise.resolve(false),
  });
  const registration = new TrackedTarget();
  registration.waiting = new TrackedTarget();
  registration.waiting.state = 'installed';
  registration.waiting.postMessage = () => {};
  registration.installing = new TrackedTarget();
  return { mount, pending, offers, serviceWorker, window, registration, reloadRequested, reloads: () => reloads,
    matches, activateUpdateRef, activationStates, errors, timers, advance: ms => { now += ms; } };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test('late registration cannot attach listeners or offer an update after unmount', async () => {
  const h = harness();
  const cleanup = h.mount();
  cleanup();
  h.pending[0].resolve(h.registration);
  await settle();
  assert.equal(h.registration.listeners.size, 0);
  assert.equal(h.serviceWorker.listeners.size, 0);
  assert.equal(h.offers.length, 0);
});

test('an earlier mount cannot publish over the current registration', async () => {
  const h = harness();
  h.mount()();
  const cleanup = h.mount();
  h.pending[1].resolve(h.registration);
  await settle();
  h.pending[0].resolve(h.registration);
  await settle();
  assert.deepEqual(h.offers, [h.registration.waiting]);
  assert.equal(h.registration.listeners.size, 1);
  cleanup();
  assert.equal(h.registration.listeners.size, 0);
});

test('active registration retains consent, installation updates and complete listener cleanup', async () => {
  const h = harness();
  const cleanup = h.mount();
  h.pending[0].resolve(h.registration);
  await settle();
  assert.deepEqual(h.offers, [h.registration.waiting]);
  h.registration.dispatchEvent(new Event('updatefound'));
  const previousInstaller = h.registration.installing;
  h.registration.installing = new TrackedTarget();
  h.registration.dispatchEvent(new Event('updatefound'));
  assert.equal(previousInstaller.listeners.size, 0);
  assert.equal(h.registration.installing.listeners.size, 1);
  h.registration.installing.state = 'installed';
  h.registration.installing.dispatchEvent(new Event('statechange'));
  await settle();
  assert.equal(h.offers.length, 2);
  h.serviceWorker.dispatchEvent(new Event('controllerchange'));
  assert.equal(h.reloads(), 0);
  h.activateUpdateRef.current();
  h.serviceWorker.dispatchEvent(new Event('controllerchange'));
  h.serviceWorker.dispatchEvent(new Event('controllerchange'));
  assert.equal(h.reloads(), 1);
  cleanup();
  assert.equal(h.registration.listeners.size, 0);
  assert.equal(h.registration.installing.listeners.size, 0);
  assert.equal(h.serviceWorker.listeners.size, 0);
});

test('refreshing into the waiting release does not offer the same update again', async () => {
  const h = harness();
  h.matches.push(() => Promise.resolve(true));
  const cleanup = h.mount();
  h.pending[0].resolve(h.registration);
  await settle();
  assert.equal(h.offers.at(-1), null);
  assert.equal(h.reloads(), 0);
  cleanup();
});

test('a redundant waiting worker clears the banner and its listener', async () => {
  const h = harness();
  const cleanup = h.mount();
  h.pending[0].resolve(h.registration);
  await settle();
  const worker = h.registration.waiting;
  h.registration.waiting = null;
  worker.state = 'redundant';
  worker.dispatchEvent(new Event('statechange'));
  await settle();
  assert.equal(h.offers.at(-1), null);
  assert.equal(worker.listeners.size, 0);
  cleanup();
});

test('an installer already present when registration resolves is observed', async () => {
  const h = harness();
  h.registration.waiting = null;
  const cleanup = h.mount();
  h.pending[0].resolve(h.registration);
  await settle();
  const worker = h.registration.installing;
  worker.state = 'installed';
  h.registration.waiting = worker;
  worker.dispatchEvent(new Event('statechange'));
  await settle();
  assert.equal(h.offers.at(-1), worker);
  cleanup();
  assert.equal(worker.listeners.size, 0);
});

test('late worker identity replies cannot republish a disappeared update', async () => {
  const h = harness();
  let resolve;
  h.matches.push(() => new Promise(done => { resolve = done; }));
  const cleanup = h.mount();
  h.pending[0].resolve(h.registration);
  await settle();
  const worker = h.registration.waiting;
  h.registration.waiting = null;
  worker.state = 'redundant';
  worker.dispatchEvent(new Event('statechange'));
  resolve(false);
  await settle();
  assert.equal(h.offers.at(-1), null);
  cleanup();
});

test('activation uses the current worker, times out visibly, and can be retried', async () => {
  const h = harness();
  const cleanup = h.mount();
  h.pending[0].resolve(h.registration);
  await settle();
  let messages = 0;
  h.registration.waiting.postMessage = message => { assert.equal(message.type, 'SKIP_WAITING'); messages++; };
  h.activateUpdateRef.current();
  h.activateUpdateRef.current();
  assert.equal(messages, 1);
  assert.equal(h.activationStates.at(-1), true);
  for (const callback of [...h.timers.values()]) callback();
  await settle();
  assert.equal(h.activationStates.at(-1), false);
  assert.match(h.errors.at(-1), /try again/i);
  assert.equal(h.reloadRequested.current, false);
  h.activateUpdateRef.current();
  assert.equal(messages, 2);
  cleanup();
  assert.equal(h.timers.size, 0);
});

test('an update activated by another tab does not force a reload but remains actionable', async () => {
  const h = harness();
  const cleanup = h.mount();
  h.pending[0].resolve(h.registration);
  await settle();
  const worker = h.registration.waiting;
  h.registration.waiting = null;
  worker.state = 'activated';
  h.serviceWorker.controller = worker;
  h.serviceWorker.dispatchEvent(new Event('controllerchange'));
  await settle();
  assert.equal(h.reloads(), 0);
  h.activateUpdateRef.current();
  h.activateUpdateRef.current();
  assert.equal(h.reloads(), 1);
  cleanup();
});

test('posting to a terminated worker restores a retryable action', async () => {
  const h = harness();
  const cleanup = h.mount();
  h.pending[0].resolve(h.registration);
  await settle();
  h.registration.waiting.postMessage = () => { throw new Error('Synthetic terminated worker'); };
  h.activateUpdateRef.current();
  assert.equal(h.activationStates.at(-1), false);
  assert.match(h.errors.at(-1), /try again/i);
  assert.equal(h.timers.size, 0);
  assert.equal(h.reloadRequested.current, false);
  cleanup();
});

test('expired consent cannot reload a resumed tab even when its timeout was throttled', async () => {
  const h = harness();
  const cleanup = h.mount();
  h.pending[0].resolve(h.registration);
  await settle();
  h.activateUpdateRef.current();
  h.advance(60_000);
  h.serviceWorker.controller = h.registration.waiting;
  h.registration.waiting.state = 'activated';
  h.registration.waiting = null;
  h.serviceWorker.dispatchEvent(new Event('controllerchange'));
  await settle();
  assert.equal(h.reloads(), 0);
  assert.equal(h.activationStates.at(-1), false);
  cleanup();
});

test('unmount before page load cancels the deferred registration', () => {
  const h = harness('loading');
  h.mount()();
  h.window.dispatchEvent(new Event('load'));
  assert.equal(h.pending.length, 0);
  assert.equal(h.window.listeners.size, 0);
});

test('registration rejection leaves the app available without an update offer', async () => {
  const h = harness();
  const cleanup = h.mount();
  h.pending[0].reject(new Error('Synthetic registration failure'));
  await settle();
  assert.equal(h.offers.length, 0);
  cleanup();
  assert.equal(h.serviceWorker.listeners.size, 0);
});

function identityHarness(dirty = false) {
  const timers = new Map();
  const channels = [];
  class Channel {
    port1 = { onmessage: null, closed: false, close() { this.closed = true; } };
    port2 = { closed: false, close() { this.closed = true; } };
    constructor() { channels.push(this); }
  }
  const query = vm.runInNewContext(identityFunction, {
    BUILD_IS_DIRTY: dirty, BUILD_COMMIT: 'a'.repeat(40), APPLICATION_VERSION: '1.0.4',
    MessageChannel: Channel,
    window: {
      setTimeout: callback => { const id = Symbol(); timers.set(id, callback); return id; },
      clearTimeout: id => timers.delete(id),
    },
  });
  const worker = { postMessage(message, ports) {
    assert.equal(message.type, 'GET_RELEASE');
    assert.equal(ports[0], channels.at(-1).port2);
  } };
  const abort = new AbortController();
  return { query: () => query(worker, abort.signal), worker, abort, timers, channels };
}

test('identity matching requires the exact clean release, not just a version number', async () => {
  for (const [release, expected] of [
    [{ commit: 'a'.repeat(40), version: '1.0.4', sourceTree: 'clean' }, true],
    [{ commit: 'b'.repeat(40), version: '1.0.4', sourceTree: 'clean' }, false],
    [{ commit: 'a'.repeat(40), version: '1.0.3', sourceTree: 'clean' }, false],
    [{ commit: 'a'.repeat(40), version: '1.0.4', sourceTree: 'dirty' }, false],
    [null, false],
  ]) {
    const h = identityHarness();
    const result = h.query();
    h.channels[0].port1.onmessage({ data: release });
    assert.equal(await result, expected);
    assert.equal(h.timers.size, 0);
    assert.equal(h.channels[0].port1.closed, true);
    assert.equal(h.channels[0].port2.closed, true);
  }
});

test('identity requests to old, terminated or abandoned workers are bounded and cleaned up', async () => {
  for (const outcome of ['timeout', 'abort', 'throw']) {
    const h = identityHarness();
    if (outcome === 'throw') h.worker.postMessage = () => { throw new Error('Synthetic terminated worker'); };
    const result = h.query();
    if (outcome === 'timeout') for (const callback of [...h.timers.values()]) callback();
    if (outcome === 'abort') h.abort.abort();
    assert.equal(await result, false);
    assert.equal(h.timers.size, 0);
    assert.equal(h.channels[0].port1.closed, true);
    assert.equal(h.channels[0].port2.closed, true);
  }
});

test('dirty pages and already-aborted requests never claim a release match', async () => {
  const dirty = identityHarness(true);
  assert.equal(await dirty.query(), false);
  assert.equal(dirty.channels.length, 0);
  const abandoned = identityHarness();
  abandoned.abort.abort();
  assert.equal(await abandoned.query(), false);
  assert.equal(abandoned.channels.length, 0);
});
