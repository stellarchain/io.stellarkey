import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('private activity rows use the shared human labels and honest recovered metadata', () => {
  const activity = read('src/features/private-balance/components/PrivateActivity.tsx');
  const details = read('src/features/private-balance/components/PrivateActivityDetails.tsx');
  const copy = read('src/features/private-balance/copy.ts');

  // Labels come from one place: copy.activityKindLabel.
  assert.match(activity, /activityKindLabel/);
  assert.match(details, /activityKindLabel/);
  for (const label of ['Added privately', 'Sent privately', 'Received privately', 'Moved to public', 'Prepared balance']) {
    assert.match(copy, new RegExp(label));
  }
  assert.doesNotMatch(activity, /'Consolidated'/);
  assert.match(details, /recipient.*unavailable in recovered history/is);
  assert.match(details, /memo.*unavailable in recovered history/is);
  assert.match(details, /public record cannot prove/is);
  assert.doesNotMatch(`${activity}\n${details}`, /universally verifiable receipt|\bpool\b/i);
  // Missing metadata is not proof it was never archived. Outgoing envelopes
  // can restore sent recipient/memo details without this device's journal.
  // Inflows and deposits go to you, a withdrawal's recipient is
  // public, a memo-less sent payment shows "None", and a received memo that
  // was decrypted is surfaced rather than claimed lost.
  assert.match(details, /sentTransfer/);
  assert.match(details, /value="Your private balance"/);
  assert.match(details, /value="Shown on the public record"/);
  assert.match(details, /value="You"/);
  assert.match(details, /localRecipient \? 'None' : 'Unavailable in recovered history'/);
  assert.match(details, /archived encrypted outgoing records using your recovery phrase/);
  assert.doesNotMatch(details, /saved only in this device|phrase alone cannot reconstruct/);
  assert.doesNotMatch(details, /nothing left your private balance/);
  assert.match(details, /inflow && localMemo/);
  assert.match(details, /activity\?\.direction === 'outflow' \? 'Net private balance change' : 'Amount'/);
  assert.match(details, /phrase alone restores them — amount and memo included/);
  // The recognition mark from compose/review reappears on the recipient row.
  assert.match(details, /<AccountMark publicKey=\{localRecipient\}/);
});

test('activity details honor privacy mode exactly like the public detail modal', () => {
  const activity = read('src/features/private-balance/components/PrivateActivity.tsx');
  const details = read('src/features/private-balance/components/PrivateActivityDetails.tsx');

  // The list already masks; the details one tap deeper must not reveal.
  assert.match(activity, /privacyMode=\{privacyMode\}/);
  assert.match(details, /privacyMode = false/);
  assert.match(details, /privacyMode\s*\?\s*'••••••'/);
});

test('pending rows say Confirming with their amount and never a raw status', () => {
  const activity = read('src/features/private-balance/components/PrivateActivity.tsx');
  const details = read('src/features/private-balance/components/PrivateActivityDetails.tsx');

  assert.match(activity, /Confirming…/);
  assert.match(activity, /action\.amountStroops/);
  assert.doesNotMatch(activity, /\{action\.status\}/);
  assert.doesNotMatch(details, /selection\.action\.status/);
  assert.match(details, /Confirming…/);
  assert.match(details, /amountStroops/);
  // Only signed/broadcast actions render as rows — a prepared/reviewed action
  // whose review is still open (or was abandoned) is not an in-flight payment.
  assert.match(activity, /isConfirmingPendingAction/);
  assert.match(activity, /pendingActions\.filter\(isConfirmingPendingAction\)/);
  // Chained consolidation steps are internal: "Preparing balance…", no amount.
  assert.match(activity, /isInternalPendingAction/);
  assert.match(activity, /Preparing balance…/);
  assert.match(activity, /!internal && action\.amountStroops/);
  assert.match(details, /isInternalPendingAction/);
  assert.match(details, /Preparing balance…/);
});

test('pending payment details offer Check Status through the sync path', () => {
  const details = read('src/features/private-balance/components/PrivateActivityDetails.tsx');

  assert.match(details, /Check Status/);
  assert.match(details, /refreshSync\(\)/);
  assert.match(details, /HumanizedErrorNotice/);
  assert.match(details, /View Public Record/);
});

test('an unsigned exposed proof is status unknown, never represented as cancelled or confirmed', () => {
  const details = read('src/features/private-balance/components/PrivateActivityDetails.tsx');
  assert.match(details, /hasExposedPrivateSpend/);
  assert.match(details, /Status unknown/);
  assert.match(details, /proof was shared before a signed transaction was recorded/);
  assert.match(details, /can still execute this exact payment/);
  assert.match(details, /Inputs remain reserved/);
});

test('a fresh pending row pulses once and the timestamp row hides at zero', () => {
  const activity = read('src/features/private-balance/components/PrivateActivity.tsx');
  const details = read('src/features/private-balance/components/PrivateActivityDetails.tsx');

  assert.match(activity, /row-pulse/);
  assert.match(activity, /pulseIds/);
  // timestamp 0 (outside retention) renders no Time row.
  assert.match(details, /activity\?\.timestamp \?/);
});

test('the pending-row pulse re-fires when the action flow closes on its success screen', () => {
  const activity = read('src/features/private-balance/components/PrivateActivity.tsx');
  const panel = read('src/features/private-balance/components/PrivateActivityPanel.tsx');
  const card = read('src/features/private-balance/components/PrivateBalanceCard.tsx');

  // The first pulse fires under the success modal; Done bumps the token so
  // the row pulses again once the person can actually see it. The dedicated
  // private page that used to thread activityPulseToken was removed in the
  // asset-centric restructure; the contract lives on in the components until
  // their next mount point wires it through.
  assert.match(card, /onSubmittedClose/);
  assert.match(card, /submittedRef/);
  assert.match(card, /onSubmitted=\{markSubmitted\}/);
  assert.match(panel, /pulseToken=\{pulseToken\}/);
  assert.match(activity, /pulseToken/);
  assert.match(activity, /knownPulseTokenRef/);
});

test('the empty state offers Receive Privately when the address exists', () => {
  const activity = read('src/features/private-balance/components/PrivateActivity.tsx');
  const panel = read('src/features/private-balance/components/PrivateActivityPanel.tsx');

  assert.match(activity, /No private activity yet/);
  assert.match(activity, /Receive Privately/);
  assert.match(activity, /onReceive/);
  assert.match(panel, /privateAddress !== null/);
  assert.match(panel, /ReceivePrivate/);
});
