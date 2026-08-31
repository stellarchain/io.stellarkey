import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('private withdrawal defaults to the active public account and discloses public output', () => {
  const source = read('src/features/private-balance/components/WithdrawPrivate.tsx');

  assert.match(source, /publicAddress/);
  assert.match(source, /PRIVACY_ROW\.withdraw/);
  assert.match(source, /amount, recipient, and timing/i);
  assert.match(source, /flow\.prepare\(\{ kind: 'withdraw', amount: amount\.trim\(\), publicRecipient: trimmedRecipient \}\)/);
});

test('withdraw follows the movement-language naming and the shared flow pattern', () => {
  const source = read('src/features/private-balance/components/WithdrawPrivate.tsx');

  assert.match(source, /Withdraw Funds/);
  assert.match(source, /Move \$\{code\} to your public balance/);
  assert.match(source, /Withdrawal Sent/);
  assert.match(source, /PrivateAmountField/);
  // Max is the full private balance.
  assert.match(source, /formatPrivateBalanceAmount\(BigInt\(verifiedBalanceStroops\)/);
  assert.match(source, /PrivateActionReview/);
  assert.match(source, /PrivateSubmissionStatus/);
});

test('withdraw uses the same Asset and Amount grid as Send', () => {
  const source = read('src/features/private-balance/components/WithdrawPrivate.tsx');

  assert.match(source, /grid grid-cols-1 gap-3 sm:grid-cols-2/);
  assert.match(source, />\s*Asset\s*</);
  assert.match(source, /<PrivateAssetSelector/);
  assert.match(source, /presentation="field"/);
  assert.match(source, /balance=\{privateBalanceMax\}/);
  assert.match(source, /showQuickAmounts=\{false\}/);
  assert.match(source, /<PrivateQuickAmounts/);
});

test('the terminal states use the shared success morph and calm ambiguous copy', () => {
  const status = read('src/features/private-balance/components/PrivateSubmissionStatus.tsx');

  assert.match(status, /PrivateSuccess/);
  assert.match(status, /AMBIGUOUS_OUTCOME/);
  assert.match(status, /Verifying on Stellar — your balance updates in a moment/);
  assert.match(status, /triggerHaptic\('warning'\)/);
});

test('private withdrawal bootstrap reports real progress and cannot spin forever', () => {
  const source = read('src/components/Dashboard.tsx');

  assert.match(source, /role="progressbar"/);
  assert.match(source, /privateBalanceRuntime\.phase/);
  assert.match(source, /privateBalanceRuntime\.syncProgress/);
  assert.match(source, /Still opening/);
  assert.match(source, /Try again/);
  assert.match(
    source,
    /selectPrivateAsset\(privateWithdrawActiveDeploymentId\);[\s\S]{0,100}?retryPrivateRuntime\(\)/,
  );
});

test('private withdrawal follows an in-modal asset selection instead of waiting on the opening asset', () => {
  const source = read('src/components/Dashboard.tsx');

  assert.match(
    source,
    /selectedDeploymentId:\s*selectedPrivateDeploymentId/,
    'the stable withdrawal shell must observe the asset selector intent',
  );
  assert.match(
    source,
    /const privateWithdrawActiveDeploymentId = privateWithdrawDeploymentId\s*\? selectedPrivateDeploymentId \?\? privateWithdrawDeploymentId\s*:\s*null/,
    'the readiness target must move from XLM to USDC when the selector changes',
  );
  assert.match(
    source,
    /selectPrivateAsset\(privateWithdrawActiveDeploymentId\)/,
    'retry must keep the selected withdrawal asset instead of reverting to the opening asset',
  );
});
