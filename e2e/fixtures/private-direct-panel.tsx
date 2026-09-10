'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { encodePrivateAddress } from '@stellarkey/private-balance';
import { Button } from '@/components/ui';
import { SendPrivate } from '@/features/private-balance/components/SendPrivate';
import { WithdrawPrivate } from '@/features/private-balance/components/WithdrawPrivate';
import { PrivateActionInFlightError, PrivateConsolidationRequiredError, type PreparedPrivateActionReview, type PrivateActionDraft } from '@/features/private-balance/runtime/action-flow';
import { disclosePrivateProof } from '@/features/private-balance/runtime/proof-disclosure';
import { parsePrivateAmount } from '@/features/private-balance/runtime/coin-selection';
import { PrivateBalanceRuntimeControlProvider, PrivateBalanceRuntimeDataProvider, usePrivateBalanceRuntime, usePrivateBalanceRuntimeData } from '@/hooks/usePrivateBalanceRuntime';

const defaultAddress = encodePrivateAddress({ deploymentTag: new Uint8Array(16).fill(1), diversifier: new Uint8Array(4),
  ownerCommitment: new Uint8Array(32).fill(1), hpkePublicKey: new Uint8Array(32).fill(2) }, 'tskpay_');

function syntheticReview(draft: PrivateActionDraft, id: string): PreparedPrivateActionReview {
  if (draft.kind === 'consolidate') throw new Error('Use the synthetic chained send.');
  const amountStroops = parsePrivateAmount(draft.amount, 7).toString();
  return {
    id, kind: draft.kind, actionField: '55'.repeat(32), assetContractId: 'synthetic',
    rpcUrl: 'https://synthetic.invalid', amountStroops, inputValueStroops: amountStroops,
    changeValueStroops: '0', recipientAddress: draft.kind === 'transfer' ? draft.recipientAddress : null,
    recipientFingerprint: draft.kind === 'transfer' ? 'synthetic-check-code' : null,
    publicRecipient: draft.kind === 'withdraw' ? draft.publicRecipient : null,
    memoHex: draft.kind === 'transfer' && draft.memo ? Array.from(new TextEncoder().encode(draft.memo), byte => byte.toString(16).padStart(2, '0')).join('') : null,
    anchorExpiresAtLedger: 1000, latestLedger: 1,
    transaction: { envelopeXdr: 'synthetic-non-usable-envelope', transactionHash: '66'.repeat(32), method: draft.kind,
      refreshesAnchor: false, classicFeeStroops: 100n, resourceFeeStroops: 900n, expiresAt: 4_000_000_000 },
  };
}

function DirectPrivateAssetRegistration() {
  const { asset } = usePrivateBalanceRuntimeData();
  const { registerAvailableAssets } = usePrivateBalanceRuntime();
  useEffect(() => {
    if (asset) registerAvailableAssets([{ deploymentId: 'synthetic-direct', asset, encryptedStateExists: false }], 'synthetic-direct');
  }, [asset, registerAvailableAssets]);
  return null;
}

/** Real direct forms/controller, with only the runtime boundary replaced by non-usable responses. */
export function DirectPrivateFixture() {
  const parent = usePrivateBalanceRuntimeData();
  const [open, setOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [calls, setCalls] = useState(0);
  const [delay, setDelay] = useState(false);
  const [holdDisclosedPreparation, setHoldDisclosedPreparation] = useState(false);
  const [scenario, setScenario] = useState<'blocked' | 'direct' | 'deferred' | 'chain'>('blocked');
  const [account, setAccount] = useState(false);
  const [cancellations, setCancellations] = useState(0);
  const [submissionAttempts, setSubmissionAttempts] = useState(0);
  const [busyRejections, setBusyRejections] = useState(0);
  const [submissions, setSubmissions] = useState(0);
  const [sameTickConfirmations, setSameTickConfirmations] = useState(0);
  const [outcomes, setOutcomes] = useState(0);
  const [events, setEvents] = useState<string[]>([]);
  const finishes = useRef<Array<() => void>>([]);
  const preparations = useRef<Array<() => void>>([]);
  const submissionFinishes = useRef<Array<(status: 'broadcast' | 'ambiguous') => void>>([]);
  const chainSteps = useRef<Array<() => void>>([]);
  const submissionBusy = useRef(false);
  const sequence = useRef(0);
  const runtime = useMemo(() => ({ ...parent, networkLabel: 'Testnet' as const, verifiedBalanceStroops: '100000000',
    publicAddress: account ? `G${'B'.repeat(55)}` : 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    validateRecipient: async () => {
      if (delay) await new Promise<void>(resolve => { finishes.current.push(resolve); });
      return { fingerprint: 'synthetic-check-code' };
    },
    prepareAction: (async (draft, onProgress, signal, authorizeDisclosure) => {
      setCalls(value => value + 1);
      if (scenario === 'blocked') throw new PrivateActionInFlightError();
      if (scenario === 'chain') throw new PrivateConsolidationRequiredError(1, 3);
      const review = syntheticReview(draft, `synthetic-direct-${++sequence.current}`);
      onProgress?.('checking-chain');
      if (scenario === 'deferred') {
        // Deliberately late completion tests the controller's publication ownership.
        await new Promise<void>(resolve => { preparations.current.push(resolve); });
        return review;
      }
      await disclosePrivateProof({
        request: { kind: review.kind, actionId: review.id, actionField: review.actionField,
          assetContractId: 'synthetic', amountStroops: review.amountStroops, recipientAddress: review.recipientAddress,
          publicRecipient: review.publicRecipient, memoHex: review.memoHex, privateFeeAtomic: '0',
          maximumNetworkFeeStroops: '1000', submissionMode: 'direct' },
        signal, authorize: authorizeDisclosure,
        commit: async () => { setEvents(current => [...current, 'reserved']); },
        disclose: async () => { setEvents(current => [...current, 'shared']); },
      });
      if (holdDisclosedPreparation) {
        await new Promise<void>(resolve => { preparations.current.push(resolve); });
      }
      return review;
    }) satisfies typeof parent.prepareAction,
    cancelAction: async () => { setCancellations(value => value + 1); },
    submitAction: async () => {
      setSubmissionAttempts(value => value + 1);
      if (submissionBusy.current) {
        setBusyRejections(value => value + 1);
        throw new Error('Another Private Balance action is already running.');
      }
      submissionBusy.current = true;
      setSubmissions(value => value + 1);
      try {
        return await new Promise<'broadcast' | 'ambiguous'>(resolve => { submissionFinishes.current.push(resolve); });
      } finally { submissionBusy.current = false; }
    },
    prepareChainedSend: async () => ({ id: 'synthetic-direct-chain', steps: 2, perStepMaxFeeStroops: '1000',
      cumulativeMaxFeeStroops: '2000', expiresAtSeconds: 4_000_000_000 }),
    submitChainedSend: (async (_approval, _draft, onProgress) => {
      setSubmissionAttempts(value => value + 1);
      if (submissionBusy.current) {
        setBusyRejections(value => value + 1);
        throw new Error('Another Private Balance action is already open.');
      }
      submissionBusy.current = true;
      setSubmissions(value => value + 1);
      try {
        onProgress?.({ step: 1, totalSteps: 2, stage: 'confirming' });
        await new Promise<void>(resolve => { chainSteps.current.push(resolve); });
        onProgress?.({ step: 2, totalSteps: 2, stage: 'confirming' });
        await new Promise<void>(resolve => { chainSteps.current.push(resolve); });
        return { status: 'broadcast' as const, finalTransactionHash: '77'.repeat(32) };
      } finally { submissionBusy.current = false; }
    }) satisfies typeof parent.submitChainedSend,
  }), [parent, delay, holdDisclosedPreparation, scenario, account]);
  return <section aria-label="Synthetic recipient checks">
    <Button onClick={() => setOpen(true)}>Open synthetic private send</Button>
    <Button onClick={() => setWithdrawOpen(true)}>Open synthetic private withdrawal</Button>
    <Button onClick={() => setDelay(true)}>Delay recipient validation</Button>
    <Button onClick={() => finishes.current.shift()?.()}>Finish recipient validation</Button>
    <Button onClick={() => finishes.current.pop()?.()}>Finish newest recipient validation</Button>
    <Button onClick={() => setDelay(false)}>Resume recipient validation</Button>
    <Button onClick={() => setScenario('direct')}>Use direct preparation</Button>
    <Button onClick={() => setHoldDisclosedPreparation(true)}>Hold disclosed direct preparation</Button>
    <Button onClick={() => setScenario('deferred')}>Delay direct preparation</Button>
    <Button onClick={() => setScenario('chain')}>Use direct chained preparation</Button>
    <Button onClick={() => {
      // Nest both real-button events in one React event, before busy state commits.
      const confirm = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'))
        .find(button => ['Confirm Send', 'Confirm'].includes(button.textContent?.trim() ?? ''));
      if (!confirm) throw new Error('The synthetic confirmation is not ready.');
      let clicks = 0;
      const count = () => { clicks++; };
      confirm.addEventListener('click', count);
      try { confirm.click(); confirm.click(); }
      finally { confirm.removeEventListener('click', count); }
      setSameTickConfirmations(clicks);
    }}>Double activate private confirmation</Button>
    <Button onClick={() => preparations.current.shift()?.()}>Finish oldest direct preparation</Button>
    <Button onClick={() => preparations.current.pop()?.()}>Finish newest direct preparation</Button>
    <Button onClick={() => submissionFinishes.current.shift()?.('broadcast')}>Finish direct submission</Button>
    <Button onClick={() => submissionFinishes.current.shift()?.('ambiguous')}>Return unknown direct status</Button>
    <Button onClick={() => chainSteps.current.shift()?.()}>Advance direct chain</Button>
    <Button onClick={() => setAccount(value => !value)}>Replace direct account</Button>
    <p data-testid="recipient-preparations">{calls}</p>
    <p data-testid="direct-cancellations">{cancellations}</p>
    <p data-testid="direct-submission-attempts">{submissionAttempts}</p>
    <p data-testid="direct-busy-rejections">{busyRejections}</p>
    <p data-testid="direct-submissions">{submissions}</p>
    <p data-testid="direct-same-tick-confirmations">{sameTickConfirmations}</p>
    <p data-testid="direct-outcomes">{outcomes}</p>
    <p data-testid="direct-proof-events">{events.join(',') || 'none'}</p>
    <PrivateBalanceRuntimeControlProvider scopeKey="synthetic-direct">
      <PrivateBalanceRuntimeDataProvider value={runtime}>
        <DirectPrivateAssetRegistration />
        <SendPrivate open={open} prefill={{ recipient: defaultAddress }} onClose={() => setOpen(false)} onSubmitted={() => setOutcomes(value => value + 1)} />
        <WithdrawPrivate open={withdrawOpen} onClose={() => setWithdrawOpen(false)} onSubmitted={() => setOutcomes(value => value + 1)} />
      </PrivateBalanceRuntimeDataProvider>
    </PrivateBalanceRuntimeControlProvider>
  </section>;
}
