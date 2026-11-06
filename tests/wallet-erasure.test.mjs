import assert from 'node:assert/strict';
import test from 'node:test';
import { walletCallback } from './helpers/wallet-callback.mjs';

for (const failed of ['vault', 'merchant', 'private', 'registrations', 'unregister', 'cache-list', 'cache-delete', 'session-storage', 'pending-storage', null]) {
  test(`wallet reset ${failed ? `reports incomplete ${failed} cleanup and can retry` : 'reloads only after complete cleanup'}`, async () => {
    let failure = failed;
    let revoked = false;
    let reloads = 0;
    const state = {};
    const step = name => { assert.equal(revoked, true); if (failure === name) throw new Error('synthetic cleanup failure'); };
    const context = {
      invalidateTrackingTasks() {}, lockVaultAndReset() { revoked = true; }, invalidateWalletLifecycle() {},
      walletCoordinationRef: { current: null }, withWalletLifecycleLock: async work => work(),
      wipeVault() { step('vault'); }, clearDurableMergeReconciliations() {},
      clearDurablePendingTransactions() { step('pending-storage'); },
      MERGE_RECONCILIATION_STORAGE_KEY: 'synthetic-merge', PENDING_TX_STORAGE_KEY: 'synthetic-pending',
      window: { localStorage: {}, sessionStorage: { clear() { step('session-storage'); } }, location: { reload() { reloads++; } } },
      indexedDB: {}, require: () => ({ getMerchantRepository: () => ({ clear: async () => step('merchant') }) }),
      IndexedDbEncryptedRecordDriver: class { async removePrefix() { step('private'); } },
      navigator: { serviceWorker: { getRegistrations: async () => { step('registrations'); return [{ unregister: async () => step('unregister') }]; } } },
      caches: { keys: async () => { step('cache-list'); return ['stellarkey-shell', 'unrelated']; }, delete: async name => { assert.equal(name, 'stellarkey-shell'); step('cache-delete'); } },
      snapshotCache: { current: new Map() }, commitTransactionTracking() {}, commitMergeReconciliations() {}, commitSigningPasswordRequired() {},
    };
    for (const name of ['Accounts', 'ArchivedAccounts', 'ActiveId', 'Balances', 'MinimumBalanceXlm', 'DataError', 'AccountBalances', 'AccountPortfolioSnapshots', 'Activity', 'PriceData', 'Contacts', 'VaultStorageIssue', 'Phase']) {
      context[`set${name}`] = value => { state[name] = value; };
    }
    const reset = walletCallback('resetWallet', context);
    await reset();
    assert.equal(revoked, true);
    if (failed) {
      assert.equal(reloads, 0);
      assert.equal(state.Phase, 'recovery');
      assert.equal(state.VaultStorageIssue.kind, 'erasure-incomplete');
      assert.match(state.VaultStorageIssue.message, /incomplete|may remain/i);
      failure = null;
      await reset();
    }
    assert.equal(reloads, 1);
    assert.equal(state.Phase, 'empty');
  });
}
