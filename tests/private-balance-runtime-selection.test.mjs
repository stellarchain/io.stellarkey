import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

async function bootstrapDomain() {
  try {
    return await import('../src/lib/private-balance-bootstrap.ts');
  } catch (error) {
    assert.fail(
      `The Private Balance bootstrap domain is missing: ${error instanceof Error ? error.message : error}`,
    );
  }
}

async function portfolioDomain() {
  try {
    return await import('../src/features/private-balance/runtime/portfolio.ts');
  } catch (error) {
    assert.fail(
      `The Private Balance portfolio domain is missing: ${error instanceof Error ? error.message : error}`,
    );
  }
}

async function runtimePublicationDomain() {
  try {
    return await import('../src/features/private-balance/runtime/publication.ts');
  } catch (error) {
    assert.fail(
      `The Private Balance publication domain is missing: ${error instanceof Error ? error.message : error}`,
    );
  }
}

function deployment(id, kind, encryptedStateExists = false) {
  return { id, asset: { kind }, encryptedStateExists };
}

test('private runtime selection preserves choice then prefers stored state and native XLM', async () => {
  const { selectPrivateBalanceDeploymentId } = await bootstrapDomain();
  const candidates = [
    deployment('testnet-xlm-v1', 'native'),
    deployment('testnet-usdc-v1', 'stellar', true),
    deployment('testnet-eurc-v1', 'stellar'),
  ];

  assert.equal(selectPrivateBalanceDeploymentId(candidates, 'testnet-eurc-v1'), 'testnet-eurc-v1');
  assert.equal(selectPrivateBalanceDeploymentId(candidates, 'missing'), 'testnet-usdc-v1');
  assert.equal(
    selectPrivateBalanceDeploymentId(candidates.map(item => ({ ...item, encryptedStateExists: false })), null),
    'testnet-xlm-v1',
  );
  assert.equal(
    selectPrivateBalanceDeploymentId(candidates.slice(1).map(item => ({ ...item, encryptedStateExists: false })), null),
    'testnet-usdc-v1',
  );
  assert.equal(selectPrivateBalanceDeploymentId([], null), null);
});

test('durable pool state updates every asset option before a runtime remount', async () => {
  const { updatePrivateBalancePoolStorageState } = await bootstrapDomain();
  const deployments = [
    { ...deployment('pool-v2:native', 'native'), poolDeploymentId: 'pool-v2' },
    { ...deployment('pool-v2:USDC:issuer', 'stellar'), poolDeploymentId: 'pool-v2' },
    { ...deployment('other-pool:native', 'native'), poolDeploymentId: 'other-pool' },
  ];

  const configured = updatePrivateBalancePoolStorageState(deployments, 'pool-v2', true);
  assert.deepEqual(
    configured.map(item => item.encryptedStateExists),
    [true, true, false],
    'every asset view sharing the durable pool record must remount as configured',
  );

  const removed = updatePrivateBalancePoolStorageState(configured, 'pool-v2', false);
  assert.deepEqual(removed.map(item => item.encryptedStateExists), [false, false, false]);
});

test('one configured asset marks the shared private payments pool ready', async () => {
  const { privateBalancePoolConfigured } = await bootstrapDomain();

  assert.equal(privateBalancePoolConfigured([
    deployment('testnet-xlm-v1', 'native'),
    deployment('testnet-usdc-v1', 'stellar'),
  ]), false);
  assert.equal(privateBalancePoolConfigured([
    deployment('testnet-xlm-v1', 'native', true),
    deployment('testnet-usdc-v1', 'stellar'),
  ]), true);
  assert.equal(privateBalancePoolConfigured([
    deployment('testnet-xlm-v1', 'native'),
    deployment('testnet-usdc-v1', 'stellar', true),
  ]), true);
});

test('advisory render publication cannot undo durable setup or removal authority', async () => {
  const { mergePrivateRuntimePublication } = await runtimePublicationDomain();
  const key = 'testnet:account:pool:manifest';
  const runtime = configured => ({ configured, phase: configured ? 'current' : 'disabled' });

  const initial = mergePrivateRuntimePublication(null, key, runtime(false), 'render');
  const configured = mergePrivateRuntimePublication(initial, key, runtime(true), 'durable');
  const staleRender = mergePrivateRuntimePublication(configured, key, runtime(false), 'render');

  assert.equal(staleRender, configured, 'a stale render must not revoke durable local state');

  const removed = mergePrivateRuntimePublication(configured, key, runtime(false), 'durable');
  assert.equal(removed.value.configured, false, 'explicit durable removal remains authoritative');
});

test('private runtime boundary loads the catalogue and scopes one mounted worker to the selected deployment', () => {
  const boundary = readFileSync(
    new URL('../src/components/PrivateBalanceRuntimeBoundary.tsx', import.meta.url),
    'utf8',
  );
  const runtimeHook = readFileSync(
    new URL('../src/hooks/usePrivateBalanceRuntime.tsx', import.meta.url),
    'utf8',
  );

  assert.match(boundary, /loadExpectedPrivateBalanceCatalogue/);
  assert.match(boundary, /loadPrivateBalanceDeployments/);
  assert.match(boundary, /selectPrivateBalanceDeploymentId/);
  assert.match(boundary, /selectedDeploymentId/);
  assert.match(boundary, /deployment\.id/);
  assert.match(boundary, /manifestHash/);
  assert.match(runtimeHook, /availableAssets/);
  assert.match(runtimeHook, /selectedDeploymentId/);
  assert.match(runtimeHook, /selectAsset/);
});

test('private runtime identity includes the selected asset option even when assets share one pool', () => {
  const boundary = readFileSync(
    new URL('../src/components/PrivateBalanceRuntimeBoundary.tsx', import.meta.url),
    'utf8',
  );

  assert.match(
    boundary,
    /activeAccount\.id}:\$\{deployment\.id}:\$\{deployment\.poolDeploymentId}/,
    'switching between assets in one pool must remount the asset-scoped runtime',
  );
});

test('private asset intent is retained while the verified catalogue catches up', () => {
  const runtimeHook = readFileSync(
    new URL('../src/hooks/usePrivateBalanceRuntime.tsx', import.meta.url),
    'utf8',
  );
  const selectionStart = runtimeHook.indexOf('const selectAsset = useCallback');
  const registrationStart = runtimeHook.indexOf('const registerAvailableAssets', selectionStart);
  const selection = runtimeHook.slice(selectionStart, registrationStart);

  assert.match(selection, /setSelectedDeploymentId\(deploymentId\)/);
  assert.doesNotMatch(
    selection,
    /availableAssets/,
    'a click must not be discarded merely because catalogue publication is still rendering',
  );
});

test('verified private assets publish before local-state probing can block the dashboard', () => {
  const boundary = readFileSync(
    new URL('../src/components/PrivateBalanceRuntimeBoundary.tsx', import.meta.url),
    'utf8',
  );
  const catalogueLoad = boundary.indexOf('loadPrivateBalanceDeployments({ catalogue, network })');
  const initialPublish = boundary.indexOf('publishAvailableDeployments(loadedDeployments)');
  const storageProbe = boundary.indexOf('new IndexedDbEncryptedRecordDriver()');

  assert.ok(catalogueLoad >= 0, 'the verified catalogue must still be loaded');
  assert.ok(initialPublish > catalogueLoad, 'assets publish only after catalogue verification');
  assert.ok(storageProbe > initialPublish, 'local-state probing must not hide verified assets');
});

test('private portfolio contains every configured asset with its exact cached checkpoint', async () => {
  const { buildPrivatePortfolioEntries } = await portfolioDomain();
  const checkpoint = (lastActionIndex, latestLedger) => ({ lastActionIndex, latestLedger });
  const assetMarker = { XLM: 'A', USDC: 'B', EURC: 'C' };
  const asset = (code, kind = 'stellar') => ({
    code,
    kind,
    issuer: kind === 'native' ? null : `G${'A'.repeat(55)}`,
    name: code,
    decimals: kind === 'native' ? 7 : 6,
    displayDecimals: 2,
    contractId: `C${assetMarker[code].repeat(55)}`,
  });
  const xlm = asset('XLM', 'native');
  const usdc = asset('USDC');
  const eurc = asset('EURC');
  const note = (value, assetContractId, status = 'unspent') => ({
    value,
    status,
    assetContractId,
  });
  const entries = buildPrivatePortfolioEntries([
    {
      deploymentId: 'testnet-xlm-v1',
      asset: xlm,
      durable: {
        notes: [
          note('9007199254740993', xlm.contractId),
          note('7', xlm.contractId, 'spent'),
        ],
        activities: [{ id: 'xlm-activity', assetContractId: xlm.contractId }],
        pendingActions: [],
        checkpoint: checkpoint(41, 4_500_001),
      },
    },
    {
      deploymentId: 'testnet-usdc-v1',
      asset: usdc,
      durable: {
        notes: [note('2500000', usdc.contractId)],
        activities: [{ id: 'usdc-activity', assetContractId: usdc.contractId }],
        pendingActions: [{ id: 'usdc-pending', assetContractId: usdc.contractId }],
        checkpoint: checkpoint(8, 4_500_009),
      },
    },
    { deploymentId: 'testnet-eurc-v1', asset: eurc, durable: null },
  ]);

  assert.deepEqual(entries.map(entry => entry.deploymentId), [
    'testnet-xlm-v1',
    'testnet-usdc-v1',
  ]);
  assert.equal(entries[0].verifiedBalanceAtomicUnits, '9007199254740993');
  assert.equal(entries[1].verifiedBalanceAtomicUnits, '2500000');
  assert.deepEqual(entries.map(entry => entry.lastVerifiedLedger), [4_500_001, 4_500_009]);
  assert.deepEqual(entries.map(entry => entry.lastVerifiedActionIndex), [41, 8]);
  assert.equal(entries[1].activities[0].id, 'usdc-activity');
  assert.equal(entries[1].pendingActions[0].id, 'usdc-pending');
});

test('private portfolio immediately inserts a newly configured asset and later updates it', async () => {
  const { upsertPrivatePortfolioEntry } = await portfolioDomain();
  const first = {
    deploymentId: 'testnet-xlm-v1',
    asset: {
      code: 'XLM',
      kind: 'native',
      issuer: null,
      name: 'Stellar Lumens',
      decimals: 7,
      displayDecimals: 7,
      contractId: `C${'A'.repeat(55)}`,
    },
    verifiedBalanceAtomicUnits: '0',
    lastVerifiedLedger: 4_500_000,
    lastVerifiedActionIndex: 0,
    activities: [],
    pendingActions: [],
  };

  const inserted = upsertPrivatePortfolioEntry([], first);
  assert.deepEqual(inserted, [first]);

  const updated = upsertPrivatePortfolioEntry(inserted, {
    ...first,
    verifiedBalanceAtomicUnits: '25000000',
    lastVerifiedLedger: 4_500_001,
  });
  assert.equal(updated.length, 1);
  assert.equal(updated[0].verifiedBalanceAtomicUnits, '25000000');
  assert.equal(updated[0].lastVerifiedLedger, 4_500_001);
});

test('private asset selection retains its verified balance while the runtime hydrates', async () => {
  const { reconcilePrivatePortfolioRuntimeEntry } = await portfolioDomain();
  const asset = {
    code: 'XLM',
    kind: 'native',
    issuer: null,
    name: 'Stellar Lumens',
    decimals: 7,
    displayDecimals: 7,
    contractId: `C${'A'.repeat(55)}`,
  };
  const cached = {
    deploymentId: 'testnet-xlm-v1',
    asset,
    verifiedBalanceAtomicUnits: '25000000',
    lastVerifiedLedger: 4_500_001,
    lastVerifiedActionIndex: 12,
    activities: [],
    pendingActions: [],
  };
  const hydrating = {
    ...cached,
    verifiedBalanceAtomicUnits: '0',
    lastVerifiedLedger: null,
    lastVerifiedActionIndex: null,
  };

  assert.equal(
    reconcilePrivatePortfolioRuntimeEntry(cached, hydrating, false),
    cached,
    'a temporary runtime zero must not replace the last verified balance',
  );
  assert.equal(
    reconcilePrivatePortfolioRuntimeEntry(cached, hydrating, true),
    hydrating,
    'a current runtime may publish a verified zero balance',
  );
  assert.equal(
    reconcilePrivatePortfolioRuntimeEntry(undefined, hydrating, false),
    hydrating,
    'a newly configured asset may publish its first entry while hydration continues',
  );
});

test('private portfolio restores an already-scanned incoming memo from its encrypted note', async () => {
  const { buildPrivatePortfolioEntries } = await portfolioDomain();
  const contractId = `C${'A'.repeat(55)}`;
  const memoHex = Buffer.from('already received').toString('hex');
  const [entry] = buildPrivatePortfolioEntries([{
    deploymentId: 'testnet-xlm-v1',
    asset: {
      code: 'XLM', kind: 'native', issuer: null,
      name: 'Stellar Lumens', decimals: 7, displayDecimals: 7,
      contractId,
    },
    durable: {
      notes: [{
        value: '25000000', status: 'unspent', assetContractId: contractId,
        actionIndex: 7, memoHex,
      }],
      activities: [{
        id: 'received', actionIndex: 7, actionKind: 'transfer', amount: '25000000',
        direction: 'inflow', timestamp: 1_700_000_000_000,
        assetContractId: contractId, nullifiers: [], outputCommitments: [],
      }],
      pendingActions: [],
      checkpoint: { lastActionIndex: 7, latestLedger: 4_500_001 },
    },
  }]);

  assert.equal(entry.activities[0].memoHex, memoHex);
});

test('one private pool setup configures and removes every asset without sharing balances', async () => {
  const { updatePrivatePortfolioPoolEntries } = await portfolioDomain();
  const asset = (code, kind, contractByte, decimals) => ({
    code,
    kind,
    issuer: kind === 'native' ? null : `G${'A'.repeat(55)}`,
    name: code,
    decimals,
    displayDecimals: decimals,
    contractId: `C${contractByte.repeat(55)}`,
  });
  const xlm = asset('XLM', 'native', 'A', 7);
  const usdc = asset('USDC', 'stellar', 'B', 7);
  const poolAssets = [
    { deploymentId: 'pool-v2:native', asset: xlm },
    { deploymentId: 'pool-v2:USDC:issuer', asset: usdc },
  ];
  const entry = (deploymentId, selectedAsset, balance) => ({
    deploymentId,
    asset: selectedAsset,
    verifiedBalanceAtomicUnits: balance,
    lastVerifiedLedger: 4_500_001,
    lastVerifiedActionIndex: 12,
    activities: [],
    pendingActions: [],
  });

  const afterXlmSetup = updatePrivatePortfolioPoolEntries(
    [],
    poolAssets,
    entry('pool-v2:native', xlm, '25000000'),
  );
  assert.deepEqual(
    afterXlmSetup.map(candidate => [candidate.asset.code, candidate.verifiedBalanceAtomicUnits]),
    [['XLM', '25000000'], ['USDC', '0']],
  );

  const afterUsdcLoad = updatePrivatePortfolioPoolEntries(
    afterXlmSetup,
    poolAssets,
    entry('pool-v2:USDC:issuer', usdc, '7000000'),
  );
  assert.deepEqual(
    afterUsdcLoad.map(candidate => [candidate.asset.code, candidate.verifiedBalanceAtomicUnits]),
    [['XLM', '25000000'], ['USDC', '7000000']],
  );

  const unrelated = entry('other-pool:native', xlm, '90000000');
  const removed = updatePrivatePortfolioPoolEntries(
    [...afterUsdcLoad, unrelated],
    poolAssets,
    null,
  );
  assert.deepEqual(removed, [unrelated]);
});

test('private portfolio representative value prices configured XLM and USDC without claiming testnet value', async () => {
  const {
    privatePortfolioRepresentativeUsd,
    portfolioXlmWithPrivateAssets,
    portfolioUsdWithPrivateAssets,
  } = await portfolioDomain();
  const entry = (code, kind, value, decimals = 7) => ({
    deploymentId: `testnet-${code.toLowerCase()}-v1`,
    asset: {
      code,
      kind,
      issuer: kind === 'native' ? null : `G${'A'.repeat(55)}`,
      name: code,
      decimals,
      displayDecimals: decimals,
      contractId: `C${'A'.repeat(55)}`,
    },
    verifiedBalanceAtomicUnits: value,
    lastVerifiedLedger: 1,
    lastVerifiedActionIndex: 0,
    activities: [],
    pendingActions: [],
  });

  assert.equal(privatePortfolioRepresentativeUsd([
    entry('XLM', 'native', '250000000'),
    entry('USDC', 'stellar', '125000000'),
  ], 0.1), 15);
  assert.equal(privatePortfolioRepresentativeUsd([
    entry('XLM', 'native', '250000000'),
  ], null), null);
  assert.equal(privatePortfolioRepresentativeUsd([
    entry('UNKNOWN', 'stellar', '10000000'),
  ], 0.1), null);
  assert.equal(portfolioUsdWithPrivateAssets(125, 15), 140);
  assert.equal(portfolioUsdWithPrivateAssets(null, 15), null);
  assert.equal(portfolioUsdWithPrivateAssets(125, null), null);
  assert.equal(portfolioXlmWithPrivateAssets('10000.0000000', [
    entry('XLM', 'native', '25000000'),
    entry('USDC', 'stellar', '125000000'),
  ]), '10002.5000000');
  assert.equal(portfolioXlmWithPrivateAssets(0.0000001, [
    entry('XLM', 'native', '1'),
  ]), '0.0000002');
  assert.equal(portfolioXlmWithPrivateAssets(null, []), null);
});

test('configured private activity normalizes into explicit bank-style wallet activity', async () => {
  const { privatePortfolioActivityItems } = await portfolioDomain();
  const entries = [{
    deploymentId: 'testnet-usdc-v1',
    asset: {
      code: 'USDC', kind: 'stellar', issuer: `G${'A'.repeat(55)}`,
      name: 'USD Coin', decimals: 7, displayDecimals: 7,
      contractId: `C${'A'.repeat(55)}`,
    },
    verifiedBalanceAtomicUnits: '0', lastVerifiedLedger: 20, lastVerifiedActionIndex: 3,
    pendingActions: [],
    activities: [
      { id: 'deposit', actionIndex: 1, actionKind: 'deposit', amount: '25000000', direction: 'inflow', timestamp: 1_700_000_000_000, nullifiers: [], outputCommitments: [] },
      { id: 'send', actionIndex: 2, actionKind: 'transfer', amount: '5000000', direction: 'outflow', timestamp: 1_700_000_001_000, nullifiers: [], outputCommitments: [], memoHex: Buffer.from('invoice 42').toString('hex'), recipientFingerprint: 'ABCD 1234' },
      { id: 'receive', actionIndex: 3, actionKind: 'transfer', amount: '10000000', direction: 'inflow', timestamp: 1_700_000_002_000, nullifiers: [], outputCommitments: [], memoHex: Buffer.from('thank you').toString('hex') },
      { id: 'withdraw', actionIndex: 4, actionKind: 'withdraw', amount: '7500000', direction: 'outflow', timestamp: 1_700_000_003_000, nullifiers: [], outputCommitments: [] },
    ],
  }];
  const items = privatePortfolioActivityItems(entries);
  assert.deepEqual(items.map(item => item.title), ['Withdrew to public balance', 'Private payment received', 'Private payment sent', 'Added to private balance']);
  assert.deepEqual(items.map(item => item.amount), ['0.7500000', '1.0000000', '0.5000000', '2.5000000']);
  assert.deepEqual(items.map(item => item.direction), ['neutral', 'in', 'out', 'neutral']);
  assert.deepEqual(items[0].internalTransfer, {
    debit: { amount: '0.7500000', assetCode: 'USDC', assetIssuer: `G${'A'.repeat(55)}`, balance: 'private' },
    credit: { amount: '0.7500000', assetCode: 'USDC', assetIssuer: `G${'A'.repeat(55)}`, balance: 'public' },
  });
  assert.deepEqual(items[3].internalTransfer, {
    debit: { amount: '2.5000000', assetCode: 'USDC', assetIssuer: `G${'A'.repeat(55)}`, balance: 'public' },
    credit: { amount: '2.5000000', assetCode: 'USDC', assetIssuer: `G${'A'.repeat(55)}`, balance: 'private' },
  });
  assert.equal(items[0].private?.deploymentId, 'testnet-usdc-v1');
  assert.equal(items[0].private?.actionIndex, 4);
  assert.equal(items[1].private?.memoHex, Buffer.from('thank you').toString('hex'));
  assert.equal(items[2].private?.memoHex, Buffer.from('invoice 42').toString('hex'));
  assert.equal(items[2].private?.recipientFingerprint, 'ABCD 1234');
});

test('verified private actions replace only their matching generic host-function activity', async () => {
  const { mergePortfolioActivity } = await portfolioDomain();
  const activity = (overrides = {}) => ({
    id: 'activity',
    type: 'invoke_host_function',
    title: 'invoke host function',
    direction: 'neutral',
    amount: null,
    assetCode: null,
    assetIssuer: null,
    counterparty: null,
    hash: '01'.repeat(32),
    createdAt: '2026-08-30T12:00:00.000Z',
    successful: true,
    ...overrides,
  });
  const privateAction = (actionKind, hash, title, createdAt) => activity({
    id: `private:${actionKind}`,
    type: `private_${actionKind}`,
    title,
    direction: actionKind === 'deposit' ? 'in' : 'out',
    amount: '2.5000000',
    assetCode: 'XLM',
    hash,
    createdAt,
    private: { deploymentId: 'testnet-xlm-v1', actionKind },
  });
  const depositHash = '02'.repeat(32);
  const withdrawHash = '03'.repeat(32);
  const transferHash = '04'.repeat(32);
  const unrelatedHash = '05'.repeat(32);
  const publicItems = [
    activity({ id: 'deposit-host', hash: depositHash }),
    activity({ id: 'withdraw-host', hash: withdrawHash }),
    activity({ id: 'transfer-host', hash: transferHash }),
    activity({ id: 'unrelated-host', hash: unrelatedHash }),
  ];
  const privateItems = [
    privateAction('deposit', depositHash, 'Added to private balance', '2026-08-30T12:03:00.000Z'),
    privateAction('withdraw', withdrawHash, 'Withdrew to public balance', '2026-08-30T12:02:00.000Z'),
    privateAction('transfer', transferHash, 'Sent privately', '2026-08-30T12:01:00.000Z'),
  ];

  const merged = mergePortfolioActivity(publicItems, privateItems);

  assert.deepEqual(merged.map(item => item.title), [
    'Added to private balance',
    'Withdrew to public balance',
    'Sent privately',
    'invoke host function',
  ]);
  assert.equal(merged.filter(item => item.type === 'invoke_host_function').length, 1);
  assert.equal(merged.at(-1)?.hash, unrelatedHash);
});

test('private activity without a real transaction hash never hides public host activity', async () => {
  const { mergePortfolioActivity } = await portfolioDomain();
  const publicItem = {
    id: 'host', type: 'invoke_host_function', title: 'invoke host function', direction: 'neutral',
    amount: null, assetCode: null, assetIssuer: null, counterparty: null,
    hash: '06'.repeat(32), createdAt: '2026-08-30T12:00:00.000Z', successful: true,
  };
  const privateItem = {
    ...publicItem,
    id: 'private:restored',
    type: 'private_deposit',
    title: 'Added to private balance',
    hash: 'private:testnet-xlm-v1:restored',
    private: { deploymentId: 'testnet-xlm-v1', actionKind: 'deposit' },
  };

  assert.equal(mergePortfolioActivity([publicItem], [privateItem]).length, 2);
});

test('broadcast private actions remain visible as pending wallet activity', async () => {
  const { privatePortfolioActivityItems } = await portfolioDomain();
  const entries = [{
    deploymentId: 'testnet-xlm-v1',
    asset: {
      code: 'XLM', kind: 'native', issuer: null,
      name: 'Stellar Lumens', decimals: 7, displayDecimals: 7,
      contractId: `C${'A'.repeat(55)}`,
    },
    verifiedBalanceAtomicUnits: '25000000', lastVerifiedLedger: 20, lastVerifiedActionIndex: 3,
    activities: [],
    pendingActions: [{
      id: 'withdraw-pending', kind: 'withdraw', assetContractId: `C${'A'.repeat(55)}`,
      status: 'broadcast', reservedNoteIds: [], actionField: '01'.repeat(32),
      nullifiers: [], outputCommitments: [], anchorRoot: '02'.repeat(32),
      anchorExpiresAtLedger: 30, proofHash: '03'.repeat(32), classicFeeCapStroops: '100',
      resourceFeeCapStroops: '1000000', amountStroops: '2500000', broadcastAttempts: 1,
      transactionHash: '04'.repeat(32), createdAt: 1_700_000_003_000, updatedAt: 1_700_000_003_000,
    }],
  }];

  const [item] = privatePortfolioActivityItems(entries);
  assert.equal(item.title, 'Withdrew to public balance');
  assert.equal(item.amount, '0.2500000');
  assert.equal(item.direction, 'neutral');
  assert.deepEqual(item.internalTransfer, {
    debit: { amount: '0.2500000', assetCode: 'XLM', assetIssuer: null, balance: 'private' },
    credit: { amount: '0.2500000', assetCode: 'XLM', assetIssuer: null, balance: 'public' },
  });
  assert.equal(item.pending, true);
  assert.equal(item.private?.actionIndex, undefined);
});

test('wallet boundary publishes cached summaries for every configured private asset', () => {
  const boundary = readFileSync(
    new URL('../src/components/PrivateBalanceRuntimeBoundary.tsx', import.meta.url),
    'utf8',
  );
  const runtimeHook = readFileSync(
    new URL('../src/hooks/usePrivateBalanceRuntime.tsx', import.meta.url),
    'utf8',
  );

  assert.match(boundary, /withPrivacySessionRoot/);
  assert.match(boundary, /loadPrivateBalanceState/);
  assert.match(boundary, /buildPrivatePortfolioEntries/);
  assert.match(boundary, /encryptedStateExists\s*\?/);
  assert.match(boundary, /updatePrivatePortfolioEntry/);
  assert.match(boundary, /updatePrivatePortfolioPoolEntries/);
  assert.match(
    boundary,
    /registerAvailableAssets\([\s\S]{0,320}?encryptedStateExists:\s*deployment\.encryptedStateExists/,
    'durable pool setup must republish readiness to every asset row',
  );
  assert.match(runtimeHook, /PrivateBalancePortfolioProvider/);
  assert.match(runtimeHook, /usePrivateBalancePortfolio/);
  assert.match(runtimeHook, /entries:\s*PrivatePortfolioEntry\[\]/);
});

test('durable private runtime commits update the stable wallet boundary directly', () => {
  const boundary = readFileSync(
    new URL('../src/components/PrivateBalanceRuntimeBoundary.tsx', import.meta.url),
    'utf8',
  );
  const provider = readFileSync(
    new URL('../src/features/private-balance/runtime/provider.tsx', import.meta.url),
    'utf8',
  );

  assert.match(provider, /onDurableStateChange\?\(/);
  assert.equal(
    provider.match(/onDurableStateChange\?\.\(/g)?.length,
    2,
    'canonical sync and local removal must both publish their durable result',
  );
  assert.match(boundary, /onDurableStateChange=\{publishDurableRuntime\}/);
  assert.match(boundary, /const publishDurableRuntime = useCallback/);
  assert.match(boundary, /setPublishedRuntime/);
  assert.match(boundary, /setPrivatePortfolio/);
});
