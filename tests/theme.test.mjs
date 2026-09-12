import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as theme from '../src/lib/theme.ts';

const source = readFileSync(new URL('../src/components/ThemeController.tsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('ThemeController.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let effect;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(parsed) === 'useEffect') {
    effect = node.arguments[0].getText(parsed);
  }
  ts.forEachChild(node, visit);
}
visit(parsed);

function browser(t, { stored = null, light = false, blockRead = false, blockWrite = false } = {}) {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const events = new EventTarget();
  const media = new EventTarget();
  media.matches = light;
  const entries = new Map(stored === null ? [] : [[theme.THEME_STORAGE_KEY, stored]]);
  const storage = {
    getItem: key => { if (blockRead) throw new Error('Synthetic storage read blocked'); return entries.get(key) ?? null; },
    setItem: (key, value) => { if (blockWrite) throw new Error('Synthetic storage write blocked'); entries.set(key, value); },
  };
  const meta = new Map();
  const metaElement = { setAttribute: (key, value) => meta.set(key, value) };
  const document = {
    documentElement: { dataset: {} },
    querySelector: () => metaElement,
    createElement: () => metaElement,
    head: { appendChild() {} },
  };
  const window = Object.assign(events, { localStorage: storage, matchMedia: () => media });
  globalThis.window = window;
  globalThis.document = document;
  const cleanups = [];
  t.after(() => {
    for (const cleanup of cleanups.reverse()) cleanup();
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  });
  return {
    window, document, meta, entries,
    start() {
      const setup = vm.runInNewContext(ts.transpileModule(`(${effect})`, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
      }).outputText, { ...theme, window, document });
      const cleanup = setup();
      cleanups.push(cleanup);
      return cleanup;
    },
    system(next) { media.matches = next; media.dispatchEvent(new Event('change')); },
    stored(next, key = theme.THEME_STORAGE_KEY) {
      if (key === null) entries.clear();
      else if (next === null) entries.delete(key);
      else entries.set(key, next);
      const event = new Event('storage');
      Object.defineProperties(event, { key: { value: key }, newValue: { value: next }, storageArea: { value: storage } });
      window.dispatchEvent(event);
    },
  };
}

for (const blockRead of [false, true]) {
  test(`the real theme controller retains explicit selection with blocked writes and read blocking ${blockRead}`, t => {
    const h = browser(t, { stored: 'dark', blockWrite: true, blockRead });
    h.start();
    theme.setThemePreference('light');
    assert.equal(h.document.documentElement.dataset.theme, 'light');
    assert.equal(theme.getStoredThemePreference(), 'light');
    assert.equal(h.meta.get('content'), '#f2f2f7');
    h.system(false);
    assert.equal(h.document.documentElement.dataset.theme, 'light');
    theme.setThemePreference('system');
    assert.equal(h.document.documentElement.dataset.theme, 'dark');
    h.system(true);
    assert.equal(h.document.documentElement.dataset.theme, 'light');
  });
}

test('pre-paint appearance still follows the system when local storage is blocked', t => {
  const h = browser(t, { light: true, blockRead: true });
  vm.runInNewContext(theme.THEME_INIT_SCRIPT, {
    window: h.window, document: h.document, localStorage: h.window.localStorage,
  });
  assert.equal(h.document.documentElement.dataset.theme, 'light');
});

test('theme storage events update the same snapshot consumed by mounted controls and the controller', t => {
  const h = browser(t);
  assert.equal(typeof theme.subscribeThemePreference, 'function');
  h.start();
  const observed = [];
  const unsubscribe = theme.subscribeThemePreference(() => { observed.push(theme.getStoredThemePreference()); });
  t.after(unsubscribe);
  theme.setThemePreference('light');
  h.stored('dark');
  assert.equal(theme.getStoredThemePreference(), 'dark');
  assert.equal(h.document.documentElement.dataset.theme, 'dark');
  h.stored('unrelated', 'another.preference');
  assert.deepEqual(observed, ['light', 'dark']);
  h.stored(null, null);
  assert.equal(theme.getStoredThemePreference(), 'system');
  assert.deepEqual(observed, ['light', 'dark', 'system']);
  unsubscribe();
  theme.setThemePreference('light');
  assert.equal(observed.length, 3, 'Disposed controls no longer receive publications');
});

test('system changes never override an explicit theme and controller cleanup removes observers', t => {
  const h = browser(t, { stored: 'light' });
  const cleanup = h.start();
  h.system(false);
  assert.equal(h.document.documentElement.dataset.theme, 'light');
  theme.setThemePreference('system');
  assert.equal(h.document.documentElement.dataset.theme, 'dark');
  h.system(true);
  assert.equal(h.document.documentElement.dataset.theme, 'light');
  cleanup();
  h.system(false);
  assert.equal(h.document.documentElement.dataset.theme, 'light');
});

test('rapid preference changes and controller remount keep the final unpersisted selection', t => {
  const h = browser(t, { blockWrite: true });
  const cleanup = h.start();
  for (const preference of ['light', 'dark', 'system', 'dark', 'light']) theme.setThemePreference(preference);
  cleanup();
  h.start();
  assert.equal(theme.getStoredThemePreference(), 'light');
  assert.equal(h.document.documentElement.dataset.theme, 'light');
});

test('server rendering has a stable system snapshot and invalid saved preferences use system', t => {
  const h = browser(t, { stored: 'not-a-theme', light: true });
  assert.equal(theme.getStoredThemePreference(), 'system');
  h.start();
  assert.equal(h.document.documentElement.dataset.theme, 'light');
  globalThis.window = undefined;
  assert.equal(theme.getStoredThemePreference(), 'system');
});
