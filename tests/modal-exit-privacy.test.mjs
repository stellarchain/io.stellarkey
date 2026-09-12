import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const read = path => readFileSync(new URL(`../src/components/${path}.tsx`, import.meta.url), 'utf8');

const parsed = ts.createSourceFile('ui.tsx', read('ui'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const boundary = parsed.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'ModalExitGeometry');
const compiledBoundary = ts.transpileModule(boundary.getText(parsed), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const ExitGeometry = new Function('React', `${compiledBoundary}; return ModalExitGeometry;`)({
  Component: class { constructor(props) { this.props = props; } },
});

for (const presentation of ['card', 'sheet', 'alert', 'fullscreen']) test(`exit geometry captures only layout dimensions and clears them on reopen: ${presentation}`, () => {
  const style = {
    maxHeight: '90dvh',
    removeProperty(name) { delete this[{ 'max-width': 'maxWidth' }[name] ?? name]; },
  };
  const panel = { offsetWidth: 360, offsetHeight: 520, style };
  const component = new ExitGeometry({ closing: true, presentation, panelRef: { current: panel }, children: null });
  const previous = { ...component.props, closing: false };
  const snapshot = component.getSnapshotBeforeUpdate(previous);
  assert.deepEqual(snapshot, presentation === 'fullscreen' ? null : { width: 360, height: 520 });
  // React removes private content between snapshot and layout publication.
  panel.offsetHeight = 80;
  component.componentDidUpdate(previous, {}, snapshot);
  assert.equal(style.height, presentation === 'fullscreen' ? undefined : '520px');
  assert.equal(style.width, presentation === 'card' || presentation === 'alert' ? '360px' : undefined);
  assert.equal(component.getSnapshotBeforeUpdate(component.props), null, 'closing rerenders must not recapture the cleared body');
  component.props = { ...previous };
  component.componentDidUpdate({ ...previous, closing: true }, {}, null);
  assert.equal(style.height, undefined);
  assert.equal(style.width, undefined);
  assert.equal(style.maxWidth, undefined);
  assert.equal(style.maxHeight, '90dvh', 'viewport constraints retain their own owner');
});

for (const component of ['AddAccountModal', 'MultiSigStudioModal', 'BatchSendModal']) {
  test(`${component} removes its sensitive body on close while retaining the shell`, () => {
    const source = read(component);
    assert.equal(source.includes('<Modal\n') && source.includes('open={open}'), true);
    assert.equal(/\{open \? \(\s*<[A-Za-z]+ModalBody/.test(source), true,
      'sensitive body must belong to current opening, not animation presence');
    assert.equal(/useMountedThroughExit\(open\)/.test(source), false);
  });
}

test('transaction detail exit retains no transaction item or note', () => {
  const source = read('TxDetailModal');
  assert.equal(source.includes('useRetainedForExit(item)'), false);
  assert.equal(/\{item \? \(\s*<TxDetailModalBody/.test(source), true);
});

for (const [component, prop] of [['RenameAccountModal', 'account'], ['AssetDetailModal', 'asset']]) {
  test(`${component} retains no wallet-associated payload solely for exit`, () => {
    const source = read(component);
    assert.equal(source.includes('useRetainedForExit('), false);
    assert.equal(source.includes(`{${prop} ? (`), true);
  });
}
