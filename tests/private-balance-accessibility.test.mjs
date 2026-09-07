import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('private balance setup and status expose accessible dialog and progress semantics', () => {
  const shell = read('src/features/private-balance/components/PrivateBalanceSetup.tsx');
  const setup = read('src/features/private-balance/components/PrivateBalanceSetupBody.tsx');
  const status = read('src/features/private-balance/components/PrivateBalanceStatus.tsx');
  const card = read('src/features/private-balance/components/PrivateBalanceCard.tsx');

  // The dialog and its named header are the static shell; the body renders
  // only content inside it.
  assert.match(shell, /<Modal\b/);
  assert.match(shell, /<ModalHeader\b/);
  assert.doesNotMatch(setup, /<Modal\b|<ModalHeader\b/);
  assert.match(setup, /aria-live="polite"/);
  assert.match(setup, /role="progressbar"/);
  assert.match(setup, /aria-label="Private Payments setup progress"/);
  assert.match(setup, /motion-reduce:transition-none/);
  assert.match(status, /role="status"/);
  assert.match(status, /aria-label=/);
  assert.match(card, /grid-cols-4/);
  assert.match(card, /h-\[clamp\(48px,16vw,60px\)\]/);
  assert.match(card, /aria-label=\{`\$\{label\} · private balance`\}/);
  assert.match(card, /min-h-11/);
  for (const source of [shell, setup, status, card]) {
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

test('private setup progress is one flat instrument inside the modal shell', () => {
  const setup = read('src/features/private-balance/components/PrivateBalanceSetupBody.tsx');
  const start = setup.indexOf("{stage === 'running' ? (");
  const end = setup.indexOf("</ModalBody>", start);
  assert.ok(start >= 0 && end > start);
  const running = setup.slice(start, end);

  assert.doesNotMatch(running, /rounded-2xl border/);
  assert.doesNotMatch(running, /blur-3xl/);
  assert.doesNotMatch(running, /bg-\[#0A84FF\]\/10/);
  assert.doesNotMatch(running, /Setting up securely/);
  assert.match(running, /transition-transform/);
  assert.match(running, /scaleX\(\$\{progressPercent \/ 100\}\)/);
  assert.match(running, /Encrypted on this device/);
  assert.match(running, /Keys stay local/);
});

test('private asset administration keeps labels, live status, and explicit buttons accessible', () => {
  const admin = read('src/features/private-balance/components/PrivateAssetRegistryAdmin.tsx');
  assert.match(admin, /<Field label="Stellar Asset Contract address">/);
  assert.match(admin, /aria-live="polite"/);
  assert.match(admin, /aria-labelledby="private-asset-admin-title"/);
  assert.doesNotMatch(admin, /<button(?![^>]*type=)/);
  assert.doesNotMatch(admin, /transition-all|transition:\s*all/);
});
