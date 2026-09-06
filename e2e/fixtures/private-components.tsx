'use client';

// Synthetic component fixture only. The runner temporarily mounts this file;
// no fixture route is present in normal development or production builds.
import { useEffect, useRef, useState } from 'react';
import { Button, Modal, ModalHeader, Tabs } from '@/components/ui';
import { WalletProvider } from '@/hooks/useWallet';
import { ToastProvider } from '@/components/Toast';
import { initialPrivateBalanceRuntimeData, PrivateBalanceRuntimeDataProvider } from '@/hooks/usePrivateBalanceRuntime';
import { PrivateOutgoingHistorySettings } from '@/features/private-balance/components/PrivateOutgoingHistorySettings';
import { PrivateActionReview } from '@/features/private-balance/components/PrivateActionReview';
import type { PrivateOutgoingHistoryMode } from '@/features/private-balance/runtime/outgoing-history';
import type { PrivateRelayChainApproval } from '@/features/private-balance/runtime/relay-chain-policy';
import type { PrivateRelayQuote } from '@/features/private-balance/relay/protocol';
import { disclosePrivateProof, PrivateProofConsent, type PrivateProofDisclosure } from '@/features/private-balance/runtime/proof-disclosure';
import { RelayFlowPanel } from '../../../e2e/fixtures/relay-flow-panel';
import { UxPrimitivesFixture } from '../../../e2e/fixtures/ux-primitives';
import { QrFreshnessFixture } from '../../../e2e/fixtures/qr-freshness';
import { RelayHelperFixture } from '../../../e2e/fixtures/relay-helper-panel';
import { RelayRecipientFixture } from '../../../e2e/fixtures/relay-recipient-panel';
import { RelayEarnFixture } from '../../../e2e/fixtures/relay-earn-panel';
import { RelayStartupFixture } from '../../../e2e/fixtures/relay-startup-panel';

const draft = { kind: 'transfer' as const, amount: '1', recipientAddress: 'synthetic-recipient-only' };
const approval: PrivateRelayChainApproval = {
  id: 'synthetic-chain', submissionMode: 'relay', contextKey: 'synthetic', assetContractId: 'synthetic', assetIndex: 0,
  draft, steps: 2, perStepMaxFeeStroops: '1000', cumulativeMaxFeeStroops: '2000', expiresAtSeconds: 4_000_000_000,
  plan: { amountAtomic: '10000000', perStepMaxPrivateFeeAtomic: '100', cumulativeMaxPrivateFeeAtomic: '200', steps: 2,
    inputNotes: [], merges: [], finalInputs: [] },
};
const quote: PrivateRelayQuote = {
  version: 2, type: 'quote', requestId: '11'.repeat(32), quoteId: '22'.repeat(32), peerPubkey: '33'.repeat(32),
  peerAccount: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', feeAtomic: '100',
  accountSignature: 'synthetic-not-a-signed-offer', nonce: '44'.repeat(32), expiresAt: 4_000_000_000,
};

function ProofPanel() {
  const consent = useRef(new PrivateProofConsent());
  const operation = useRef<AbortController | null>(null);
  const [disclosure, setDisclosure] = useState<Readonly<PrivateProofDisclosure> | null>(null);
  const [amount, setAmount] = useState('1');
  const [events, setEvents] = useState<string[]>([]);
  const [status, setStatus] = useState('idle');
  useEffect(() => () => operation.current?.abort(), []);
  const start = () => {
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    setEvents([]); setAmount('1'); setStatus('waiting');
    void disclosePrivateProof({
      request: { kind: 'transfer', actionId: 'synthetic-proof', actionField: '55'.repeat(32), assetContractId: 'synthetic',
        amountStroops: '10000000', recipientAddress: draft.recipientAddress, publicRecipient: null, memoHex: null,
        privateFeeAtomic: '100', maximumNetworkFeeStroops: '1000', submissionMode: 'relay' },
      signal: controller.signal,
      authorize: request => { setDisclosure(request); return consent.current.wait(request.actionId, controller.signal); },
      commit: async () => { setEvents(current => [...current, 'reserved']); },
      disclose: async () => { setEvents(current => [...current, 'shared']); },
    }).then(() => {
      if (operation.current === controller) { setStatus('shared'); setDisclosure(null); }
    }).catch(() => {
      if (operation.current === controller) { setStatus('cancelled'); setDisclosure(null); }
    });
  };
  return <>
    <Button onClick={start}>Start synthetic proof review</Button>
    <Button variant="secondary" onClick={() => setAmount(value => value === '1' ? '2' : '1')}>Change synthetic amount</Button>
    <p data-testid="proof-events">{events.join(',') || 'none'}</p>
    <p data-testid="proof-status">{status}</p>
    <PrivateActionReview draft={{ ...draft, amount }} review={null} disclosure={disclosure} chained={null}
      chainProgress={null} progress={null} relayProgress={null} preparing={false} working={false}
      error={null} errorCause={null} balanceBeforeStroops={20_000_000n} confirmLabel="Send privately"
      onConfirm={() => { if (disclosure) consent.current.approve(disclosure.actionId); }}
      onBack={() => operation.current?.abort()} />
  </>;
}

function Fixture() {
  const [relayStartup, setRelayStartup] = useState(false);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('recovery');
  const [scope, setScope] = useState('account-a');
  const [modes, setModes] = useState<Record<string, PrivateOutgoingHistoryMode>>({});
  const [step, setStep] = useState(1);
  const [waiting, setWaiting] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [writes, setWrites] = useState(0);
  const completion = useRef<(() => void) | null>(null);
  const rejection = useRef<(() => void) | null>(null);
  if (relayStartup) return <RelayStartupFixture />;
  return (
    <PrivateBalanceRuntimeDataProvider value={{ ...initialPrivateBalanceRuntimeData, asset: {
      index: 0, kind: 'native', code: 'XLM', issuer: null, name: 'Synthetic XLM', decimals: 7, displayDecimals: 7, contractId: 'synthetic', status: 'active',
    } }}>
      <main id="app-content" data-app-surface className="min-h-screen p-6">
        <h1 className="text-xl text-white">Synthetic privacy interaction checks</h1>
        <Button onClick={() => setRelayStartup(true)}>Test relay startup</Button>
        <UxPrimitivesFixture />
        <QrFreshnessFixture />
        <RelayHelperFixture />
        <RelayRecipientFixture />
        <RelayEarnFixture />
        <Button onClick={() => { setOpen(true); setCancelled(false); }}>Open privacy controls</Button>
        <p data-testid="writes">{writes}</p>
        <Modal open={open} onClose={() => setOpen(false)} wide>
          <ModalHeader title="Synthetic privacy controls" onClose={() => setOpen(false)} />
          <div className="space-y-4 p-4">
            <Tabs ariaLabel="Privacy check panels" options={[{ value: 'recovery', label: 'Recovery' }, { value: 'chain', label: 'Chain' }, { value: 'proof', label: 'Proof' }, { value: 'relay', label: 'Relay' }]} value={tab} onChange={setTab}>
            {tab === 'recovery' ? <>
              <Button variant="secondary" onClick={() => setScope(value => value === 'account-a' ? 'account-b' : 'account-a')}>Switch synthetic account</Button>
              <Button variant="secondary" onClick={() => completion.current?.()}>Finish pending preference</Button>
              <Button variant="secondary" onClick={() => rejection.current?.()}>Reject pending preference</Button>
              <p data-testid="scope">{scope}</p>
              <PrivateOutgoingHistorySettings scope={scope} mode={modes[scope] ?? 'recoverable'} disabled={false}
                onChange={async (mode, consent) => {
                  if (mode === 'minimized' && consent.acknowledgeRecoveryLoss !== true) throw new Error('Consent required');
                  const selected = scope;
                  try {
                    await new Promise<void>((resolve, reject) => {
                      completion.current = resolve;
                      rejection.current = () => reject(new Error('Synthetic preference write failed.'));
                    });
                    setModes(current => ({ ...current, [selected]: mode }));
                    setWrites(value => value + 1);
                  } finally {
                    completion.current = null;
                    rejection.current = null;
                  }
                }} />
            </> : tab === 'relay' ? <RelayFlowPanel /> : tab === 'proof' ? <ProofPanel /> : cancelled ? <>
              <p>Chain stopped locally</p>
              <Button onClick={() => { setCancelled(false); setStep(1); setWaiting(false); }}>Review another chain</Button>
            </> : <>
              <Button variant="secondary" disabled={!waiting} onClick={() => { setStep(2); setWaiting(false); }}>Deliver canonical synthetic result</Button>
              <PrivateActionReview draft={draft} review={null} chained={{ approval, relayApproval: approval, draft }}
                chainProgress={{ step, totalSteps: 2, stage: waiting ? 'confirming' : 'choosing-peer' }}
                progress={null} relayProgress={null} relayQuotes={waiting ? [] : [{ ...quote, quoteId: String(step).repeat(64) }]}
                preparing={false} working error={null} errorCause={null} balanceBeforeStroops={20_000_000n}
                confirmLabel="Send privately" onConfirm={() => {}} onBack={() => setCancelled(true)}
                onSelectRelayQuote={() => setWaiting(true)} />
            </>}
            </Tabs>
          </div>
        </Modal>
      </main>
    </PrivateBalanceRuntimeDataProvider>
  );
}

export default function PrivateComponentsFixture() {
  return <ToastProvider><WalletProvider><Fixture /></WalletProvider></ToastProvider>;
}
