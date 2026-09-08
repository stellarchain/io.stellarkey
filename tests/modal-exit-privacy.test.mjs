import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(`../src/components/${path}.tsx`, import.meta.url), 'utf8');

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
