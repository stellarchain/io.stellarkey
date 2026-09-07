import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function subtitle(mode, accounts, archivedAccounts) {
  const source = readFileSync(new URL('../src/components/AddAccountModalBody.tsx', import.meta.url), 'utf8');
  const parsed = ts.createSourceFile('AddAccountModalBody.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === 'subtitle') expression = node.initializer.getText(parsed);
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.ok(expression);
  return vm.runInNewContext(ts.transpileModule(`(${expression})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { mode, accounts, archivedAccounts });
}

function metadata(properties) {
  return Object.defineProperty({ ...properties }, 'secret', {
    get() { throw new Error('Account wording must not read signer material.'); },
  });
}

const layouts = {
  derived: { accounts: [metadata({ id: 'derived', index: 0 })], archivedAccounts: [] },
  imported: { accounts: [metadata({ id: 'imported' })], archivedAccounts: [] },
  watched: { accounts: [metadata({ id: 'watched', watchOnly: true })], archivedAccounts: [] },
  mixed: { accounts: [metadata({ id: 'derived', index: 0 }), metadata({ id: 'imported' }), metadata({ id: 'watched', watchOnly: true })], archivedAccounts: [metadata({ id: 'archived', index: 8 })] },
  archived: { accounts: [metadata({ id: 'derived', index: 3 })], archivedAccounts: [metadata({ id: 'older', index: 11 }), metadata({ id: 'watched', watchOnly: true })] },
};

const expected = {
  generate: "Create another account from this wallet's recovery phrase",
  import: 'Import an existing Stellar secret key',
  watch: 'Track any address — balances only, no keys',
  hardware: 'Connect a device and verify its Stellar address',
};

for (const [layout, data] of Object.entries(layouts)) {
  for (const [mode, wording] of Object.entries(expected)) {
    test(`${mode} account wording stays accurate with ${layout} metadata`, () => {
      assert.equal(subtitle(mode, data.accounts, data.archivedAccounts), wording);
    });
  }
}
