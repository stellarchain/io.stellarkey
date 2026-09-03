import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('private payments setup is one consent screen with an honest disclosure and Turn On', () => {
  const setup = read('src/features/private-balance/components/PrivateBalanceSetup.tsx');
  const disclosure = read('src/features/private-balance/components/PrivacyDisclosure.tsx');
  const surface = `${setup}\n${disclosure}`;

  // One screen — the old three-step wizard is gone.
  assert.doesNotMatch(setup, /Step \$\{step \+ 1\} of 3|Requirements|Set up locally/);
  assert.match(setup, /Private Payments/);
  assert.match(setup, /where the amount and recipient stay encrypted/);
  assert.match(disclosure, /Private internal sends:/);
  assert.match(disclosure, /Public:/);
  assert.match(surface, /money moving in or out/i);
  assert.match(surface, /timing/i);
  // Exactly one reworded consent checkbox.
  assert.equal((setup.match(/type="checkbox"/g) ?? []).length, 1);
  assert.match(setup, /Money moving in or out of my private balance is public/);
  assert.match(setup, /single-party development proving key/);
  assert.match(setup, /could forge proofs and take testnet funds/);
  assert.match(setup, /use testnet funds only/);
  assert.match(setup, /Turn On/);
  assert.match(setup, /Not Now/);
  assert.match(setup, /void optIn\(\)/);
  assert.doesNotMatch(setup, /creating an account|connecting to (?:our|a) server/i);
});

test('setup expands Learn more with download size and recovery without an unconfigured status card', () => {
  const setup = read('src/features/private-balance/components/PrivateBalanceSetup.tsx');

  assert.match(setup, /Learn more/);
  assert.match(setup, /aria-expanded=\{learnMore\}/);
  assert.doesNotMatch(setup, /<PrivateBalanceStatus/);
  assert.match(setup, /artifactDownloadBytes/);
  assert.match(setup, /One-time download/);
  assert.match(
    setup,
    /recovery phrase can rebuild your private balance from Stellar/i,
  );
  assert.doesNotMatch(setup, /StellarKey(?:&apos;|')s servers disappear/i);
  assert.doesNotMatch(setup, /estimated anonymity|guaranteed recovery|instant proof/i);
});

test('setup owns verification and finishes only when the selected asset is ready', () => {
  const setup = read('src/features/private-balance/components/PrivateBalanceSetup.tsx');

  for (const label of [
    'Preparing privacy tools',
    'Creating your keys',
    'Creating your private address',
    'Saving securely on this device',
    'Checking private history',
  ]) assert.match(setup, new RegExp(label.replace(/[&]/g, '&')));
  assert.doesNotMatch(setup, /Catching up with the network/);
  assert.match(setup, /privatePaymentSetupComplete/);
  assert.match(setup, /selectedStateExists/);
  assert.match(setup, /runtimeMatchesSelection/);
  assert.doesNotMatch(setup, /stage === 'running' && configured && privateAddress !== null/);
  assert.match(setup, /void optIn\(\)/);
  assert.doesNotMatch(setup, /await optIn\(\)/);
  assert.match(setup, /Other supported assets are prepared automatically when you first use them/);
  assert.doesNotMatch(setup, /checking past private activity continues in the background/);
  assert.match(setup, /aria-live="polite"/);
  // Success is the shared check morph without confetti.
  assert.match(setup, /PrivateSuccess/);
  assert.match(setup, /celebrate=\{false\}/);
  assert.match(setup, /doneLabel="Done"/);
  // Errors surface humanized with collapsed technical details.
  assert.match(setup, /HumanizedErrorNotice/);
  assert.match(setup, /Try Again/);
  // Old protocol vocabulary stays off the setup surface.
  assert.doesNotMatch(setup, /manifest|artifact download|canonical archive|checkpoint|\bpool\b/i);
});
