'use client';

import { useEffect, useRef, useState } from 'react';
import { Keypair } from '@stellar/stellar-sdk';
import { SwapPage } from '@/components/SwapPage';
import { SigningPasswordPrompt } from '@/components/SigningPasswordPrompt';
import { Button } from '@/components/ui';
import { useWallet } from '@/hooks/useWallet';
import { NETWORKS } from '@/lib/stellar';
import { knownAssetIssuer, knownAssetsForNetwork } from '@/lib/assets';

/** Real swap UI, signing prompt and builders; synthetic transport only. */
export function SwapFixture() {
  const wallet = useWallet();
  const [ready, setReady] = useState(false);
  const [signs, setSigns] = useState(0);
  const [posts, setPosts] = useState(0);
  const control = useRef({ balance: '20', trusted: false, authorized: true, authRequired: false,
    reserve: 5000000, confirmed: false });
  useEffect(() => {
    const state = control.current;
    const originalFetch = window.fetch;
    const originalSign = Keypair.prototype.sign;
    Keypair.prototype.sign = function (...args) { setSigns(value => value + 1); return originalSign.apply(this, args); };
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
      if (!Object.values(NETWORKS).some(network => new URL(network.horizonUrl).origin === url.origin)) return originalFetch(input, init);
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
      // Never inspect or retain submitted envelopes. Structural transaction
      // assertions live in the isolated builder tests.
      if (method === 'POST' && url.pathname === '/transactions') { setPosts(value => value + 1); return json({}); }
      if (method !== 'GET') return json({}, 403);
      if (/^\/transactions\/[^/]+$/.test(url.pathname)) return state.confirmed
        ? json({ hash: url.pathname.split('/').at(-1), successful: true }) : json({}, 503);
      if (/^\/accounts\/[^/]+$/.test(url.pathname)) {
        const preferred = knownAssetsForNetwork('testnet')[0];
        return json({ sequence: '1', flags: { auth_required: state.authRequired },
          subentry_count: state.trusted ? 1 : 0, num_sponsoring: 0, num_sponsored: 0,
          thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 },
          signers: [{ key: url.pathname.split('/').at(-1), type: 'ed25519_public_key', weight: 1 }],
          balances: [{ asset_type: 'native', balance: state.balance, selling_liabilities: '0' },
            ...(state.trusted ? [{ asset_type: 'credit_alphanum4', asset_code: preferred.code,
              asset_issuer: knownAssetIssuer(preferred, 'testnet'), balance: '0', limit: '100',
              is_authorized: state.authorized, selling_liabilities: '0', buying_liabilities: '0' }] : [])] });
      }
      if (url.pathname === '/ledgers') return json({ _embedded: { records: [{ base_reserve_in_stroops: state.reserve, closed_at: new Date().toISOString() }] } });
      if (url.pathname === '/fee_stats') return json({ last_ledger_base_fee: '100', fee_charged: { mode: '100', p50: '100', p90: '100', p99: '100' } });
      if (url.pathname === '/paths/strict-send') return json({ _embedded: { records: [{ destination_amount: '1', path: [] }] } });
      if (url.pathname === '/paths/strict-receive') return json({ _embedded: { records: [{ source_amount: '2', path: [] }] } });
      return json({ _embedded: { records: [] } });
    };
    return () => { window.fetch = originalFetch; Keypair.prototype.sign = originalSign; };
  }, []);
  return <main data-app-surface data-app-scroll-owner className="h-screen overflow-auto p-4">
    <h1>Synthetic swap checks</h1>
    {!ready && <Button onClick={() => { void (async () => {
      const { account } = await wallet.createWallet('synthetic swap correct horse battery staple', {
        secret: Keypair.random().secret(), requirePasswordForSigning: true,
      });
      await wallet.addWatchOnly(Keypair.random().publicKey(), 'Other synthetic account');
      wallet.selectAccount(account.id);
      wallet.completeSetup();
      setSigns(0);
      setReady(true);
    })(); }}>Prepare swap checks</Button>}
    <Button onClick={() => { control.current.trusted = true; }}>Use existing swap trustline</Button>
    <Button onClick={() => { control.current.balance = '1.5'; }}>Use low swap balance</Button>
    <Button onClick={() => { control.current.reserve = 6000000; }}>Raise swap reserve</Button>
    <Button onClick={() => { control.current.authRequired = true; }}>Require swap issuer approval</Button>
    <Button onClick={() => wallet.selectAccount(wallet.accounts[1].id)}>Replace swap account</Button>
    <Button onClick={() => {
      const confirm = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
        .find(button => button.textContent?.trim() === 'Confirm Swap');
      confirm?.click(); confirm?.click();
    }}>Double confirm swap</Button>
    <p data-testid="swap-ready">{String(ready && !wallet.dataLoading && wallet.minimumBalanceXlm !== null)}</p>
    <p data-testid="swap-signs">{signs}</p>
    <p data-testid="swap-posts">{posts}</p>
    {ready && <SwapPage />}
    <SigningPasswordPrompt />
  </main>;
}
