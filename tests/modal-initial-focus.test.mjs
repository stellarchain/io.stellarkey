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

function opening({ initialFocus = null, pointerOpening = false, nested = false } = {}) {
  const frames = new Map();
  let nextFrame = 0;
  const document = { activeElement: null, body: null };
  class Element {
    connected = true;
    attributes = new Set();
    children = [];
    disabled = false;
    ariaDisabled = false;
    inert = false;
    constructor(label, parentElement = null) {
      this.label = label;
      this.parentElement = parentElement;
      parentElement?.children.push(this);
    }
    get isConnected() { return this.connected && (!this.parentElement || this.parentElement.isConnected); }
    focus() { if (this.isConnected && !this.disabled && !this.closest('[inert]')) document.activeElement = this; }
    matches(selectors) {
      return selectors.split(',').some(value => {
        const selector = value.trim();
        if (selector === ':disabled') return this.disabled;
        if (selector === '[inert]') return this.inert;
        if (/^\[aria-disabled=['"]true['"]\]$/.test(selector)) return this.ariaDisabled;
        return this.attributes.has(selector);
      });
    }
    closest(selector) {
      return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null;
    }
    contains(node) {
      for (let ancestor = node; ancestor; ancestor = ancestor.parentElement) if (ancestor === this) return true;
      return false;
    }
    querySelector(selector) {
      for (const child of this.children) {
        if (child.matches(selector)) return child;
        const descendant = child.querySelector(selector);
        if (descendant) return descendant;
      }
      return null;
    }
    remove() {
      if (this.contains(document.activeElement)) document.activeElement = document.body;
      if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this);
      this.parentElement = null;
      this.connected = false;
    }
  }
  const body = new Element('body');
  const returnOwner = nested ? new Element('previous-backdrop', body) : null;
  returnOwner?.attributes.add('[data-modal-backdrop]');
  const previousPanel = new Element('previous-panel', returnOwner ?? body);
  const opener = new Element('opener', nested ? previousPanel : body);
  const backdrop = new Element('backdrop', body);
  backdrop.attributes.add('[data-modal-backdrop]');
  const panel = new Element('panel', backdrop);
  const first = new Element('first-control', panel);
  document.activeElement = pointerOpening ? previousPanel : opener;
  document.body = body;
  let locks = 0;
  const modalStack = returnOwner ? [returnOwner] : [];
  const syncInertness = () => { for (const entry of modalStack) entry.inert = entry !== modalStack.at(-1); };
  const registerModal = value => { if (!modalStack.includes(value)) modalStack.push(value); syncInertness(); };
  const context = vm.createContext({
    open: true, mounted: true, document, HTMLElement: Element, latestPointerTarget: pointerOpening ? opener : null,
    panelRef: { current: panel }, backdropRef: { current: backdrop },
    restoreFocusRef: { current: null }, restoreFocusFrameRef: { current: null },
    initialFocusRef: { current: initialFocus === 'first' ? { current: first } : initialFocus === 'function' ? () => first : null },
    window: {
      requestAnimationFrame(callback) { frames.set(++nextFrame, callback); return nextFrame; },
      cancelAnimationFrame(id) { frames.delete(id); },
    },
    lockBodyScroll() { locks += 1; }, unlockBodyScroll() { locks -= 1; },
    modalStack, registerModal,
    unregisterModal(value) {
      const index = modalStack.indexOf(value);
      if (index >= 0) modalStack.splice(index, 1);
      value.inert = false; syncInertness();
    },
    isTopModal(value) { return value === modalStack.at(-1); },
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
  return { document, opener, first, panel, previousPanel, returnOwner, frame, runEffects, registerModal,
    element: (label, parent = body) => new Element(label, parent),
    get locks() { return locks; }, close(beforeReturn = () => {}) {
    for (const item of cleanups.filter(item => item.kind === 'useLayoutEffect')) item.cleanup();
    backdrop.remove();
    for (const item of cleanups.filter(item => item.kind === 'useEffect')) item.cleanup();
    beforeReturn();
    frame();
  } };
}

test('Modal return preserves a newer focus choice before its restoration frame', () => {
  const view = opening();
  view.runEffects('useLayoutEffect'); view.frame();
  const newer = view.element('newer-focus');
  view.close(() => newer.focus());
  assert.equal(view.document.activeElement, newer);
});

test('Modal returns to an explicit result in the original parent when its opener was removed', () => {
  const view = opening({ nested: true });
  view.runEffects('useLayoutEffect'); view.frame();
  const result = view.element('result', view.previousPanel);
  result.attributes.add('[data-modal-return-focus]');
  view.opener.remove();
  view.close();
  assert.equal(view.document.activeElement, result);
});

for (const unavailable of ['disabled', 'inert', 'removed-owner', 'missing-target']) test(`Modal return rejects an unavailable continuation: ${unavailable}`, () => {
  const view = opening({ nested: true });
  view.runEffects('useLayoutEffect'); view.frame();
  const result = view.element('result', view.previousPanel);
  if (unavailable !== 'missing-target') result.attributes.add('[data-modal-return-focus]');
  view.opener.remove();
  view.close(() => {
    if (unavailable === 'disabled') result.disabled = true;
    if (unavailable === 'inert') view.previousPanel.inert = true;
    if (unavailable === 'removed-owner') view.returnOwner.remove();
  });
  assert.equal(view.document.activeElement, view.document.body);
});

test('Modal return retains an aria-disabled opener that intentionally stays focusable', () => {
  const view = opening({ nested: true });
  view.runEffects('useLayoutEffect'); view.frame();
  view.opener.ariaDisabled = true;
  view.close();
  assert.equal(view.document.activeElement, view.opener);
});

test('Modal return cannot reach its original parent behind a newer top dialog', () => {
  const view = opening({ nested: true });
  view.runEffects('useLayoutEffect'); view.frame();
  const result = view.element('result', view.previousPanel);
  result.attributes.add('[data-modal-return-focus]');
  view.opener.remove();
  view.close(() => view.registerModal(view.element('newer-modal')));
  assert.equal(view.document.activeElement, view.document.body);
});

test('Modal restores a pointer opener when WebKit leaves focus in the previous dialog', () => {
  const view = opening({ pointerOpening: true });
  view.runEffects('useLayoutEffect');
  view.runEffects('useEffect');
  view.frame();
  view.close();
  assert.equal(view.document.activeElement, view.opener);
});

test('keyboard intent revokes an older captured pointer opener', () => {
  const installation = parsed.statements.find(node => ts.isIfStatement(node)
    && node.expression.getText(parsed).includes('pointerCaptureDocument'));
  assert.ok(installation);
  const listeners = new Map();
  class Element { closest() { return this; } }
  const context = vm.createContext({
    pointerCaptureDocument: { addEventListener(type, callback) { listeners.set(type, callback); } },
    latestPointerTarget: null, Element, HTMLElement: Element,
  });
  vm.runInContext(ts.transpileModule(installation.getText(parsed), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  const pointerOpener = new Element();
  listeners.get('pointerdown')({ target: pointerOpener });
  assert.equal(context.latestPointerTarget, pointerOpener);
  listeners.get('keydown')({ key: 'Enter' });
  assert.equal(context.latestPointerTarget, null);
});

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
