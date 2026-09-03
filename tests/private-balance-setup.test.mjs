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
  assert.match(setup, /void optIn\(\{ prefetchArtifacts:/);
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

test('one setup prepares every verified asset and finishes on the original selection', () => {
  const setup = read('src/features/private-balance/components/PrivateBalanceSetup.tsx');
  const accessGate = read(
    'src/features/private-balance/components/PrivatePaymentAccessGate.tsx',
  );

  assert.match(setup, /role="progressbar"/);
  assert.match(setup, /aria-valuemin=\{0\}/);
  assert.match(setup, /aria-valuemax=\{100\}/);
  assert.match(setup, /aria-valuenow=\{progressPercent\}/);
  assert.match(setup, /progressHighWater/);
  assert.match(setup, /runtimeMatchesSetupTarget/);
  assert.doesNotMatch(setup, /<ol\b|SETUP_STEPS/);
  assert.match(
    accessGate,
    /if \(\s*setupOpen \|\|\s*accessState !== 'preparing'/,
    'the underlying action gate must not start a second sync while setup owns the flow',
  );
  assert.doesNotMatch(setup, /Catching up with the network/);
  assert.match(setup, /privatePaymentSetupTarget/);
  assert.match(setup, /privatePaymentSetupComplete/);
  assert.match(setup, /allAssetsPrepared/);
  assert.match(setup, /selectedDeploymentRestored/);
  assert.match(setup, /runtimeMatchesSelection/);
  assert.match(setup, /selectAsset/);
  assert.match(setup, /remainingUnpreparedAssets/);
  assert.match(setup, /prefetchArtifacts:\s*remainingUnpreparedAssets === 1/);
  assert.doesNotMatch(setup, /stage === 'running' && configured && privateAddress !== null/);
  assert.match(setup, /void optIn\(\{ prefetchArtifacts:/);
  assert.doesNotMatch(setup, /await optIn\(\)/);
  assert.match(setup, /Private Payments is ready for \$\{assetList\}/);
  assert.doesNotMatch(setup, /prepared automatically when you first use/);
  assert.doesNotMatch(setup, /checking past private activity continues in the background/);
  assert.match(setup, /aria-live="polite"/);
  // Success is the shared check morph without confetti.
  assert.match(setup, /PrivateSuccess/);
  assert.match(setup, /celebrate=\{false\}/);
  assert.match(setup, /doneLabel="Done"/);
  // Errors surface humanized with collapsed technical details.
  assert.match(setup, /HumanizedErrorNotice/);
  assert.match(setup, /Try Again/);
  assert.match(setup, /Preparing Private Payments/);
  assert.match(setup, /Checking private history/);
  assert.doesNotMatch(setup, /\(\$\{Math\.max\(0, setupTargetIndex\) \+ 1\} of \$\{setupPlan\.deploymentIds\.length\}\)/);
  // Old protocol vocabulary stays off the setup surface.
  assert.doesNotMatch(setup, /manifest|artifact download|canonical archive|checkpoint|\bpool\b/i);
});
