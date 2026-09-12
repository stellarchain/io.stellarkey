'use client';

import { useCallback, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useWalletIdentity, useWalletPhase } from '@/hooks/useWallet';
import { createSessionRevocationGuard, getSessionSnapshot, subscribeSessionChanges, subscribeSessionRevocation } from '@/lib/vault';
import { loadExpectedPrivateBalanceCatalogue, loadPrivateBalanceDeployments } from '@/lib/private-balance-assets';
import { createPrivateAccountPortfolioStore, type PrivatePortfolioBalance, type PrivatePortfolioEntry } from '@/features/private-balance/runtime/portfolio';

const serverSession = () => null;

/** Wallet-wide display summaries, scoped independently from selected-account runtime intent. */
export function usePrivateAccountPortfolio(entries: readonly PrivatePortfolioEntry[], activeReady: boolean) {
  const { accounts, activeAccount, network } = useWalletIdentity();
  const { phase } = useWalletPhase();
  const session = useSyncExternalStore(subscribeSessionChanges, getSessionSnapshot, serverSession);
  // Labels and active selection do not invalidate otherwise-current summaries.
  const accountsKey = JSON.stringify(accounts.map(({ id, publicKey, watchOnly, hardware }) => ({ id, publicKey, watchOnly, hardware })));
  const scope = phase === 'unlocked' && session !== null ? `${session}:${network}:${accountsKey}` : null;
  const store = useMemo(() => createPrivateAccountPortfolioStore(
    scope ? (JSON.parse(accountsKey) as typeof accounts).map(account => account.id) : [],
  ), [scope, accountsKey]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const activeId = activeAccount?.id;
  const balancesKey = JSON.stringify(entries.map(({ asset, verifiedBalanceAtomicUnits }) => ({ asset, verifiedBalanceAtomicUnits })));
  const activeBalances = useMemo(() => JSON.parse(balancesKey) as PrivatePortfolioBalance[], [balancesKey]);
  const refreshRef = useRef<(() => Promise<void>) | null>(null);
  const refresh = useCallback(() => refreshRef.current?.() ?? Promise.resolve(), []);

  useLayoutEffect(() => {
    if (!scope) return;
    const scopedAccounts = JSON.parse(accountsKey) as typeof accounts;
    const assertSession = createSessionRevocationGuard();
    store.start();
    let current = true;
    const unsubscribe = subscribeSessionRevocation(() => { current = false; store.stop(); });
    const load = async () => {
      if (!current) return;
      if (scopedAccounts.length === 0) return;
      const catalogue = loadExpectedPrivateBalanceCatalogue()
        .then(({ catalogue }) => loadPrivateBalanceDeployments({ catalogue, network }));
      // Each account fails independently. The store prevents late disk reads
      // from overwriting a newer live/durable publication for that account.
      await Promise.all(scopedAccounts.map(account => store.load(account.id, async assertOwner => {
        const assertCurrent = () => { assertSession(); assertOwner(); };
        assertCurrent();
        const deployments = await catalogue;
        assertCurrent();
        const { loadPrivateAccountPortfolio } = await import('@/features/private-balance/runtime/account-portfolio-loader');
        assertCurrent();
        return loadPrivateAccountPortfolio(account, network, deployments, assertCurrent);
      })));
    };
    refreshRef.current = load;
    void load();
    const onFocus = () => { void load(); };
    window.addEventListener('focus', onFocus);
    return () => { current = false; refreshRef.current = null; unsubscribe(); window.removeEventListener('focus', onFocus); store.stop(); };
  }, [accountsKey, network, scope, store]);

  useLayoutEffect(() => {
    if (scope && activeReady && activeId) store.publish(activeId, activeBalances);
  }, [activeBalances, activeId, activeReady, scope, store]);

  return { accountBalances: snapshot, refresh };
}
