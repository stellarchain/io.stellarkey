import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const exists = path => existsSync(new URL(`../${path}`, import.meta.url));

test('consolidation is no longer a separate flow — it folds into the send', () => {
  assert.equal(
    exists('src/features/private-balance/components/ConsolidatePrivate.tsx'),
    false,
    'the standalone consolidation modal should be gone',
  );
  assert.equal(
    exists('src/features/private-balance/components/PrivateProgress.tsx'),
    false,
    'the blocking progress screen is replaced by the in-review skeleton',
  );
});

test('a fragmented balance becomes one chained approval inside the send controller', () => {
  const controller = read('src/features/private-balance/components/usePrivateActionController.ts');

  // Typed detection — instanceof on the raw cause, never copy matching.
  assert.match(controller, /cause instanceof PrivateConsolidationRequiredError/);
  assert.match(controller, /prepareChainedSend/);
  assert.match(controller, /submitChainedSend/);
  // The chain dies on first failure; resuming needs fresh consent.
  assert.match(controller, /setChained\(null\)/);
  // The chained success keeps the explorer chip: the final send's hash is
  // read defensively from either contract shape.
  assert.match(controller, /finalTransactionHash/);
  assert.match(controller, /setSubmittedHash\(outcome\.finalTransactionHash\)/);
  assert.match(controller, /typeof outcome === 'string' \? outcome : outcome\.status/);
});

test('consolidation steps never display as an outgoing spend of the combined value', () => {
  const statusLine = read('src/features/private-balance/components/PrivateBalanceStatusLine.ts');
  const activity = read('src/features/private-balance/components/PrivateActivity.tsx');

  // A consolidation is a self-transfer with a zero protocol balance delta:
  // the card's pending line and the activity rows say "Preparing balance…"
  // with no signed amount instead of "− {sum} confirming…".
  assert.match(statusLine, /isInternalPendingAction/);
  assert.match(statusLine, /Preparing balance…/);
  assert.match(activity, /isInternalPendingAction\(action\)/);
  assert.match(activity, /internal \? 'Preparing balance…' : PENDING_LABELS\[action\.kind\]/);
});

test('the chained review shows the step count, cumulative fee cap, and honest timing', () => {
  const review = read('src/features/private-balance/components/PrivateActionReview.tsx');

  assert.match(review, /Sends in \{chained\.approval\.steps\} steps · total max fee/);
  assert.match(review, /cumulativeMaxFeeStroops/);
  assert.match(review, /Step \{chainProgress\.step\} of \{chainProgress\.totalSteps\}/);
  assert.match(review, /Preparing your balance…/);
  // Steps take a while; the copy never implies "quick".
  assert.match(review, /Each step can take a little while/);
  assert.doesNotMatch(review, /quick(?:ly)?[.!]/i);
});

test('the chained fee preflight shortfall gets humanized copy with the missing amount', () => {
  const errorPanel = read('src/features/private-balance/components/PrivateActionError.tsx');

  assert.match(errorPanel, /PrivateChainedFeePreflightError/);
  assert.match(errorPanel, /missingStroops/);
  assert.match(errorPanel, /Not enough XLM for network fees/);
  assert.match(errorPanel, /Technical details/);
  assert.match(errorPanel, /humanizePrivateError/);
});
