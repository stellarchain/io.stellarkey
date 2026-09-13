import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dashboard = readFileSync(
  new URL('../src/components/Dashboard.tsx', import.meta.url),
  'utf8',
);

test('only a real private entry opens details while an untouched sibling opens Private Add', () => {
  const openPrivatePayments = dashboard.slice(
    dashboard.indexOf('const openPrivatePayments'),
    dashboard.indexOf('/**\n   * The sheet', dashboard.indexOf('const openPrivatePayments')),
  );

  assert.match(openPrivatePayments, /const targetDeploymentId/);
  assert.match(openPrivatePayments, /if \(!privatePaymentsAreEnabled\)/);
  assert.match(openPrivatePayments, /setPrivateAssetDeploymentId\(targetDeploymentId\)/);
  assert.match(openPrivatePayments, /setPrivateAssetOpen\(true\)/);
  assert.doesNotMatch(openPrivatePayments, /if \(!entry\)/);

  assert.match(
    dashboard,
    /const privateAssetEntry = privateAssetDeploymentId[\s\S]{0,180}?privatePortfolioEntries\.find[\s\S]{0,120}?\?\? null/,
  );
  assert.doesNotMatch(dashboard, /verifiedBalanceAtomicUnits: "0"/);
  assert.match(dashboard, /if \(!option\.encryptedStateExists \|\| entry === undefined\)/);
  assert.match(dashboard, /setAddAssetInitialMode\("private"\)/);
  assert.match(dashboard, /setAddAssetOpen\(true\)/);
});
