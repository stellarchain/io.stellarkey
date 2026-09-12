'use client';

import { useEffect, useRef, useState } from 'react';
import { Keypair } from '@stellar/stellar-sdk';
import { UnlockedWalletShell } from '@/components/UnlockedWalletShell';
import { Button } from '@/components/ui';
import { useWallet } from '@/hooks/useWallet';
import { NETWORKS } from '@/lib/stellar';
import { seedSyntheticAccountValues } from './account-values';

// The production shell, password prompt, provider and signing API stay real.
// Only synthetic transport delivery is controlled; request bodies are not read.
export function SigningContextFixture() {
  const wallet = useWallet();
  const [ready, setReady] = useState(false);
  const [stage, setStage] = useState('idle');
  const [posts, setPosts] = useState(0);
  const [signs, setSigns] = useState(0);
  const [deliveries, setDeliveries] = useState(0);
  const [accountReads, setAccountReads] = useState(0);
  const captured = useRef<(() => void) | null>(null);
  const [oldAuthority, setOldAuthority] = useState('unchecked');
  const [freshAuthority, setFreshAuthority] = useState('unchecked');
  const control = useRef({ hold: false, confirmed: false, portfolio: false, gates: [] as Array<() => void> });
  useEffect(() => {
    const state = control.current;
    const originalFetch = window.fetch;
    const originalSign = Keypair.prototype.sign;
    Keypair.prototype.sign = function (...args) { setSigns(value => value + 1); return originalSign.apply(this, args); };
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
      if (state.portfolio && url.hostname === 'api.coingecko.com' && url.pathname.endsWith('/simple/price')) return json({ stellar: { usd: 0.25 } });
      if (!Object.values(NETWORKS).some(network => new URL(network.horizonUrl).origin === url.origin)) return originalFetch(input, init);
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
      if (method === 'POST' && url.pathname === '/transactions') { setPosts(value => value + 1); return json({}); }
      if (method !== 'GET') return json({}, 403);
      if (/^\/transactions\/[^/]+$/.test(url.pathname)) return state.confirmed
        ? json({ hash: url.pathname.split('/').at(-1), successful: true }) : json({}, 503);
      if (/^\/accounts\/[^/]+$/.test(url.pathname)) {
        setAccountReads(value => value + 1);
        // Only the payment reads this fixed non-usable recipient. Background
        // refresh and signer-info reads address the generated wallet accounts.
        if (state.hold && url.pathname === '/accounts/GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF') {
          state.hold = false;
          setStage('preparation');
          await new Promise<void>(resolve => state.gates.push(resolve));
          setDeliveries(value => value + 1);
        }
        return json({ sequence: '1', subentry_count: 0, num_sponsoring: 0, num_sponsored: 0,
          thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
          signers: [{ key: url.pathname.split('/').at(-1), type: 'ed25519_public_key', weight: 1 }],
          balances: [{ asset_type: 'native', balance: '20.0000000', selling_liabilities: '0' }] });
      }
      if (url.pathname === '/ledgers') return json({ _embedded: { records: [{ base_reserve_in_stroops: 5000000, closed_at: new Date().toISOString() }] } });
      if (url.pathname === '/fee_stats') return json({ last_ledger_base_fee: '100', fee_charged: { mode: '100', p50: '100', p70: '100', p95: '100' } });
      return json({ _embedded: { records: [] } });
    };
    return () => {
      window.fetch = originalFetch;
      Keypair.prototype.sign = originalSign;
      for (const resolve of state.gates) resolve();
      state.gates = [];
    };
  }, []);
  return <>
    {!ready && <Button onClick={() => { void (async () => {
      control.current.portfolio = true;
      const { account } = await wallet.createWallet('synthetic signing correct horse battery staple', {
        secret: Keypair.random().secret(), label: 'Signing account',
      });
      const other = await wallet.addAccount({ secret: Keypair.random().secret(), label: 'Other account' });
      await seedSyntheticAccountValues(account.id, '40000000');
      await seedSyntheticAccountValues(other.id, '60000000');
      wallet.changeFiatCurrency('USD');
      wallet.selectAccount(account.id);
      wallet.completeSetup();
      setReady(true);
    })().catch(() => setStage('fixture setup failed')); }}>Prepare account values</Button>}
    {!ready && <Button onClick={() => { void (async () => {
      const { account } = await wallet.createWallet('synthetic signing correct horse battery staple', {
        secret: Keypair.random().secret(), label: 'Signing account', requirePasswordForSigning: true,
      });
      await wallet.addWatchOnly(Keypair.random().publicKey(), 'Other account');
      wallet.selectAccount(account.id);
      wallet.completeSetup();
      setSigns(0);
      setReady(true);
    })(); }}>Prepare signing context</Button>}
    <div hidden>
      <Button onClick={() => { void seedSyntheticAccountValues(wallet.accounts[1].id, '90000000').then(() => setStage('private checkpoint updated')); }}>Update other private checkpoint</Button>
      <Button onClick={() => wallet.switchNetwork('testnet')}>Restore account values network</Button>
      <Button onClick={() => wallet.lock()}>Lock account values</Button>
      <Button onClick={() => { captured.current = wallet.captureSigningContext(); }}>Capture provider signing context</Button>
      <Button onClick={() => {
        wallet.selectAccount(wallet.accounts[1].id);
        wallet.selectAccount(wallet.accounts[0].id);
      }}>Batch provider account roundtrip</Button>
      <Button onClick={() => { wallet.switchNetwork('mainnet'); wallet.switchNetwork('testnet'); }}>Batch provider network roundtrip</Button>
      <Button onClick={() => wallet.selectAccount(wallet.accounts[0].id)}>Restore provider signing account</Button>
      <Button onClick={() => wallet.switchNetwork('mainnet')}>Switch provider result network</Button>
      <Button onClick={() => { control.current.confirmed = true; }}>Confirm canonical synthetic submission</Button>
      <Button onClick={() => {
        try { captured.current?.(); setOldAuthority('current'); } catch { setOldAuthority('revoked'); }
        try { wallet.captureSigningContext()(); setFreshAuthority('current'); } catch { setFreshAuthority('revoked'); }
      }}>Check provider signing contexts</Button>
      <p data-testid="signing-old-authority">{oldAuthority}</p>
      <p data-testid="signing-fresh-authority">{freshAuthority}</p>
      <Button onClick={() => { control.current.hold = true; setStage('armed'); }}>Hold signing preparation</Button>
      <Button onClick={() => { void wallet.refresh(); }}>Refresh provider signing balances</Button>
      <Button onClick={() => { for (const resolve of control.current.gates.splice(0)) resolve(); }}>Deliver signing preparation</Button>
      <p data-testid="signing-stage">{stage}</p>
      <p data-testid="signing-posts">{posts}</p>
      <p data-testid="signing-signs">{signs}</p>
      <p data-testid="signing-deliveries">{deliveries}</p>
      <p data-testid="signing-account-reads">{accountReads}</p>
      <p data-testid="signing-account">{wallet.activeAccount?.label}</p>
      <p data-testid="signing-network">{wallet.network}</p>
      <p data-testid="signing-ledger-ready">{String(!wallet.dataLoading && Boolean(wallet.balances?.length))}</p>
    </div>
    {ready && <UnlockedWalletShell />}
  </>;
}
