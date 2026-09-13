import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('manual releases require isolated phone/desktop components and nested browser protocol tests', () => {
  const { scripts } = JSON.parse(read('../package.json'));
  assert.equal(scripts['test:private-protocol'], 'npm --prefix protocol/private-balance/packages/browser test');
  assert.equal(scripts['test:e2e:private-components'], 'node scripts/test-private-components.mjs');
  assert.match(scripts['verify:application'], /npm run test:private-protocol/);
  assert.match(scripts['verify:application'], /npm run test:e2e:reporter/);
  assert.match(scripts['verify:application'], /npm run test:e2e:private-ui.*npm run test:e2e:private-components.*npm run check:fixture-clean.*npm run build.*npm run check:fixture-clean/);
  assert.match(scripts['release:verify'], /npm run verify:application/);
  const isolated = read('../playwright.private-components.config.ts');
  for (const suite of ['private-components', 'ux-primitives', 'qr-freshness', 'private-direct', 'private-recovery']) {
    assert.ok(isolated.includes(`${suite}.spec.ts`), `${suite} must execute in the isolated gate`);
  }
  assert.match(isolated, /desktop-chromium/);
  assert.match(isolated, /iphone-webkit/);
});

test('hash-pinned development private payments remain behind a Testnet-only lazy boundary', async () => {
  const shell = read('../src/components/UnlockedWalletShell.tsx');
  const boundary = read('../src/components/PrivateBalanceRuntimeBoundary.tsx');
  const dashboard = read('../src/components/Dashboard.tsx');
  const card = read('../src/features/private-balance/components/PrivateBalanceCard.tsx');
  const provider = read('../src/features/private-balance/runtime/provider.tsx');
  const expectedManifest = read('../src/lib/private-balance-expected-manifest.ts');
  const manifest = JSON.parse(read('../public/protocol/private-balance/v1/manifest.json'));
  const { privateBalanceAvailability, validateManifest } = await import(
    '../src/lib/private-balance-manifest.ts'
  );

  assert.match(shell, /PrivateBalanceRuntimeBoundary/);
  assert.doesNotMatch(shell, /PrivateBalanceProvider|features\/private-balance/);
  assert.match(boundary, /dynamic\(/);
  assert.match(boundary, /privateBalanceAvailability/);
  assert.match(boundary, /ALLOW_PRIVATE_BALANCE_DEVELOPMENT_FIXTURE/);
  assert.doesNotMatch(boundary, /import \{ PrivateBalanceProvider \}/);
  assert.match(
    dashboard,
    /const PrivateBalanceAssetRow = dynamic\([\s\S]{0,120}?import\("@\/features\/private-balance\/components\/PrivateBalanceAssetRow"\)/,
  );
  assert.match(
    dashboard,
    /const PrivateAssetDetailModal = dynamic\([\s\S]{0,180}?import\("@\/features\/private-balance\/components\/PrivateAssetDetailModal"\)/,
  );
  assert.doesNotMatch(dashboard, /PrivatePaymentsPage/);
  assert.doesNotMatch(dashboard, /import \{[^}]*Private(?:BalanceAssetRow|AssetDetailModal)[^}]*\}/);
  assert.doesNotMatch(dashboard, /manifestStatus !== "development"/);
  assert.match(card, /ALLOW_PRIVATE_BALANCE_DEVELOPMENT_FIXTURE/);
  assert.match(provider, /ALLOW_PRIVATE_BALANCE_DEVELOPMENT_FIXTURE/);
  assert.match(
    expectedManifest,
    /^export const ALLOW_PRIVATE_BALANCE_DEVELOPMENT_FIXTURE = true;$/m,
    'the verified Testnet development deployment must remain available',
  );
  assert.deepEqual(
    privateBalanceAvailability(validateManifest(manifest), 'testnet'),
    {
      ready: false,
      reason: 'Private Balance is still using development artifacts.',
    },
  );
  assert.deepEqual(
    privateBalanceAvailability(validateManifest(manifest), 'mainnet'),
    {
      ready: false,
      reason: 'Private Payments are available on Stellar testnet only.',
    },
  );
  const shippedDevelopmentFixture = validateManifest(manifest);
  assert.deepEqual(
    privateBalanceAvailability(shippedDevelopmentFixture, 'testnet', {
      allowDevelopmentFixture: true,
    }),
    { ready: true },
    'the shipped Testnet development deployment is explicitly enabled',
  );
  assert.deepEqual(
    privateBalanceAvailability(
      {
        ...shippedDevelopmentFixture,
        status: 'testnet-beta',
        poolContractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAITA4',
        guardianAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        deploymentBindingHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      },
      'testnet',
      { allowDevelopmentFixture: true },
    ),
    { ready: false, reason: 'Private Balance deployment evidence is incomplete.' },
    'the development bypass must never weaken beta or production evidence checks',
  );
  const fixtureManifest = validateManifest({
    ...manifest,
    status: 'development',
    poolContractId: 'CB75IASXOYLFDDVHIEWF3SIUNSN6B5JIJNLLYVEZGNORGUSK3VII47OU',
    guardianAddress: 'GDWEEJ7VZL56AB7KEUZKIBOQBZB5PDHYPHOEYTT6OOOU7EY72E2W2IFF',
    deploymentBindingHash: 'df3a53c4764b0afb2aa99a9339da385460e6047cf75cb8547522c14b302d81d2',
  });
  assert.deepEqual(
    privateBalanceAvailability(fixtureManifest, 'testnet', {
      allowDevelopmentFixture: true,
    }),
    { ready: true },
  );
});

test('the placeholder private payment modals stay deleted', () => {
  for (const component of [
    'PrivateDepositModal.tsx',
    'PrivateFeatureUnavailableModal.tsx',
    'PrivateSendModal.tsx',
    'PrivateWithdrawModal.tsx',
  ]) {
    assert.equal(
      existsSync(new URL(`../src/features/private-balance/components/${component}`, import.meta.url)),
      false,
      `${component} must stay deleted`,
    );
  }
});
