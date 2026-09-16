import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/components/ServiceWorkerRegistration.tsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('ServiceWorkerRegistration.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let effect;
function visit(node) {
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
  const mount = vm.runInNewContext(effect, {
    navigator: { serviceWorker }, document: { readyState }, window,
    process: { env: { NODE_ENV: 'production' } },
    setWaiting: worker => offers.push(worker), reloadRequested,
  });
  const registration = new TrackedTarget();
  registration.waiting = {};
  registration.installing = new TrackedTarget();
  return { mount, pending, offers, serviceWorker, window, registration, reloadRequested, reloads: () => reloads };
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
  assert.equal(h.offers.length, 2);
  h.serviceWorker.dispatchEvent(new Event('controllerchange'));
  assert.equal(h.reloads(), 0);
  h.reloadRequested.current = true;
  h.serviceWorker.dispatchEvent(new Event('controllerchange'));
  h.serviceWorker.dispatchEvent(new Event('controllerchange'));
  assert.equal(h.reloads(), 1);
  cleanup();
  assert.equal(h.registration.listeners.size, 0);
  assert.equal(h.registration.installing.listeners.size, 0);
  assert.equal(h.serviceWorker.listeners.size, 0);
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
