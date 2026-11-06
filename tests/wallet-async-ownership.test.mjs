import assert from 'node:assert/strict';
import test from 'node:test';
import { walletCallback } from './helpers/wallet-callback.mjs';
import { createLatestRequestLane } from '../src/hooks/useWalletResources.ts';
import { settleResourceMap, describeResourceFailures } from '../src/lib/wallet-refresh.ts';

function refreshHarness() {
  const identity = { accountId: 'A', network: 'testnet' };
  const state = { balances: [{ balance: 'B' }], activity: [{ id: 'B' }] };
  let loads = 0;
  let pause = Promise.resolve();
  const context = {
    activeAccount: { publicKey: 'A' }, network: 'testnet', endpointRevision: 0,
    endpointRevisionRef: { current: 0 }, signingContext: identity, signingContextRef: { current: identity },
    accountRefreshLane: createLatestRequestLane(), refreshGeneration: { current: 0 },
    portfolioSnapshotKey: (network, key) => `${network}:${key}`,
    snapshotCache: { current: new Map() }, activityRef: { current: state.activity },
    settleResourceMap, describeResourceFailures,
    loadWalletApi: async () => {
      loads++;
      await pause;
      return {
        fetchAccountSnapshot: async () => ({ balances: [{ balance: 'A', isNative: true }] }),
        fetchCurrentBaseReserve: async () => '1', minimumNativeBalanceForSnapshot: () => '1',
        fetchClaimableBalances: async () => [], fetchActivity: async () => ({ items: [{ id: 'A' }], nextCursor: null }),
      };
    },
  };
  for (const name of ['Balances', 'Activity', 'AccountPortfolioSnapshots', 'DataLoading', 'DataError', 'MinimumBalanceXlm', 'ClaimableBalances', 'ActivityCursor', 'AccountBalances']) {
    const key = name[0].toLowerCase() + name.slice(1);
    context[`set${name}`] = value => { state[key] = typeof value === 'function' ? value(state[key] ?? {}) : value; };
  }
  return { context, state, loads: () => loads, hold: promise => { pause = promise; }, run: () => walletCallback('refreshAccountData', context)() };
}

for (const replacement of ['account', 'network', 'aba', 'endpoint', 'unmount']) {
  test(`stale refresh entry after ${replacement} cannot replace the visible wallet`, async () => {
    const h = refreshHarness();
    if (replacement === 'endpoint') h.context.endpointRevisionRef.current++;
    else h.context.signingContextRef.current = replacement === 'unmount' ? null
      : replacement === 'aba' ? { ...h.context.signingContext }
      : { ...h.context.signingContext, [replacement === 'network' ? 'network' : 'accountId']: 'changed' };
    await h.run();
    assert.equal(h.loads(), 0);
    assert.equal(h.state.balances[0].balance, 'B');
    assert.deepEqual(h.state.activity, [{ id: 'B' }]);
  });
}

test('refresh publication and cleanup belong to the captured wallet identity', async () => {
  const h = refreshHarness();
  let release;
  h.hold(new Promise(resolve => { release = resolve; }));
  const outcome = h.run();
  h.context.signingContextRef.current = { accountId: 'B' };
  h.state.dataLoading = 'new-owner';
  release(); await outcome;
  assert.equal(h.state.balances[0].balance, 'B');
  assert.equal(h.state.dataLoading, 'new-owner');
});

test('pending status API load failure releases its latch for an explicit retry', async () => {
  let loads = 0;
  const context = {
    trackingTaskGeneration: { current: 0 }, pendingPolls: { current: new Set() }, pendingPollTimers: { current: new Map() },
    transactionIdentity: tx => tx.hash, pendingTransactionNeedsManualCheck: () => true,
    loadWalletApi: async () => { if (++loads === 1) throw new Error('synthetic import failure'); return { waitForTransaction: async () => null }; },
    isTrackingTaskCurrent: () => true, transactionTrackingRef: { current: { pending: [] } },
  };
  const poll = walletCallback('pollPending', context);
  await poll({ hash: 'synthetic', network: 'testnet' });
  assert.equal(context.pendingPolls.current.size, 0);
  await poll({ hash: 'synthetic', network: 'testnet' });
  assert.equal(loads, 2);
  assert.equal(context.pendingPolls.current.size, 0);
});

test('current refresh publishes balances and activity normally', async () => {
  const h = refreshHarness();
  await h.run();
  assert.equal(h.loads(), 1);
  assert.equal(h.state.balances[0].balance, 'A');
  assert.equal(h.state.activity[0].id, 'A');
  assert.equal(h.state.dataLoading, false);
});
