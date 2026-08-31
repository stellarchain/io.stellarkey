import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

async function bootstrapDomain() {
  try {
    return await import('../src/lib/private-balance-bootstrap.ts');
  } catch (error) {
    assert.fail(
      `The Private Balance bootstrap domain is missing: ${error instanceof Error ? error.message : error}`,
    );
  }
}

const scope = {
  networkId: '01'.repeat(32),
  realmId: '02'.repeat(32),
  poolId: '03'.repeat(32),
  accountId: 'account-1',
  deploymentBindingHash: '05'.repeat(32),
};

test('private runtime probes only the deterministic encrypted state record', async () => {
  const {
    hasEncryptedPrivateBalanceState,
    privateBalanceStateRecordKey,
  } = await bootstrapDomain();
  const expected = [
    'private:sensitive:v1',
    scope.networkId,
    scope.realmId,
    scope.poolId,
    scope.accountId,
    scope.deploymentBindingHash,
    'state',
  ].join(':');
  const reads = [];
  const driver = {
    async read(key) {
      reads.push(key);
      return key === expected ? '{"encrypted":"opaque"}' : null;
    },
  };

  assert.equal(privateBalanceStateRecordKey(scope), expected);
  assert.equal(await hasEncryptedPrivateBalanceState(scope, driver), true);
  assert.deepEqual(reads, [expected]);
  assert.equal(
    await hasEncryptedPrivateBalanceState(scope, { read: async () => null }),
    false,
  );
  assert.throws(
    () => privateBalanceStateRecordKey({ ...scope, accountId: 'account:other' }),
    /account/i,
  );
});

test('private runtime accepts only unlocked software accounts and explicit activation', async () => {
  const {
    privateBalanceAccountSupport,
    shouldMountPrivateBalanceRuntime,
  } = await bootstrapDomain();
  const software = { id: 'account-1', publicKey: `G${'A'.repeat(55)}` };

  assert.deepEqual(privateBalanceAccountSupport('unlocked', software), { ready: true });
  assert.match(privateBalanceAccountSupport('locked', software).reason, /unlock/i);
  assert.match(privateBalanceAccountSupport('unlocked', { ...software, watchOnly: true }).reason, /watch-only/i);
  assert.match(privateBalanceAccountSupport('unlocked', { ...software, hardware: 'trezor' }).reason, /hardware/i);
  assert.equal(shouldMountPrivateBalanceRuntime({
    accountReady: true,
    deploymentReady: true,
    requested: false,
    encryptedStateExists: false,
  }), false);
  assert.equal(shouldMountPrivateBalanceRuntime({
    accountReady: true,
    deploymentReady: true,
    requested: true,
    encryptedStateExists: false,
  }), true);
  assert.equal(shouldMountPrivateBalanceRuntime({
    accountReady: true,
    deploymentReady: true,
    requested: false,
    encryptedStateExists: true,
  }), true);
  assert.equal(shouldMountPrivateBalanceRuntime({
    accountReady: true,
    deploymentReady: false,
    requested: true,
    encryptedStateExists: true,
  }), false);
});

test('unlocked wallet mounts only a thin dynamic Private Balance boundary', () => {
  const shell = source('src/components/UnlockedWalletShell.tsx');
  const boundary = source('src/components/PrivateBalanceRuntimeBoundary.tsx');
  const runtimeHook = source('src/hooks/usePrivateBalanceRuntime.tsx');
  const provider = source('src/features/private-balance/runtime/provider.tsx');

  assert.match(shell, /PrivateBalanceRuntimeBoundary/);
  assert.doesNotMatch(shell, /features\/private-balance\/runtime\/provider/);
  assert.match(
    boundary,
    /dynamic\([\s\S]*?import\("@\/features\/private-balance\/runtime\/provider"\)/,
  );
  assert.match(boundary, /ssr:\s*false/);
  assert.doesNotMatch(boundary, /import \{ PrivateBalanceProvider \}/);
  assert.match(boundary, /useWalletIdentity\(\)/);
  assert.match(boundary, /useWalletPhase\(\)/);
  assert.doesNotMatch(boundary, /\buseWallet\(\)/);
  assert.match(boundary, /PrivateBalanceRuntimePublisher/);
  // The incoming-payment toast listener mounts inside the runtime provider.
  assert.match(boundary, /<PrivateIncomingToasts \/>/);
  assert.match(boundary, /publishedRuntime\?\.key === runtimeKey/);
  assert.match(boundary, /PrivateBalanceRuntimeDataProvider value=\{effectiveRuntime\}/);
  assert.match(boundary, /key=\{runtimeKey\}/);
  assert.match(runtimeHook, /usePrivateBalanceRuntime/);
  assert.match(runtimeHook, /PrivateBalanceRuntimeControlProvider/);
  assert.match(runtimeHook, /PrivateBalanceRuntimeDataProvider/);
  assert.match(provider, /withPrivacySessionRoot/);
  assert.match(provider, /PrivateBalanceWorkerClient/);
  assert.match(provider, /syncPrivateBalance/);
  assert.match(provider, /claimPrivateBalanceLease/);
  assert.match(provider, /releasePrivateBalanceLease/);
  assert.match(provider, /\.terminate\(\)/);
  assert.match(provider, /await syncReadySignal\.promise/);
  assert.match(provider, /syncReadySignal\.resolve\(\)/);
});

test('private runtime exposes one address-rotation action backed by encrypted state', () => {
  const runtimeHook = source('src/hooks/usePrivateBalanceRuntime.tsx');
  const provider = source('src/features/private-balance/runtime/provider.tsx');

  assert.match(runtimeHook, /rotatePrivateAddress\(\): Promise<string>/);
  assert.match(provider, /const rotatePrivateAddress = useCallback/);
  assert.match(provider, /worker\.generateAddress\(\)/);
  assert.match(provider, /recordPrivateBalanceAddress/);
});
