import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createRelayRecoveryScenario, SyntheticRecordDriver } from '../e2e/fixtures/relay-recovery-scenario.ts';

const manifest = JSON.parse(readFileSync(new URL('../protocol/private-balance/manifests/development.json', import.meta.url), 'utf8'));
const expected = (bob, reserved = '0', alice = '0', charlie = '0', pending = 0) => ({ bob, reserved, alice, charlie, pending });

for (const [name, deposits, amount, change] of [
  ['one deposit with change', ['100'], '10', '87'],
  ['exact payment plus fee', ['13'], '10', '0'],
  ['two deposits with change', ['20', '20'], '30', '7'],
  ['fractional payment and change', ['20.5'], '10.125', '7.375'],
]) test(`Alice charges 3 XLM: ${name}`, async () => {
  const scenario = await createRelayRecoveryScenario(manifest, new SyntheticRecordDriver(), { deposits, amount });
  await scenario.prepare('approve');
  const submitted = await scenario.submit('PENDING');
  assert.equal(submitted.status, 'broadcast');
  assert.equal(submitted.rpcStatus, 'PENDING');
  assert.equal(scenario.submissions, 1);
  assert.deepEqual(await scenario.balances(), expected('0', String(deposits.reduce((n, value) => n + Number(value), 0)), '0', '0', 1));
  await scenario.confirm();
  assert.deepEqual(await scenario.balances(), expected(change, '0', '3', amount));
  await scenario.sync();
  assert.deepEqual(await scenario.balances(), expected(change, '0', '3', amount));
  assert.deepEqual(await scenario.freshScanBalances(), { bob: change, alice: '3', charlie: amount });
});

for (const [mode, error] of [['cancel', /Synthetic consent cancelled/], ['proof-failure', /Synthetic prover failure/],
  ['quote-expired', /helper quote expired before proof sharing/]]) test(`before sharing: ${mode} preserves Bob's spendable deposit`, async () => {
  const scenario = await createRelayRecoveryScenario(manifest, new SyntheticRecordDriver());
  await assert.rejects(scenario.prepare(mode), error);
  assert.deepEqual(await scenario.balances(), expected('100'));
  assert.equal(scenario.shared, 0);
  assert.ok(scenario.stages.includes('proving-locally'));
  assert.ok(!scenario.stages.includes('simulating'));
  assert.deepEqual(await scenario.journal(), { builds: 0, pending: [] });
});

test('payment fits but payment plus Alice fee does not: no input is reserved or shared', async () => {
  const scenario = await createRelayRecoveryScenario(manifest, new SyntheticRecordDriver(), { deposits: ['12'] });
  await assert.rejects(scenario.prepare('approve'), /insufficient/i);
  assert.deepEqual(await scenario.balances(), expected('12'));
  assert.equal(scenario.shared, 0);
});

for (const [mode, message] of [['helper-reject', 'Synthetic helper rejected preparation'], ['helper-timeout', 'Synthetic helper preparation timed out']]) test(`reproduction: ${mode} leaves the entire deposit reserved without any payment`, async () => {
  const scenario = await createRelayRecoveryScenario(manifest, new SyntheticRecordDriver());
  await assert.rejects(scenario.prepare(mode), error => error.name === 'PrivateProofExposedError' && error.cause?.message === message);
  assert.deepEqual(await scenario.balances(), expected('0', '100', '0', '0', 1));
  assert.equal(scenario.shared, 1);
  assert.equal(scenario.submissions, 0);
  assert.deepEqual(await scenario.journal(), { builds: 0, pending: [{ status: 'prepared', exposure: 'shared', attempts: 0, rpc: null, hasEnvelope: false }] });
  await scenario.expireAndRecover();
  assert.equal(scenario.senderLookups, 0);
  assert.deepEqual(await scenario.balances(), expected('0', '100', '0', '0', 1));
  await assert.rejects(scenario.prepare('approve'), error => error.name === 'PrivateActionInFlightError');
  await scenario.confirm();
  assert.deepEqual(await scenario.balances(), expected('87', '0', '3', '10'));
});

test('a helper failure holds the selected deposit but does not delete an unrelated deposit', async () => {
  const scenario = await createRelayRecoveryScenario(manifest, new SyntheticRecordDriver(), { deposits: ['100', '5'] });
  await assert.rejects(scenario.prepare('helper-reject'), error => error.name === 'PrivateProofExposedError');
  assert.deepEqual(await scenario.balances(), expected('5', '100', '0', '0', 1));
  await scenario.expireAndRecover();
  assert.deepEqual(await scenario.balances(), expected('5', '100', '0', '0', 1));
  assert.equal(scenario.senderLookups, 0);
});

test('three-input payment requires consolidation before any proof sharing or reservation', async () => {
  const scenario = await createRelayRecoveryScenario(manifest, new SyntheticRecordDriver(), { deposits: ['20', '20', '20'], amount: '50' });
  await assert.rejects(scenario.prepare('approve'), error => error.name === 'PrivateConsolidationRequiredError');
  assert.deepEqual(await scenario.balances(), expected('60'));
  assert.deepEqual(await scenario.journal(), { builds: 0, pending: [] });
  assert.equal(scenario.shared, 0);
});

test('minimized outgoing history still recovers Bob change, Alice fee and Charlie payment', async () => {
  const scenario = await createRelayRecoveryScenario(manifest, new SyntheticRecordDriver(), { outgoingHistory: 'minimized' });
  await scenario.prepare('approve');
  await scenario.submit('PENDING');
  await scenario.confirm();
  assert.deepEqual(await scenario.balances(), expected('87', '0', '3', '10'));
  assert.deepEqual(await scenario.freshScanBalances(), { bob: '87', alice: '3', charlie: '10' });
});

for (const [status, classification, rpcStatus] of [['PENDING', 'broadcast', 'PENDING'], ['ERROR', 'ambiguous', 'ERROR'],
  ['timeout', 'ambiguous', 'UNAVAILABLE'], ['signer-reject', 'reviewed', null]]) test(`${status} never invents confirmation, and canonical inclusion recovers all three outputs`, async () => {
  const scenario = await createRelayRecoveryScenario(manifest, new SyntheticRecordDriver());
  await scenario.prepare('approve');
  if (status === 'signer-reject') await assert.rejects(scenario.submit(status), /Synthetic Alice rejected signing/);
  else {
    const result = await scenario.submit(status);
    assert.equal(result.status, classification);
    assert.equal(result.rpcStatus, rpcStatus);
  }
  assert.equal(scenario.submissions, status === 'signer-reject' ? 0 : 1);
  assert.deepEqual(await scenario.journal(), { builds: 0, pending: [{ status: classification, exposure: 'shared',
    attempts: status === 'signer-reject' ? 0 : 1, rpc: rpcStatus, hasEnvelope: status !== 'signer-reject' }] });
  assert.deepEqual(await scenario.balances(), expected('0', '100', '0', '0', 1));
  await scenario.expireAndRecover();
  assert.equal(scenario.senderLookups, 0);
  assert.deepEqual(await scenario.balances(), expected('0', '100', '0', '0', 1));
  await scenario.confirm();
  assert.deepEqual(await scenario.balances(), expected('87', '0', '3', '10'));
  assert.deepEqual(await scenario.freshScanBalances(), { bob: '87', alice: '3', charlie: '10' });
});
