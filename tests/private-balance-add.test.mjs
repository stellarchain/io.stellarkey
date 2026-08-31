import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('add-funds uses the reviewed action lifecycle and honest privacy copy', () => {
  const source = read('src/features/private-balance/components/AddPrivateFunds.tsx');
  const controller = read('src/features/private-balance/components/usePrivateActionController.ts');

  assert.match(source, /flow\.prepare\(\{ kind: 'deposit', amount: amount\.trim\(\) \}\)/);
  assert.match(source, /PRIVACY_ROW\.deposit/);
  assert.match(controller, /cancelAction/);
});

test('add-funds follows the movement-language naming and takes a prefilled amount', () => {
  const source = read('src/features/private-balance/components/AddPrivateFunds.tsx');

  assert.match(source, /Add Funds/);
  assert.match(source, /Move \$\{code\} from your public balance/);
  // Broadcast-true wording: RPC acceptance is not on-chain inclusion, so the
  // title never claims the funds already landed.
  assert.match(source, /Deposit Sent/);
  assert.doesNotMatch(source, /Funds Added/);
  assert.match(source, /prefillAmount/);
});

test('add-funds derives Max from the public spendable balance', () => {
  const source = read('src/features/private-balance/components/AddPrivateFunds.tsx');

  assert.match(source, /useWalletLedger/);
  assert.match(source, /spendableAssetBalance/);
  assert.match(source, /minimumBalanceXlm/);
  assert.match(source, /MAX_PRIVATE_ACTION_RESOURCE_FEE_STROOPS/);
});

test('add-funds mirrors Send with asset context, public balance, and quick amounts', () => {
  const source = read('src/features/private-balance/components/AddPrivateFunds.tsx');
  const selector = read('src/features/private-balance/components/PrivateAssetSelector.tsx');
  const amount = read('src/features/private-balance/components/PrivateAmountField.tsx');

  assert.match(source, /grid grid-cols-1 gap-3 sm:grid-cols-2/);
  assert.match(source, />\s*Asset\s*</);
  assert.match(source, /presentation="field"/);
  assert.match(source, /publicBalance\?\.balance/);
  assert.match(source, /showQuickAmounts=\{false\}/);
  assert.match(source, /<PrivateQuickAmounts/);
  assert.match(selector, /presentation\?: 'pill' \| 'field'/);
  assert.match(selector, /Balance:/);
  assert.match(amount, /\[10, 25, 50, 100\]/);
  assert.match(amount, />\s*MAX\s*</);
});

test('issued-asset trustline and clawback facts stay visible, never collapsed', () => {
  const source = read('src/features/private-balance/components/AddPrivateFunds.tsx');

  assert.match(source, /authorized .* trustline/i);
  assert.match(source, /freeze and clawback/i);
  // They render as always-visible notices, not inside the Details disclosure.
  assert.match(source, /<Notice>\s*Your public account needs an authorized/);
});

test('the review simulates the resulting private balance for deposits', () => {
  const review = read('src/features/private-balance/components/PrivateActionReview.tsx');

  // The math lives in one reservation-aware helper (unit-tested in
  // private-balance-ui): once prepare reserves the inputs, the live unspent
  // balance already dropped, so the panel must add them back.
  assert.match(review, /privateReviewBalanceSimulation\(/);
  assert.match(review, /liveUnspentStroops: balanceBeforeStroops/);
  assert.match(review, /Private balance after/i);
  assert.match(review, /Balance After/);
});
