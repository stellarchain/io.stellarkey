'use client';

// Synthetic runtime and wire only: the production helper manager owns approval/submission state.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import { initialPrivateBalanceRuntimeData, PrivateBalanceRuntimeControlProvider, PrivateBalanceRuntimeDataProvider } from '@/hooks/usePrivateBalanceRuntime';
import { PrivateRelayHelperManager } from '@/features/private-balance/components/PrivateRelayHelperManager';
import { PrivateRelayHelperSession } from '@/features/private-balance/relay/session';
import { loadPrivateRelayPreferences, savePrivateRelayPreferences } from '@/features/private-balance/relay/preferences';
import type { PrivateRelayJobReview } from '@/features/private-balance/relay/review';
import type { PrivateRelayQuote, PrivateRelayRequest, PrivateRelaySignedJob, PrivateRelaySignJob } from '@/features/private-balance/relay/protocol';

export function RelayHelperFixture() {
  const [enabled, setEnabled] = useState(false);
  const [scope, setScope] = useState('synthetic-helper');
  const [phase, setPhase] = useState('idle');
  const [signs, setSigns] = useState(0);
  const [submits, setSubmits] = useState(0);
  const [rejects, setRejects] = useState(0);
  const requestReceiver = useRef<Parameters<PrivateRelayHelperSession['listenForRequests']>[0] | null>(null);
  const receive = useRef<Parameters<PrivateRelayHelperSession['listenForPrivateMessages']>[0] | null>(null);
  const finishSigning = useRef<(() => void) | null>(null);
  const finishSubmit = useRef<((fail?: boolean) => void) | null>(null);
  const acknowledge = useRef<((fail?: boolean) => void) | null>(null);
  const signed = useRef<PrivateRelaySignedJob | null>(null);
  const [context] = useState(() => {
    const expiresAt = Math.floor(Date.now() / 1000) + 120;
    const request: PrivateRelayRequest = { version: 2, type: 'request', requestId: '11'.repeat(32), networkId: '22'.repeat(32),
      poolContractId: 'synthetic', replyPubkey: '33'.repeat(32), nonce: '44'.repeat(32), expiresAt };
    const quote: PrivateRelayQuote = { version: 2, type: 'quote', requestId: request.requestId, quoteId: '55'.repeat(32),
      peerPubkey: '66'.repeat(32), peerAccount: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', feeAtomic: '1',
      accountSignature: 'synthetic-not-an-authorization', nonce: '77'.repeat(32), expiresAt };
    const job: PrivateRelaySignJob = { version: 2, type: 'sign-job', requestId: request.requestId, quoteId: quote.quoteId,
      transactionHash: '88'.repeat(32), unsignedEnvelopeXdr: 'synthetic-not-an-envelope', nonce: '99'.repeat(32), expiresAt };
    return { request, quote, job };
  });
  useEffect(() => {
    const original = PrivateRelayHelperSession.create;
    PrivateRelayHelperSession.create = async () => ({
      listenForRequests: (callback: typeof requestReceiver.current) => { requestReceiver.current = callback; return { close() {} }; },
      listenForPrivateMessages: (callback: typeof receive.current) => { receive.current = callback; setPhase('ready'); return { close() {} }; },
      offerQuote: async () => context.quote,
      sendPayout: async () => { setPhase('payout'); },
      sendPrepared: async () => { setPhase('prepared'); },
      sendSigned: async (input: Parameters<PrivateRelayHelperSession['sendSigned']>[0]) => {
        const response: PrivateRelaySignedJob = { version: 2, type: 'signed-job', requestId: input.job.requestId,
          quoteId: input.job.quoteId, transactionHash: input.job.transactionHash, signedEnvelopeXdr: input.signedEnvelopeXdr,
          nonce: 'aa'.repeat(32), expiresAt: input.job.expiresAt };
        input.onBeforePublish?.(response);
        signed.current = response;
        setPhase('signature-delivered');
        await new Promise<void>((resolve, reject) => { acknowledge.current = fail => fail ? reject(new Error('Synthetic lost acknowledgement')) : resolve(); });
        return response;
      },
      sendSubmitted: async () => { setPhase('submitted'); },
      rejectForQuote: async () => { setRejects(value => value + 1); },
      waitUntilConnected: async () => ({ connected: 1, total: 1 }),
      connectionStatus: async () => ({ connected: 1, total: 1 }),
      close() {},
    } as unknown as PrivateRelayHelperSession);
    return () => { PrivateRelayHelperSession.create = original; };
  }, [context]);
  const runtime = useMemo(() => ({ ...initialPrivateBalanceRuntimeData, phase: 'current' as const, publicAddress: scope,
    deployment: { ...initialPrivateBalanceRuntimeData.deployment, networkId: context.request.networkId, poolContractId: 'synthetic' },
    derivePrivateRelayPayout: async () => 'synthetic-not-an-address',
    preparePrivateRelayJob: async () => ({ preparedEnvelopeXdr: context.job.unsignedEnvelopeXdr, accountSequence: '1', simulationLedger: 1 }),
    reviewPrivateRelayJob: async () => ({ transactionHash: context.job.transactionHash, method: 'transfer', classicFeeStroops: 100n,
      resourceFeeStroops: 100n, expiresAt: context.job.expiresAt } as PrivateRelayJobReview),
    signPrivateRelayJob: async () => { setSigns(value => value + 1); return new Promise<string>(resolve => { finishSigning.current = () => resolve('synthetic-signed'); }); },
    submitPrivateRelayJob: async () => { setSubmits(value => value + 1); await new Promise<void>((resolve, reject) => {
      finishSubmit.current = fail => fail ? reject(new Error('Synthetic uncertain submission')) : resolve();
    }); return { status: 'PENDING' as const, hash: context.job.transactionHash }; },
  }), [context, scope]);
  const deliverSubmit = (changed = false) => {
    if (signed.current) receive.current?.({ ...signed.current, type: 'submit-job',
      signedEnvelopeXdr: changed ? 'synthetic-replacement' : signed.current.signedEnvelopeXdr }, context.quote);
  };
  return <section aria-label="Synthetic helper checks">
    <Button onClick={() => { savePrivateRelayPreferences({ ...loadPrivateRelayPreferences(), helpRelay: true }); setEnabled(true); }}>Open synthetic helper</Button>
    <Button onClick={() => requestReceiver.current?.(context.request)}>Deliver helper request</Button>
    <Button onClick={() => receive.current?.({ ...context.job, type: 'selection', actionKind: 'transfer', assetIndex: 0, actionDiversifier: '01020304' }, context.quote)}>Deliver helper selection</Button>
    <Button onClick={() => receive.current?.({ ...context.job, type: 'prepare-job', prepareId: 'bb'.repeat(32), operationXdr: 'synthetic-operation', maxTime: context.job.expiresAt, classicFeeStroops: '100', maximumResourceFeeStroops: '100' }, context.quote)}>Deliver helper preparation</Button>
    <Button onClick={() => receive.current?.(context.job, context.quote)}>Deliver helper sign request</Button>
    <Button onClick={() => finishSigning.current?.()}>Finish synthetic signing</Button>
    <Button onClick={() => { deliverSubmit(); deliverSubmit(); }}>Deliver duplicate helper submits</Button>
    <Button onClick={() => deliverSubmit(true)}>Deliver changed helper submit</Button>
    <Button onClick={() => finishSubmit.current?.()}>Finish synthetic submission</Button>
    <Button onClick={() => finishSubmit.current?.(true)}>Fail synthetic submission</Button>
    <Button onClick={() => acknowledge.current?.()}>Acknowledge synthetic signature</Button>
    <Button onClick={() => acknowledge.current?.(true)}>Lose signature acknowledgement</Button>
    <Button onClick={() => setScope('replacement-helper')}>Replace synthetic helper account</Button>
    <p data-testid="helper-phase">{phase}</p><p data-testid="helper-signs">{signs}</p>
    <p data-testid="helper-submits">{submits}</p><p data-testid="helper-rejects">{rejects}</p>
    {enabled ? <PrivateBalanceRuntimeControlProvider scopeKey={scope}><PrivateBalanceRuntimeDataProvider value={runtime}>
      <PrivateRelayHelperManager />
    </PrivateBalanceRuntimeDataProvider></PrivateBalanceRuntimeControlProvider> : null}
  </section>;
}
