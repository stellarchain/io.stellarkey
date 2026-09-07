'use client';

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button, Notice } from '@/components/ui';
import { usePrivateBalanceRuntimeData } from '@/hooks/usePrivateBalanceRuntime';
import type { PreparedPrivateActionReview, PrivateActionProgressStage } from '../runtime/action-flow';
import { hasExposedPrivateSpend } from '../runtime/proof-exposure';
import { PrivateProofConsent, type PrivateProofDisclosure } from '../runtime/proof-disclosure';
import { formatPrivateBalanceAmount } from '../runtime/selectors';
import { privateAddressFingerprint } from '../runtime/receive';
import { progressLabel } from '../copy';
import { HumanizedErrorNotice } from './PrivateBalanceStatus';
import { PrivateActionReview } from './PrivateActionReview';
import { getSessionSnapshot, subscribeSessionChanges, subscribeSessionRevocation } from '@/lib/vault';

type Flow = { scope: string; heldActionField: string; stage: 'preparing' | 'consent' | 'review' | 'signing' | 'broadcast' | 'ambiguous' | 'error';
  progress?: PrivateActionProgressStage; disclosure?: Readonly<PrivateProofDisclosure>; review?: PreparedPrivateActionReview; error?: unknown };

export function PrivateHeldBalanceRecovery({ scanWorking, onActivityChange }: {
  scanWorking: boolean;
  onActivityChange(activity: { busy: boolean; signing: boolean }): void;
}) {
  const runtime = usePrivateBalanceRuntimeData();
  const { pendingActions, spendRecovery, asset, deployment, publicAddress, networkLabel, prepareSpendRecovery, submitAction } = runtime;
  const session = useSyncExternalStore(subscribeSessionChanges, getSessionSnapshot, () => null);
  const scope = `${publicAddress}:${networkLabel}:${deployment.networkId}:${deployment.realmId}:${deployment.poolContractId}:${deployment.manifestHash}:${asset?.contractId}:${session}`;
  const [flow, setFlow] = useState<Flow | null>(null);
  const active = flow?.scope === scope ? flow : null;
  const operation = useRef<AbortController | null>(null);
  const consent = useRef(new PrivateProofConsent());
  const revocation = useRef<(() => void) | null>(null);
  const sectionRef = useRef<HTMLElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const scopeRef = useRef<string | null>(scope);
  if (flow && flow.scope !== scope) setFlow(null);
  const target = pendingActions.length === 1 && hasExposedPrivateSpend(pendingActions[0]) ? pendingActions[0] : null;
  const busy = !!active && ['preparing', 'consent', 'signing'].includes(active.stage);
  const signing = active?.stage === 'signing';

  useLayoutEffect(() => {
    scopeRef.current = scope;
    const proofConsent = consent.current;
    return () => { scopeRef.current = null; operation.current?.abort(); proofConsent.cancel(); revocation.current?.(); revocation.current = null; };
  }, [scope]);
  useEffect(() => { onActivityChange({ busy, signing }); }, [busy, signing, onActivityChange]);

  const retainFocus = () => {
    const section = sectionRef.current;
    if (section?.contains(document.activeElement) && !section.closest('[inert]')) headingRef.current?.focus({ preventScroll: true });
  };
  const cancel = () => { retainFocus(); operation.current?.abort(); consent.current.cancel(); revocation.current?.(); revocation.current = null; setFlow(null); };
  const prepare = async () => {
    if (!target || busy || scanWorking) return;
    const controller = new AbortController();
    operation.current?.abort(); operation.current = controller;
    revocation.current?.();
    revocation.current = session === null ? null : subscribeSessionRevocation(() => {
      controller.abort(); consent.current.cancel(); setFlow(null);
    });
    const current = () => operation.current === controller && !controller.signal.aborted && scopeRef.current === scope;
    const update = (next: Omit<Flow, 'scope' | 'heldActionField'>, replacingPanel = true) => {
      if (replacingPanel) retainFocus();
      setFlow({ scope, heldActionField: target.actionField, ...next });
    };
    update({ stage: 'preparing' });
    try {
      const review = await prepareSpendRecovery(target.id, progress => {
        if (current()) update({ stage: 'preparing', progress }, false);
      }, controller.signal, async disclosure => {
        if (!current() || disclosure.recoveryOfActionId !== target.id) throw new DOMException('Private recovery cancelled.', 'AbortError');
        const waiting = consent.current.wait(disclosure.actionId, controller.signal);
        update({ stage: 'consent', disclosure });
        await waiting;
        if (current()) update({ stage: 'preparing' });
      });
      if (current()) update({ stage: 'review', review });
    } catch (error) {
      if (current()) update({ stage: 'error', error });
    }
  };
  const sign = async () => {
    if (active?.stage !== 'review' || !active.review || !pendingActions.some(action => action.id === active.review!.id)) return;
    const controller = operation.current;
    if (!controller || controller.signal.aborted) return;
    const review = active.review;
    const heldActionField = active.heldActionField;
    retainFocus();
    setFlow({ scope, heldActionField, stage: 'signing', review });
    try {
      const status = await submitAction(review);
      if (!controller.signal.aborted && operation.current === controller && scopeRef.current === scope) setFlow({ scope, heldActionField, stage: status });
    } catch (error) {
      if (!controller.signal.aborted && operation.current === controller && scopeRef.current === scope) setFlow({ scope, heldActionField, stage: 'error', error });
    }
  };

  const heldField = active?.heldActionField ?? target?.actionField;
  const relatedRecovery = !heldField || spendRecovery?.originalActionField === heldField || spendRecovery?.recoveryActionFields.includes(heldField);
  const outcome = relatedRecovery ? spendRecovery?.outcome : undefined;
  const confirmed = outcome && outcome !== 'pending';
  const disclosure = active?.disclosure ?? null;
  const review = active?.review ?? null;
  const shown = disclosure ?? review;
  const showReview = !confirmed && !!shown && (active?.stage === 'consent' || active?.stage === 'review' || signing);
  if (!target && !spendRecovery && !active) return null;
  return <section ref={sectionRef} aria-labelledby="held-private-recovery-title" className="space-y-3 border-t border-white/10 pt-4">
    <h3 ref={headingRef} tabIndex={-1} id="held-private-recovery-title" className="text-[15px] font-semibold text-white">Recover held balance</h3>
    <Notice tone="warn">
      The original payment can still confirm first. Recovery sends the same held inputs to a fresh private address owned by this wallet, with no private helper fee.
      Your public account pays the network fee, and direct submission exposes the recovery proof to your selected RPC. This changes the privacy exposure compared with a helper.
      Inputs stay held until a canonical ledger check resolves the outcome. Cancelling after proof sharing cannot revoke either proof.
    </Notice>
    <p role="status" className="text-[13px] text-neutral-300">
      {outcome === 'recovered' ? 'Recovery confirmed. The held value is back in your private balance.'
        : outcome === 'original-confirmed' ? 'The original payment confirmed first. Check private activity for the payment and any change.'
        : outcome === 'conflict-confirmed' ? 'A competing spend was confirmed. Check the verified private balance and activity; this recovery is no longer pending.'
        : active?.stage === 'broadcast' ? 'Recovery submitted; waiting for ledger confirmation.'
        : active?.stage === 'ambiguous' ? 'Recovery submission status is unknown. Inputs remain held until a ledger check resolves them.'
        : active?.stage === 'preparing' ? progressLabel(active.progress ?? 'checking-chain')
        : active?.stage === 'signing' ? 'Signing and submitting recovery…'
        : 'A shared proof can still spend these inputs. A history check alone cannot cancel it.'}
    </p>
    {active?.stage === 'error' ? <HumanizedErrorNotice cause={active.error} /> : null}
    {showReview && shown ? <PrivateActionReview
      draft={{ purpose: 'recovery', kind: 'transfer', amount: formatPrivateBalanceAmount(BigInt(shown.amountStroops), asset?.decimals ?? 7),
        recipientAddress: shown.recipientAddress, fingerprint: shown.recipientAddress ? privateAddressFingerprint(shown.recipientAddress) : null }}
      review={review} disclosure={disclosure} chained={null} chainProgress={null} progress={null} preparing={false} working={signing}
      error={null} errorCause={null} balanceBeforeStroops={BigInt(runtime.verifiedBalanceStroops)} confirmLabel="Sign Recovery"
      onConfirm={() => { if (disclosure) consent.current.approve(disclosure.actionId); else void sign(); }} onBack={cancel} /> : null}
    {!showReview && target ? <Button className="w-full" type="button" disabled={busy || scanWorking || !runtime.isLeader || runtime.phase !== 'current'}
      onClick={() => void prepare()}>Prepare Balance Recovery</Button> : null}
    {active?.stage === 'preparing' ? <Button type="button" variant="secondary" onClick={cancel}>Cancel Preparation</Button> : null}
  </section>;
}
