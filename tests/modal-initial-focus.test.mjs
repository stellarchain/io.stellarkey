import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the real Modal ownership effects with controllable browser/React
// scheduling. A non-interaction commit may paint before passive effects run.
const source = readFileSync(new URL('../src/components/ui.tsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('ui.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const modal = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'Modal');
assert.ok(modal?.body);
const effects = modal.body.statements.flatMap(node => {
  if (!ts.isExpressionStatement(node) || !ts.isCallExpression(node.expression)) return [];
  const kind = node.expression.expression.getText(parsed);
  if (!['useEffect', 'useLayoutEffect'].includes(kind)) return [];
  const callback = node.expression.arguments[0].getText(parsed);
  if (!callback.includes('lockBodyScroll();') && !callback.includes('registerModal(modal)')
    && !(callback.includes('const first =') && callback.includes('window.requestAnimationFrame'))) return [];
  return [{ kind, callback }];
});
assert.equal(effects.length, 3, 'scroll lock, stack registration and initial focus stay separate owned effects');

function opening({ initialFocus = null } = {}) {
  const frames = new Map();
  let nextFrame = 0;
  const document = { activeElement: null, body: null };
  class Element {
    isConnected = true;
    constructor(label) { this.label = label; }
    focus() { if (this.isConnected) document.activeElement = this; }
    matches() { return false; }
  }
  const opener = new Element('opener');
  const first = new Element('first-control');
  const panel = new Element('panel');
  const backdrop = new Element('backdrop');
  const body = new Element('body');
  panel.contains = node => node === panel || node === first;
  panel.querySelector = () => first;
  document.activeElement = opener;
  document.body = body;
  let locks = 0;
  let top = null;
  const context = vm.createContext({
    open: true, mounted: true, document, HTMLElement: Element, latestPointerTarget: null,
    panelRef: { current: panel }, backdropRef: { current: backdrop },
    restoreFocusRef: { current: null }, restoreFocusFrameRef: { current: null },
    initialFocusRef: { current: initialFocus === 'first' ? { current: first } : initialFocus === 'function' ? () => first : null },
    window: {
      requestAnimationFrame(callback) { frames.set(++nextFrame, callback); return nextFrame; },
      cancelAnimationFrame(id) { frames.delete(id); },
    },
    lockBodyScroll() { locks += 1; }, unlockBodyScroll() { locks -= 1; },
    registerModal(value) { top = value; }, unregisterModal() { top = null; },
    isTopModal(value) { return value === top; },
  });
  const cleanups = [];
  const runEffects = kind => {
    for (const effect of effects.filter(effect => effect.kind === kind)) {
      const callback = vm.runInContext(ts.transpileModule(`(${effect.callback})`, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
      }).outputText, context);
      const cleanup = callback();
      if (cleanup) cleanups.push({ kind, cleanup });
    }
  };
  const frame = () => {
    const current = [...frames.values()]; frames.clear();
    for (const callback of current) callback(0);
  };
  return { document, opener, first, panel, frame, runEffects, get locks() { return locks; }, close() {
    for (const item of cleanups.filter(item => item.kind === 'useLayoutEffect')) item.cleanup();
    panel.isConnected = false; first.isConnected = false; backdrop.isConnected = false;
    document.activeElement = body;
    for (const item of cleanups.filter(item => item.kind === 'useEffect')) item.cleanup();
    frame();
  } };
}

for (const deferredPassiveEffects of [false, true]) test(`Modal captures its opener, focuses the dialog itself, and restores the opener when passive effects are ${deferredPassiveEffects ? 'after' : 'before'} the frame`, () => {
  const view = opening();
  view.runEffects('useLayoutEffect');
  if (deferredPassiveEffects) view.frame();
  view.runEffects('useEffect');
  if (!deferredPassiveEffects) view.frame();
  assert.equal(view.document.activeElement, view.panel, 'the dialog is announced by name before any control receives focus');
  assert.equal(view.locks, 1);
  view.close();
  assert.equal(view.document.activeElement, view.opener, 'closing restores the surviving opener, not the removed first control');
  assert.equal(view.locks, 0);
});

for (const initialFocus of ['first', 'function']) test(`Modal honours an explicit initialFocus ${initialFocus === 'first' ? 'ref' : 'resolver'} inside the panel`, () => {
  const view = opening({ initialFocus });
  view.runEffects('useLayoutEffect');
  view.runEffects('useEffect');
  view.frame();
  assert.equal(view.document.activeElement, view.first);
});

test('Modal never moves focus that a child already placed inside the panel', () => {
  const view = opening({ initialFocus: 'first' });
  view.runEffects('useLayoutEffect');
  view.runEffects('useEffect');
  view.document.activeElement = view.panel;
  view.frame();
  assert.equal(view.document.activeElement, view.panel);
});

test('the shell never focuses the header close control by default', () => {
  const focusEffect = effects.find(effect => effect.callback.includes('const first ='));
  assert.ok(focusEffect);
  assert.doesNotMatch(focusEffect.callback, /querySelector<HTMLElement>\(\s*'input:not/, 'the first-focusable query has been retired');
  assert.match(focusEffect.callback, /\(first \?\? panel\)\.focus/);
});
