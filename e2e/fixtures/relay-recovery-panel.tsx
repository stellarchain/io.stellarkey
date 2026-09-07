'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import { IndexedDbEncryptedRecordDriver } from '@/lib/indexed-db';
import type { PrivateBalanceManifest } from '@/lib/private-balance-manifest';
import { PrivateActionReview } from '@/features/private-balance/components/PrivateActionReview';
import { PrivateRecovery } from '@/features/private-balance/components/PrivateRecovery';
import { initialPrivateBalanceRuntimeData, PrivateBalanceRuntimeDataProvider } from '@/hooks/usePrivateBalanceRuntime';
import { PrivateProofConsent, type PrivateProofDisclosure } from '@/features/private-balance/runtime/proof-disclosure';
import { parsePrivateAmount } from '@/features/private-balance/runtime/coin-selection';
import { createRelayRecoveryScenario, readRelayRecoveryBalances, readRelayRecoveryState, type PrepareMode, type SubmitMode } from './relay-recovery-scenario';
import type { PrivateBalanceDurableState } from '@/features/private-balance/runtime/types';
import development from '../../protocol/private-balance/manifests/development.json';
import { RelayRecoveryProviderFixture } from './relay-recovery-provider-panel';

type Scenario = Awaited<ReturnType<typeof createRelayRecoveryScenario>>;
type Balances = Awaited<ReturnType<typeof readRelayRecoveryBalances>>;

export function RelayRecoveryFixture() {
  const [provider, setProvider] = useState(false);
  const [deposits, setDeposits] = useState('100');
  const [amount, setAmount] = useState('10');
  const [prepareMode, setPrepareMode] = useState<PrepareMode>('approve');
  const [submitMode, setSubmitMode] = useState<SubmitMode>('PENDING');
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [balances, setBalances] = useState<Balances | null>(null);
  const [status, setStatus] = useState('idle');
  const [fresh, setFresh] = useState('unchecked');
  const [busy, setBusy] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [durable, setDurable] = useState<PrivateBalanceDurableState | null>(null);
  const [disclosure, setDisclosure] = useState<Readonly<PrivateProofDisclosure> | null>(null);
  const consent = useRef(new PrivateProofConsent());
  const operation = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; operation.current?.abort(); };
  }, []);
  const driver = () => new IndexedDbEncryptedRecordDriver();
  const run = async (action: () => Promise<string>, current = scenario) => {
    setBusy(true);
    let result: string;
    try { result = await action(); }
    catch (error) {
      // Fixed labels only; never serialize envelopes, proofs or wallet errors.
      result = error instanceof Error && error.name === 'PrivateProofExposedError' ? 'exposed'
        : error instanceof Error && error.name === 'AbortError' ? 'cancelled' : 'failed';
    }
    const snapshot = current ? await current.balances() : null;
    if (!mounted.current) return;
    if (snapshot) setBalances(snapshot);
    if (current) setDurable(await current.state());
    setDisclosure(null); setStatus(result); setBusy(false);
  };
  const prepare = () => {
    if (!scenario) return;
    const controller = new AbortController();
    operation.current?.abort(); operation.current = controller;
    void run(async () => {
      await scenario.prepare(prepareMode, request => {
        setDisclosure(request); setStatus('consent');
        return consent.current.wait(request.actionId, controller.signal);
      });
      return 'reviewed';
    });
  };
  const submit = () => {
    if (!scenario) return;
    void run(async () => (await scenario.submit(submitMode)).status);
  };
  if (provider) return <RelayRecoveryProviderFixture />;
  return <PrivateBalanceRuntimeDataProvider value={{ ...initialPrivateBalanceRuntimeData,
    configured: true, phase: 'current', isLeader: true,
    pendingActions: durable?.pendingActions ?? [], spendRecovery: durable?.spendRecovery ?? null,
    asset: { ...development.assets[0], kind: 'native', status: 'active' },
    refreshSync: async () => {
      if (!scenario) return;
      await scenario.sync(); setDurable(await scenario.state()); setBalances(await scenario.balances());
    },
    prepareSpendRecovery: async (_actionId, _progress, signal, authorize) => {
      if (!scenario) throw new Error('Synthetic scenario unavailable after reload');
      try { return await scenario.prepare('approve', authorize, true, signal); }
      finally { if (mounted.current) { setDurable(await scenario.state()); setBalances(await scenario.balances()); } }
    },
    submitAction: async review => {
      if (!scenario || scenario.review?.id !== review.id) throw new Error('Synthetic review mismatch');
      try { return (await scenario.submit(submitMode)).status; }
      finally { if (mounted.current) { setDurable(await scenario.state()); setBalances(await scenario.balances()); } }
    } }}>
    <main data-app-surface className="min-h-screen space-y-4 p-6">
      <h1 className="text-xl">Synthetic three-wallet relay recovery</h1>
      <Button disabled={!!scenario} onClick={() => setProvider(true)}>Test real recovery provider</Button>
      <p>Non-usable fixtures only. Alice charges 3 XLM. Proof generation and network responses are controlled.</p>
      <div><label htmlFor="synthetic-deposits">Synthetic Bob deposits</label>
        <input id="synthetic-deposits" value={deposits} disabled={!!scenario || busy} onChange={event => setDeposits(event.target.value)} /></div>
      <div><label htmlFor="synthetic-amount">Synthetic Charlie payment</label>
        <input id="synthetic-amount" value={amount} disabled={!!scenario || busy} onChange={event => setAmount(event.target.value)} /></div>
      <div><label htmlFor="synthetic-prepare">Synthetic preparation response</label>
        <select id="synthetic-prepare" value={prepareMode} disabled={busy} onChange={event => setPrepareMode(event.target.value as PrepareMode)}>
          {(['approve', 'proof-failure', 'quote-expired', 'helper-reject', 'helper-timeout'] as const).map(mode => <option key={mode}>{mode}</option>)}
        </select></div>
      <div><label htmlFor="synthetic-submit">Synthetic submission response</label>
        <select id="synthetic-submit" value={submitMode} disabled={busy} onChange={event => setSubmitMode(event.target.value as SubmitMode)}>
          {(['PENDING', 'ERROR', 'timeout', 'signer-reject'] as const).map(mode => <option key={mode}>{mode}</option>)}
        </select></div>
      <Button disabled={busy || !!scenario} onClick={() => { void run(async () => {
        const created = await createRelayRecoveryScenario(development as PrivateBalanceManifest, driver(), { deposits: deposits.split(','), amount });
        if (mounted.current) { setScenario(created); setBalances(await created.balances()); }
        return 'seeded';
      }); }}>Create synthetic deposits</Button>
      <Button disabled={busy || !scenario} onClick={prepare}>Review Bob payment</Button>
      <Button disabled={busy || !scenario?.review} onClick={submit}>Submit through Alice</Button>
      <Button disabled={busy || !durable} onClick={() => setRecoveryOpen(true)}>Open held balance recovery</Button>
      <Button disabled={busy || !scenario} onClick={() => { void run(async () => {
        await scenario!.changeState(state => ({ ...state, spendRecovery: { originalActionField: '61'.repeat(32), recoveryActionFields: ['62'.repeat(32)],
          reservedNoteIds: ['63'.repeat(32)], assetContractId: development.assets[0].contractId, outcome: 'recovered' } }));
        return 'prior-recovery-seeded';
      }); }}>Seed unrelated prior recovery</Button>
      <Button disabled={busy || !scenario?.shared} onClick={() => { void run(async () => {
        await scenario!.expireAndRecover(); return 'reconciled';
      }); }}>Expire and reconcile synthetic payment</Button>
      <Button disabled={busy || !scenario?.shared} onClick={() => { void run(async () => {
        await scenario!.confirm(); return 'confirmed';
      }); }}>Deliver canonical synthetic payment</Button>
      <Button disabled={busy || !scenario?.shared} onClick={() => { void run(async () => {
        await scenario!.confirm(true); return 'confirmed';
      }); }}>Deliver canonical synthetic recovery</Button>
      <Button disabled={busy || !scenario} onClick={() => { void run(async () => {
        const scanned = await scenario!.freshScanBalances();
        const current = await scenario!.balances();
        const matches = ['bob', 'alice', 'charlie'].every(name => scanned[name] === current[name as 'bob' | 'alice' | 'charlie']);
        if (mounted.current) setFresh(matches ? 'verified' : 'mismatch');
        return status;
      }); }}>Verify fresh three-wallet scan</Button>
      <Button disabled={busy} onClick={() => { void run(async () => {
        const stored = await readRelayRecoveryBalances(development as PrivateBalanceManifest, driver());
        if (mounted.current) { setBalances(stored); setDurable(await readRelayRecoveryState(development as PrivateBalanceManifest, driver())); }
        return 'restored';
      }); }}>Inspect persisted synthetic balances</Button>
      <p data-testid="relay-recovery-status">{status}</p>
      <p data-testid="relay-recovery-fresh">{fresh}</p>
      <p data-testid="relay-recovery-shared">{scenario?.shared ?? 0}</p>
      <p data-testid="relay-recovery-submissions">{scenario?.submissions ?? 0}</p>
      <p data-testid="relay-recovery-sender-lookups">{scenario?.senderLookups ?? 0}</p>
      {balances ? Object.entries(balances).map(([name, value]) => <p key={name}>{name}: <span data-testid={`relay-recovery-${name}`}>{value}</span></p>) : null}
      {scenario && disclosure ? <PrivateActionReview draft={scenario.draft} disclosure={disclosure} review={null}
        chained={null} chainProgress={null} progress={null} preparing={false} working={false} error={null} errorCause={null}
        balanceBeforeStroops={deposits.split(',').reduce((sum, value) => sum + parsePrivateAmount(value, 7), 0n)} confirmLabel="Send privately"
        onConfirm={() => consent.current.approve(disclosure.actionId)} onBack={() => operation.current?.abort()} /> : null}
      {recoveryOpen ? <PrivateRecovery onClose={() => setRecoveryOpen(false)} /> : null}
    </main>
  </PrivateBalanceRuntimeDataProvider>;
}
