import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('private send validates the private address and shows the fingerprint mark', () => {
  const source = read('src/features/private-balance/components/SendPrivate.tsx');

  assert.match(source, /validateRecipient/);
  assert.match(source, /fingerprint/);
  // The identity mark derives from the FINGERPRINT, never the full address.
  assert.match(source, /<AccountMark publicKey=\{fingerprint\}/);
  assert.match(source, /32 bytes/i);
  assert.match(source, /flow\.prepare\(\{[\s\S]*kind: 'transfer'/);
  assert.match(source, /recipientFieldRef/);
  assert.match(source, /recipientFieldRef\.current\?\.focus\(\)/);
  assert.match(source, /pasteGuidance/);
  assert.match(source, /Press ⌘V|long-press/i);
  assert.doesNotMatch(source, /clipboardError/);
});

test('private send mirrors the public form: max, quick chips, fiat, memo presets, QR paste', () => {
  const source = read('src/features/private-balance/components/SendPrivate.tsx');
  const amountField = read('src/features/private-balance/components/PrivateAmountField.tsx');

  assert.match(source, /PrivateAmountField/);
  assert.match(amountField, /\[10, 25, 50, 100\]/);
  assert.match(amountField, /MAX/);
  assert.match(amountField, /FiatValue/);
  assert.match(source, /QrScannerBox/);
  assert.match(source, /Paste QR Payload/);
  assert.match(source, /Payment[\s\S]*Invoice[\s\S]*Gift[\s\S]*Tip/);
  assert.match(source, /Review Private Send/);
  assert.match(source, /Confirm Send/);
});

test('private send uses the public Asset and Amount grid with an inline dropdown', () => {
  const source = read('src/features/private-balance/components/SendPrivate.tsx');
  const selector = read('src/features/private-balance/components/PrivateAssetSelector.tsx');

  assert.match(source, /grid grid-cols-1 gap-3 sm:grid-cols-2/);
  assert.match(source, />\s*Asset\s*</);
  assert.match(source, /presentation="field"/);
  assert.match(source, /balance=\{privateBalanceMax\}/);
  assert.match(source, /showQuickAmounts=\{false\}/);
  assert.match(source, /<PrivateQuickAmounts/);
  assert.doesNotMatch(source, /flex justify-center px-4 pt-4/);
  assert.match(selector, /<Select/);
  assert.doesNotMatch(selector, /aria-haspopup="dialog"/);
});

test('a pasted public Stellar address gets a one-tap prefilled handoff to regular Send', () => {
  const source = read('src/features/private-balance/components/SendPrivate.tsx');

  assert.match(source, /isValidPublicAddress/);
  assert.match(source, /a public Stellar address — continue in the regular Send\?/);
  // One tap: the pasted address is handed to the public send, prefilled, and
  // the private flow closes.
  assert.match(source, /requestPublicSend\(trimmedRecipient\)/);
  assert.match(source, /Use Regular Send/);
  assert.match(source, /requestPublicSend\(trimmedRecipient\);[\s\S]{0,120}?flow\.close\(\)/);
});

test('recent private recipients render as fingerprint chips with identity marks', () => {
  const source = read('src/features/private-balance/components/SendPrivate.tsx');

  assert.match(source, /recentPrivateRecipients/);
  assert.match(source, /recentRecipients\.map/);
  assert.match(source, /<AccountMark publicKey=\{recent\.fingerprint\}/);
});

test('review opens immediately and the proof prepares underneath it', () => {
  const source = read('src/features/private-balance/components/SendPrivate.tsx');
  const review = read('src/features/private-balance/components/PrivateActionReview.tsx');

  // Straight to the review screen with the known draft, then prepare.
  assert.match(source, /setStage\('review'\);[\s\S]{0,400}void flow\.prepare\(/);
  // The fee row cycles exactly the two calm labels while preparing.
  assert.match(review, /progressLabel\(progress \?\? 'checking-chain'\)/);
  assert.match(review, /skeleton/);
  // Confirm stays disabled until the prepared review is ready and matches.
  assert.match(review, /disabled=\{working \|\| settling \|\| !ready/);
  assert.match(review, /PrivateReviewMismatchError/);
  // Back keeps the draft: it releases the preparation and returns to the form.
  assert.match(source, /flow\.cancelPrepared\(\);[\s\S]{0,80}setStage\('form'\)/);
});

test('an expired review re-prepares once and visibly diffs the changed rows', () => {
  const controller = read('src/features/private-balance/components/usePrivateActionController.ts');
  const review = read('src/features/private-balance/components/PrivateActionReview.tsx');

  assert.match(controller, /cause instanceof PrivateActionReviewExpiredError/);
  assert.match(controller, /await prepare\(draftRef\.current\)/);
  // An identical re-prepared review swaps in seamlessly; a changed fee or
  // change pulses its row and briefly holds confirm.
  assert.match(review, /diff\.fee !== fee/);
  assert.match(review, /pulsed\.add\('fee'\)/);
  assert.match(review, /row-pulse/);
  assert.match(review, /settling/);
});

test('the first-ever private send celebrates exactly once', () => {
  const source = read('src/features/private-balance/components/SendPrivate.tsx');

  assert.match(source, /FIRST_SEND_FLAG/);
  assert.match(source, /celebrate/);
  assert.match(source, /Sent Privately/);
  assert.match(source, /explorerTxUrl/);
});
