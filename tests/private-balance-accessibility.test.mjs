import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('private balance setup and status expose accessible dialog and progress semantics', () => {
  const setup = read('src/features/private-balance/components/PrivateBalanceSetup.tsx');
  const status = read('src/features/private-balance/components/PrivateBalanceStatus.tsx');
  const card = read('src/features/private-balance/components/PrivateBalanceCard.tsx');

  assert.match(setup, /<Modal\b/);
  assert.match(setup, /<ModalHeader\b/);
  assert.match(setup, /aria-live="polite"/);
  assert.match(status, /role="status"/);
  assert.match(status, /aria-label=/);
  assert.match(card, /grid-cols-4/);
  assert.match(card, /h-\[clamp\(48px,16vw,60px\)\]/);
  assert.match(card, /aria-label=\{`\$\{label\} · private balance`\}/);
  assert.match(card, /min-h-11/);
  for (const source of [setup, status, card]) {
    assert.doesNotMatch(source, /<button(?![^>]*type=)/);
  }
});

test('the review keeps one persistent live region so readiness is announced', () => {
  const review = read('src/features/private-balance/components/PrivateActionReview.tsx');

  // Live regions only announce reliably when they stay mounted and their
  // content changes — the region must never swap out with the fee skeleton.
  assert.match(review, /<span aria-live="polite" className="sr-only">\{liveStatus\}<\/span>/);
  assert.match(review, /Ready to confirm\. Maximum network fee/);
  // The transient fee skeleton itself carries no live region any more.
  assert.doesNotMatch(review, /aria-live="polite"\s*\n?\s*className="skeleton/);
});
