import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dashboard = readFileSync(
  new URL('../src/components/Dashboard.tsx', import.meta.url),
  'utf8',
);

test('a configured private sibling opens details while its cached row is still pending', () => {
  const openPrivatePayments = dashboard.slice(
    dashboard.indexOf('const openPrivatePayments'),
    dashboard.indexOf('/**\n   * The sheet', dashboard.indexOf('const openPrivatePayments')),
  );

  assert.match(openPrivatePayments, /const targetDeploymentId/);
  assert.match(openPrivatePayments, /if \(!privatePoolConfigured\)/);
  assert.match(openPrivatePayments, /setPrivateAssetDeploymentId\(targetDeploymentId\)/);
  assert.match(openPrivatePayments, /setPrivateAssetOpen\(true\)/);
  assert.doesNotMatch(openPrivatePayments, /if \(!entry\)/);

  assert.match(dashboard, /const privateAssetOption = privateAssetDeploymentId/);
  assert.match(dashboard, /verifiedBalanceAtomicUnits: "0"/);
  assert.match(dashboard, /lastVerifiedLedger: null/);
  assert.match(dashboard, /asset: privateAssetOption\.asset/);
});
