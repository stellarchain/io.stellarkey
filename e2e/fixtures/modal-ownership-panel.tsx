'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Keypair } from '@stellar/stellar-sdk';
import { AddAccountModal } from '@/components/AddAccountModal';
import { ClaimableBalancesModal } from '@/components/ClaimableBalancesModal';
import { Button } from '@/components/ui';
import { useWallet } from '@/hooks/useWallet';
import { NETWORKS } from '@/lib/stellar';

type Gate = { resolve(): void; reject(): void };
const hiddenBalance = `00000000${'02'.repeat(32)}`;

// Actual modals, wallet, encryption and submission tracking. Only delivery timing
// and synthetic HTTP responses are controlled. No request body is read or logged.
export function ModalOwnershipFixture({ onExit }: { onExit(): void }) {
  const wallet = useWallet();
  const latestWallet = useRef(wallet);
  useLayoutEffect(() => { latestWallet.current = wallet; }, [wallet]);
  const [ready, setReady] = useState(false);
  const [mnemonicSetup, setMnemonicSetup] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);
  const [conditional, setConditional] = useState(false);
  const [inlineClose, setInlineClose] = useState(false);
  const [parentRenders, setParentRenders] = useState(0);
  const [closes, setCloses] = useState(0);
  const [handoffs, setHandoffs] = useState(0);
  const [dismissed, setDismissed] = useState([hiddenBalance]);
  const [stage, setStage] = useState('idle');
  const [encryptions, setEncryptions] = useState(0);
  const [deliveries, setDeliveries] = useState(0);
  const [posts, setPosts] = useState(0);
  const [lookups, setLookups] = useState(0);
  const [refreshes, setRefreshes] = useState(0);
  const control = useRef({ encrypt: false, http: '', result: 'unknown', canonical: 'hold', gates: [] as Gate[] });
  const closeAccount = useCallback(() => { setCloses(value => value + 1); setAccountOpen(false); }, []);
  const closeClaim = useCallback(() => { setCloses(value => value + 1); setClaimOpen(false); }, []);

  useEffect(() => {
    const state = control.current;
    const originalEncrypt = SubtleCrypto.prototype.encrypt;
    const originalFetch = window.fetch;
    const issuer = Keypair.random().publicKey();
    const pause = async (stage: string) => {
      setStage(stage);
      try {
        await new Promise<void>((resolve, reject) => state.gates.push({ resolve, reject: () => reject(new Error('Synthetic response failed')) }));
      } finally { setDeliveries(value => value + 1); }
    };
    SubtleCrypto.prototype.encrypt = async function (...args) {
      const held = state.encrypt;
      if (held) state.encrypt = false;
      const result = await originalEncrypt.apply(this, args);
      if (held) { setEncryptions(value => value + 1); await pause('encryption'); }
      return result;
    };
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
      if (!Object.values(NETWORKS).some(network => new URL(network.horizonUrl).origin === url.origin)) return originalFetch(input, init);
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
      if (method === 'POST' && url.pathname === '/transactions') {
        setPosts(value => value + 1);
        if (state.http === 'submission') { state.http = ''; await pause('submission'); }
        const prepared = latestWallet.current.pendingTxs.find(transaction => transaction.label === 'Airdrop claim');
        return json(state.result === 'accepted' && prepared ? { hash: prepared.hash } : {});
      }
      if (method !== 'GET') return json({}, 403);
      if (/^\/transactions\/[^/]+$/.test(url.pathname)) {
        setLookups(value => value + 1);
        if (state.result === 'confirmed') state.canonical = 'confirmed';
        if (state.canonical === 'hold') await pause('canonical');
        if (state.canonical === 'unavailable') return json({}, 503);
        return json({ hash: url.pathname.split('/').at(-1), successful: state.canonical !== 'failed' });
      }
      if (/^\/accounts\/[^/]+$/.test(url.pathname)) {
        if (state.http === 'preparation' || state.http === 'refresh') {
          const stage = state.http;
          if (stage === 'preparation') state.http = '';
          else setRefreshes(value => value + 1);
          try {
            await pause(stage);
          } catch {
            // A rejected GET transport is retryable. This control represents a
            // definitive preparation rejection, so it must not later submit.
            return json({}, 400);
          }
        }
        return json({ sequence: '1', subentry_count: 0, num_sponsoring: 0, num_sponsored: 0,
          balances: [{ asset_type: 'native', balance: '20.0000000', selling_liabilities: '0' }] });
      }
      if (url.pathname === '/claimable_balances') return json({ _embedded: { records: [
        { id: `00000000${'01'.repeat(32)}`, asset: 'native', amount: '1.0000000' },
        { id: hiddenBalance, asset: 'native', amount: '2.0000000' },
        { id: `00000000${'03'.repeat(32)}`, asset: `TEST:${issuer}`, amount: '3.0000000' },
      ] } });
      if (url.pathname === '/ledgers') return json({ _embedded: { records: [{ base_reserve_in_stroops: 5000000, closed_at: new Date().toISOString() }] } });
      if (url.pathname === '/fee_stats') return json({ last_ledger_base_fee: '100', fee_charged: { mode: '100', p50: '100', p70: '100', p95: '100' } });
      return json({ _embedded: { records: [] } });
    };
    return () => {
      SubtleCrypto.prototype.encrypt = originalEncrypt;
      window.fetch = originalFetch;
      state.canonical = 'unavailable';
      for (const gate of state.gates) gate.resolve();
      state.gates = [];
    };
  }, []);

  return <main data-app-surface data-app-scroll-owner className="h-screen overflow-auto p-6">
    <h1>Synthetic modal ownership checks</h1>
    <Button onClick={onExit}>Dispose modal checks</Button>
    <Button onClick={() => setMnemonicSetup(true)}>Use recovery phrase setup</Button>
    <Button onClick={() => { void wallet.createWallet('synthetic modal correct horse battery staple', mnemonicSetup ? undefined : { secret: Keypair.random().secret() }).then(() => {
      wallet.completeSetup(); setReady(true);
    }); }}>Prepare modal checks</Button>
    <Button onClick={() => setAccountOpen(true)}>Open account modal</Button>
    <Button onClick={() => setAccountOpen(false)}>Force account closed</Button>
    <Button onClick={() => {
      const input = document.querySelector<HTMLInputElement>('input[placeholder="S..."]');
      if (!input) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, Keypair.random().secret());
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }}>Fill synthetic import</Button>
    <Button onClick={() => { control.current.encrypt = true; setStage('armed'); }}>Hold next encryption</Button>
    <Button onClick={() => setClaimOpen(true)}>Open claim modal</Button>
    <Button onClick={() => setClaimOpen(false)}>Force claim closed</Button>
    <Button onClick={() => setConditional(value => !value)}>Toggle conditional mount</Button>
    <Button onClick={() => setInlineClose(value => !value)}>Toggle inline close callback</Button>
    <Button onClick={() => setParentRenders(value => value + 1)}>Rerender modal parent</Button>
    {['preparation', 'submission', 'refresh'].map(stage => <Button key={stage} onClick={() => { control.current.http = stage; setStage('armed'); }}>Hold {stage}</Button>)}
    {['accepted', 'confirmed', 'unknown'].map(result => <Button key={result} onClick={() => { control.current.result = result; control.current.canonical = result === 'unknown' ? 'unavailable' : 'hold'; }}>Use {result} response</Button>)}
    {['confirmed', 'failed', 'unavailable', 'hold'].map(result => <Button key={result} onClick={() => { control.current.canonical = result; }}>Canonical {result}</Button>)}
    <Button onClick={() => control.current.gates.shift()?.resolve()}>Deliver oldest response</Button>
    <Button onClick={() => control.current.gates.shift()?.reject()}>Fail oldest response</Button>
    <Button onClick={() => { control.current.http = ''; for (const gate of control.current.gates.splice(0)) gate.resolve(); }}>Deliver all responses</Button>
    <p data-testid="modal-ready">{String(ready && wallet.claimableBalances.length === 3)}</p>
    <p data-testid="modal-stage">{stage}</p>
    <p data-testid="modal-closes">{closes}</p>
    <p data-testid="modal-handoffs">{handoffs}</p>
    <p data-testid="modal-encryptions">{encryptions}</p>
    <p data-testid="modal-deliveries">{deliveries}</p>
    <p data-testid="modal-posts">{posts}</p>
    <p data-testid="modal-lookups">{lookups}</p>
    <p data-testid="modal-refreshes">{refreshes}</p>
    <p data-testid="modal-parent-renders">{parentRenders}</p>
    <p data-testid="modal-pending">{wallet.pendingTxs.filter(transaction => transaction.label === 'Airdrop claim').length}</p>
    <AddAccountModal open={accountOpen} onClose={closeAccount} />
    {(!conditional || claimOpen) && <ClaimableBalancesModal open={claimOpen} dismissedBalanceIds={dismissed} onClose={inlineClose ? () => closeClaim() : closeClaim}
      onDismiss={id => setDismissed(value => [...value, id])} onRestore={id => setDismissed(value => value.filter(item => item !== id))}
      onAddAsset={() => { setHandoffs(value => value + 1); setClaimOpen(false); }} />}
  </main>;
}
