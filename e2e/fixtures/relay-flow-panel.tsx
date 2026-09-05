'use client';

// Synthetic session boundary; the real controller and review UI run unchanged.
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import { initialPrivateBalanceRuntimeData, PrivateBalanceRuntimeDataProvider, usePrivateBalanceRuntimeData } from '@/hooks/usePrivateBalanceRuntime';
import { PrivateActionReview } from '@/features/private-balance/components/PrivateActionReview';
import { usePrivateActionController } from '@/features/private-balance/components/usePrivateActionController';
import { PrivateRelaySenderSession } from '@/features/private-balance/relay/session';
import type { PrivateRelayPayout, PrivateRelayQuote, PrivateRelayRequest } from '@/features/private-balance/relay/protocol';
import type { PrivateRelayChainApproval } from '@/features/private-balance/runtime/relay-chain-policy';
import { encodePrivateAddress } from '@stellarkey/private-balance';
import { boundedPrivateRelayWebSocket } from '@/features/private-balance/relay/nostr';

const draft = { kind: 'withdraw' as const, amount: '1', publicRecipient: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF' };
const request: PrivateRelayRequest = { version: 2, type: 'request', requestId: '11'.repeat(32), networkId: '22'.repeat(32), poolContractId: 'synthetic', replyPubkey: '33'.repeat(32), nonce: '44'.repeat(32), expiresAt: 4_000_000_000 };
const offer: PrivateRelayQuote = { version: 2, type: 'quote', requestId: request.requestId, quoteId: '55'.repeat(32), peerPubkey: '66'.repeat(32), peerAccount: draft.publicRecipient, feeAtomic: '100', accountSignature: 'synthetic', nonce: '77'.repeat(32), expiresAt: request.expiresAt };
const cheaperOffer = { ...offer, quoteId: '88'.repeat(32), peerAccount: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', feeAtomic: '50' };
const syntheticAddress = encodePrivateAddress({ deploymentTag: new Uint8Array(16).fill(1), diversifier: Uint8Array.of(1, 2, 3, 4), ownerCommitment: new Uint8Array(32).fill(1), hpkePublicKey: new Uint8Array(32).fill(2) }, 'tskpay_');
const defaultAddress = encodePrivateAddress({ deploymentTag: new Uint8Array(16).fill(1), diversifier: new Uint8Array(4), ownerCommitment: new Uint8Array(32).fill(1), hpkePublicKey: new Uint8Array(32).fill(2) }, 'tskpay_');
const chainDraft = { kind: 'transfer' as const, amount: '1', recipientAddress: syntheticAddress };
const chainApproval: PrivateRelayChainApproval = {
  id: 'synthetic-chain', submissionMode: 'relay', contextKey: 'synthetic', assetContractId: 'synthetic', assetIndex: 0,
  draft: chainDraft, steps: 2, perStepMaxFeeStroops: '1000', cumulativeMaxFeeStroops: '2000', expiresAtSeconds: 4_000_000_000,
  plan: { amountAtomic: '10000000', perStepMaxPrivateFeeAtomic: '100', cumulativeMaxPrivateFeeAtomic: '200', steps: 2, inputNotes: [], merges: [], finalInputs: [] },
};

function Panel({ onSwitchAccount }: { onSwitchAccount(): void }) {
  const flow = usePrivateActionController(() => {});
  const emit = useRef<((mode?: 'cheaper' | 'replace' | 'remove-first') => void) | null>(null);
  const oldEmit = useRef<typeof emit.current>(null);
  const delayCreation = useRef(false);
  const finishCreation = useRef<(() => void) | null>(null);
  const [requests, setRequests] = useState(0);
  const [creations, setCreations] = useState(0);
  const [chainMode, setChainMode] = useState(false);
  const finishPayout = useRef<(() => void) | null>(null);
  const [selections, setSelections] = useState(0);
  const [closedAtSelection, setClosedAtSelection] = useState(false);
  const [collectionStopped, setCollectionStopped] = useState(false);
  const [closed, setClosed] = useState(false);
  const socket = useRef<WebSocket | null>(null);
  const [socketStatus, setSocketStatus] = useState('idle');
  useEffect(() => () => socket.current?.close(), []);
  useEffect(() => {
    const create = PrivateRelaySenderSession.create;
    PrivateRelaySenderSession.create = async () => {
      setCreations(value => value + 1);
      let sessionClosed = false;
      setClosed(false); setCollectionStopped(false);
      if (delayCreation.current) await new Promise<void>(resolve => { finishCreation.current = resolve; });
      return {
        requestQuotes: (input: Parameters<PrivateRelaySenderSession['requestQuotes']>[0], signal: AbortSignal) => new Promise((_resolve, reject) => {
          setRequests(value => value + 1);
          oldEmit.current = emit.current;
          // Deliberately permit late callbacks so controller guards are exercised.
          emit.current = mode => input.onQuotes?.(mode === 'remove-first' ? [{ ...cheaperOffer }]
            : mode === 'replace' ? [{ ...cheaperOffer }, { ...offer, quoteId: '99'.repeat(32), feeAtomic: '80' }]
            : mode === 'cheaper' ? [{ ...cheaperOffer }, { ...offer }] : [{ ...offer }], { ...request });
          signal.addEventListener('abort', () => { setCollectionStopped(true); reject(new DOMException('Synthetic cancellation', 'AbortError')); }, { once: true });
        }),
        selectQuote: async (input: Parameters<PrivateRelaySenderSession['selectQuote']>[0]) => {
          setClosedAtSelection(sessionClosed);
          setSelections(value => value + 1);
          return new Promise<PrivateRelayPayout>(resolve => {
            finishPayout.current = () => resolve({ version: 2, type: 'payout', requestId: input.request.requestId,
              quoteId: input.quote.quoteId, peerAccount: input.quote.peerAccount, feeAtomic: input.quote.feeAtomic,
              privateFeeAddress: syntheticAddress, nonce: 'aa'.repeat(32), expiresAt: request.expiresAt });
          });
        },
        close: () => { sessionClosed = true; setClosed(true); },
      } as unknown as PrivateRelaySenderSession;
    };
    return () => { PrivateRelaySenderSession.create = create; };
  }, []);
  return <>
    <Button onClick={() => void flow.prepare({ ...chainDraft, recipientAddress: defaultAddress }, 'relay')}>Try default synthetic recipient</Button>
    <Button onClick={() => void flow.prepare(chainDraft, 'relay')}>Use fresh synthetic recipient</Button>
    <Button onClick={() => void flow.prepare(draft, 'relay')}>Find synthetic helpers</Button>
    <Button variant="secondary" onClick={() => {
      socket.current?.close();
      const Socket = boundedPrivateRelayWebSocket(WebSocket, 50);
      const connection = new Socket(`${location.origin.replace(/^http/, 'ws')}/synthetic-nostr`);
      socket.current = connection;
      connection.onopen = () => { setSocketStatus('open'); connection.send('synthetic-ping'); };
      connection.onmessage = event => setSocketStatus(event.data === 'synthetic-after-deadline' ? 'after deadline' : 'exchanged');
    }}>Open synthetic native socket</Button>
    <Button variant="secondary" onClick={() => { socket.current?.close(); setSocketStatus('closed'); }}>Close synthetic native socket</Button>
    <p data-testid="relay-native-socket">{socketStatus}</p>
    <Button onClick={() => { setChainMode(true); void flow.prepare(chainDraft, 'relay'); }}>Prepare synthetic relay chain</Button>
    <Button onClick={() => void flow.submit()}>Start approved synthetic chain</Button>
    <Button variant="secondary" onClick={() => { const id = flow.relayQuotes[0]?.quoteId; if (id) { void flow.selectRelayQuote(id); void flow.selectRelayQuote(id); } }}>Double choose first synthetic peer</Button>
    <Button variant="secondary" onClick={() => finishPayout.current?.()}>Finish synthetic payout</Button>
    <Button variant="secondary" onClick={() => { delayCreation.current = true; }}>Delay synthetic session creation</Button>
    <Button variant="secondary" onClick={() => finishCreation.current?.()}>Finish synthetic session creation</Button>
    <Button variant="secondary" onClick={onSwitchAccount}>Switch synthetic relay account</Button>
    <Button variant="secondary" onClick={() => emit.current?.()}>Deliver synthetic offer</Button>
    <Button variant="secondary" onClick={() => emit.current?.('cheaper')}>Deliver cheaper synthetic offer</Button>
    <Button variant="secondary" onClick={() => emit.current?.('replace')}>Replace first synthetic quote</Button>
    <Button variant="secondary" onClick={() => emit.current?.('remove-first')}>Expire first synthetic offer</Button>
    <Button variant="secondary" onClick={() => oldEmit.current?.()}>Deliver stale synthetic offer</Button>
    <Button variant="secondary" onClick={() => void flow.cancelPrepared()}>Cancel synthetic discovery</Button>
    <p data-testid="relay-selections">{selections}</p>
    <p data-testid="relay-requests">{requests}</p>
    <p data-testid="relay-creations">{creations}</p>
    <p data-testid="relay-error">{flow.error ?? 'none'}</p>
    <p data-testid="relay-closed-at-selection">{String(closedAtSelection)}</p>
    <p data-testid="relay-collection-stopped">{String(collectionStopped)}</p>
    <p data-testid="relay-session-closed">{String(closed)}</p>
    <PrivateActionReview draft={chainMode ? chainDraft : draft} {...flow} balanceBeforeStroops={20_000_000n} confirmLabel="Withdraw privately"
      onConfirm={() => void flow.submit()} onBack={() => void flow.cancelPrepared()} onSelectRelayQuote={flow.selectRelayQuote} />
  </>;
}

export function RelayFlowPanel() {
  const runtime = usePrivateBalanceRuntimeData();
  const [account, setAccount] = useState<string | null>(null);
  const advance = useRef<(() => void) | null>(null);
  return <PrivateBalanceRuntimeDataProvider value={{ ...runtime, publicAddress: account, networkLabel: 'Testnet',
    prepareRelayChainedSend: async () => chainApproval,
    submitRelayChainedSend: async (_approval, selectPeer, signal, progress) => {
      for (let step = 1; step <= 2; step += 1) {
        progress?.({ step, totalSteps: 2, stage: 'choosing-peer' });
        const peer = await selectPeer({ step, totalSteps: 2, recipientAddress: syntheticAddress, maximumPrivateFeeAtomic: '100' }, signal);
        try {
          progress?.({ step, totalSteps: 2, stage: 'confirming' });
          await new Promise<void>((resolve, reject) => {
            const abort = () => reject(new DOMException('Synthetic chain cancelled', 'AbortError'));
            advance.current = () => { signal.removeEventListener('abort', abort); resolve(); };
            signal.addEventListener('abort', abort, { once: true });
          });
        } finally { peer.close(); }
      }
      return { status: 'broadcast' };
    }, deployment: {
    ...initialPrivateBalanceRuntimeData.deployment, networkId: request.networkId, poolContractId: request.poolContractId,
  } }}><Panel onSwitchAccount={() => setAccount(cheaperOffer.peerAccount)} />
    <Button variant="secondary" onClick={() => advance.current?.()}>Advance synthetic chain step</Button>
  </PrivateBalanceRuntimeDataProvider>;
}
