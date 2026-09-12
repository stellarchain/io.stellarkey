import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';

// Exercise the production account-list JSX with isolated, unusable account data.
// No wallet is unlocked, browser state captured, or network request made.
const source = readFileSync(new URL('../src/components/Dashboard.tsx', import.meta.url), 'utf8');
const sidebar = source.slice(source.indexOf('{/* Accounts Subgroup'), source.indexOf('{/* Footer Controls */}'));
const expression = sidebar.slice(sidebar.indexOf('{!sidebarCollapsed') + 1, sidebar.lastIndexOf('}') );
const compiled = ts.transpileModule(`(${expression})`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, module: ts.ModuleKind.None },
}).outputText;
const render = env => vm.runInNewContext(compiled, { React, ...env });
const accounts = [{ id: 'a', publicKey: 'synthetic-a', label: 'Synthetic A' }, { id: 'b', publicKey: 'synthetic-b', label: 'Synthetic B' }];
const totals = { 'synthetic-a': { xlm: '14.0000000', usd: 10.5 }, 'synthetic-b': { xlm: '26.0000000', usd: 13.5 } };
function environment(activeId = 'a', privacyMode = false) {
  return { sidebarCollapsed: false, accounts, activeAccount: accounts.find(a => a.id === activeId), privacyMode,
    accountBalances: { 'synthetic-a': 10, 'synthetic-b': 20 },
    accountReferenceValues: { 'synthetic-a': 2.5, 'synthetic-b': 5 },
    accountTotals: totals, activeAccountXlm: totals[`synthetic-${activeId}`].xlm,
    activeAccountTotalUsd: totals[`synthetic-${activeId}`].usd,
    network: 'testnet', fiatCurrency: 'USD', fiatRates: {}, fmtAmount: value => String(Number(value)),
    fmtFiat: value => `$${value}`, setAddAccountOpen() {}, selectAccount() {}, triggerHaptic() {},
    AccountMark: () => null, IconTrezor: () => null, IconLedger: () => null };
}
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...nodes(tree.props?.children)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join('');
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  return tree && typeof tree === 'object' ? text(tree.props?.children) : '';
}
function rows(tree) { return nodes(tree).filter(n => n.type === 'button' && ['a', 'b'].includes(n.key)); }

test('actual sidebar keeps public plus private XLM and fiat stable across A → B → A', () => {
  const env = environment();
  env.selectAccount = id => Object.assign(env, environment(id), { selectAccount: env.selectAccount });
  const expected = ['Synthetic A14 XLM$10.5', 'Synthetic B26 XLM$13.5'];
  for (const next of ['b', 'a', 'b', 'a']) {
    const current = rows(render(env));
    assert.deepEqual(current.map(text), expected, 'Every account must count the same public and private funds regardless of selection');
    current.find(row => row.key === next).props.onClick();
    assert.equal(env.activeAccount.id, next);
  }
});

test('actual sidebar masks both balances and does not turn unknown totals into zero', () => {
  const masked = rows(render(environment('b', true))).map(text);
  assert.deepEqual(masked, ['Synthetic A••••••', 'Synthetic B••••••']);
  const env = environment();
  env.accountTotals = { ...totals, 'synthetic-b': { xlm: null, usd: null } };
  env.accountReferenceValues['synthetic-b'] = null;
  assert.equal(text(rows(render(env))[1]), 'Synthetic B— XLM—');
});
