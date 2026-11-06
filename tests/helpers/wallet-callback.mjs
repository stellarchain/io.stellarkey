import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Exercise the actual provider callback while isolating React and browser I/O.
export function walletCallback(name, context) {
  const source = readFileSync(new URL('../../src/hooks/useWallet.tsx', import.meta.url), 'utf8');
  const parsed = ts.createSourceFile('useWallet.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === name && ts.isCallExpression(node.initializer)) {
      expression = node.initializer.arguments[0].getText(parsed);
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.ok(expression, 'The production callback must exist');
  return vm.runInNewContext(ts.transpileModule(`(${expression})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, context);
}
