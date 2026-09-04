'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, HashValue, Modal, ModalHeader, Notice } from '@/components/ui';
import {
  usePrivateBalanceRuntime,
  usePrivateBalanceRuntimeData,
} from '@/hooks/usePrivateBalanceRuntime';
import { fmtAmount } from '@/lib/format';
import { formatPrivateBalanceAmount, formatPrivateBalanceXlm } from '../runtime/selectors';
import {
  loadPrivateRelayPreferences,
  PRIVATE_RELAY_PREFERENCES_EVENT,
  type PrivateRelayPreferences,
} from '../relay/preferences';
import type {
  PrivateRelayQuote,
  PrivateRelaySelection,
  PrivateRelaySignJob,
  PrivateRelaySignedJob,
  PrivateRelaySubmitJob,
} from '../relay/protocol';
import type { PrivateRelayJobReview } from '../relay/review';
import { PrivateRelayHelperSession } from '../relay/session';

const MAX_OPEN_QUOTES = 16;

interface RelayNegotiation {
  quote: PrivateRelayQuote;
  selection: PrivateRelaySelection;
}

interface PendingRelayApproval extends RelayNegotiation {
  job: PrivateRelaySignJob;
  review: PrivateRelayJobReview;
}

export function PrivateRelayHelperManager() {
  const runtime = usePrivateBalanceRuntimeData();
  const { availableAssets } = usePrivateBalanceRuntime();
  const [preferences, setPreferences] = useState<PrivateRelayPreferences>(loadPrivateRelayPreferences);
  const [pending, setPending] = useState<PendingRelayApproval | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<PrivateRelayHelperSession | null>(null);
  const pendingRef = useRef<PendingRelayApproval | null>(null);
  const negotiationsRef = useRef(new Map<string, RelayNegotiation>());
  const signedRef = useRef(new Map<string, PrivateRelaySignedJob>());

  useEffect(() => {
    const update = (event: Event) => {
      if (event instanceof CustomEvent && event.detail) {
        setPreferences(event.detail as PrivateRelayPreferences);
      } else {
        setPreferences(loadPrivateRelayPreferences());
      }
    };
    window.addEventListener(PRIVATE_RELAY_PREFERENCES_EVENT, update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener(PRIVATE_RELAY_PREFERENCES_EVENT, update);
      window.removeEventListener('storage', update);
    };
  }, []);

  useEffect(() => {
    if (
      !preferences.helpRelay ||
      runtime.phase !== 'current' ||
      !runtime.publicAddress ||
      !runtime.deployment.networkId ||
      !runtime.deployment.poolContractId
    ) return;
    let active = true;
    const controller = new AbortController();
    const negotiations = negotiationsRef.current;
    const signed = signedRef.current;
    const requestIds = new Set<string>();

    void PrivateRelayHelperSession.create(preferences.relayUrls).then(session => {
      if (!active) {
        session.close();
        return;
      }
      sessionRef.current = session;
      session.listenForRequests(request => {
        if (
          request.networkId !== runtime.deployment.networkId ||
          request.poolContractId !== runtime.deployment.poolContractId ||
          requestIds.has(request.requestId) ||
          requestIds.size >= MAX_OPEN_QUOTES
        ) return;
        requestIds.add(request.requestId);
        void session.offerQuote({
          request,
          peerAccount: runtime.publicAddress!,
          feeAtomic: preferences.feeAtomic,
        }, controller.signal).catch(() => {
          requestIds.delete(request.requestId);
        });
      }, controller.signal);
      session.listenForPrivateMessages((message, quote) => {
        if (message.type === 'selection') {
          if (negotiations.size >= MAX_OPEN_QUOTES || negotiations.has(message.quoteId)) return;
          void runtime.derivePrivateRelayPayout({
            assetIndex: message.assetIndex,
            actionDiversifier: message.actionDiversifier,
          }).then(privateFeeAddress => {
            if (!active) return;
            const negotiation = { quote, selection: message };
            negotiations.set(message.quoteId, negotiation);
            return session.sendPayout({
              selection: message,
              quote,
              privateFeeAddress,
            }, controller.signal);
          }).catch(() => {
            void session.rejectForQuote({
              requestId: message.requestId,
              quoteId: message.quoteId,
              reason: 'policy',
              expiresAt: message.expiresAt,
            }, controller.signal).catch(() => undefined);
          });
          return;
        }
        if (message.type === 'sign-job') {
          const negotiation = negotiations.get(message.quoteId);
          if (!negotiation) return;
          if (pendingRef.current) {
            void session.rejectForQuote({
              requestId: message.requestId,
              quoteId: message.quoteId,
              reason: 'busy',
              expiresAt: message.expiresAt,
            }, controller.signal).catch(() => undefined);
            return;
          }
          void runtime.reviewPrivateRelayJob({
            unsignedEnvelopeXdr: message.unsignedEnvelopeXdr,
            transactionHash: message.transactionHash,
            sourceAccount: quote.peerAccount,
            assetIndex: negotiation.selection.assetIndex,
            actionDiversifier: negotiation.selection.actionDiversifier,
            feeAtomic: quote.feeAtomic,
          }).then(review => {
            if (!active || pendingRef.current) return;
            const approval = { ...negotiation, job: message, review };
            pendingRef.current = approval;
            setPending(approval);
            setError(null);
          }).catch(() => {
            void session.rejectForQuote({
              requestId: message.requestId,
              quoteId: message.quoteId,
              reason: 'simulation',
              expiresAt: message.expiresAt,
            }, controller.signal).catch(() => undefined);
          });
          return;
        }
        const submittedJob = message as PrivateRelaySubmitJob;
        const accepted = signed.get(submittedJob.quoteId);
        if (
          !accepted ||
          accepted.transactionHash !== submittedJob.transactionHash ||
          accepted.signedEnvelopeXdr !== submittedJob.signedEnvelopeXdr
        ) {
          void session.rejectForQuote({
            requestId: submittedJob.requestId,
            quoteId: submittedJob.quoteId,
            reason: 'invalid',
            expiresAt: submittedJob.expiresAt,
          }, controller.signal).catch(() => undefined);
          return;
        }
        void runtime.submitPrivateRelayJob({
          signedEnvelopeXdr: submittedJob.signedEnvelopeXdr,
          transactionHash: submittedJob.transactionHash,
        }).then(response => session.sendSubmitted({
          job: submittedJob,
          quote,
          rpcStatus: response.status,
        }, controller.signal)).then(() => {
          signed.delete(submittedJob.quoteId);
          negotiations.delete(submittedJob.quoteId);
        }).catch(() => {
          void session.rejectForQuote({
            requestId: submittedJob.requestId,
            quoteId: submittedJob.quoteId,
            reason: 'submission',
            expiresAt: submittedJob.expiresAt,
          }, controller.signal).catch(() => undefined);
        });
      }, controller.signal);
    }).catch(() => undefined);

    return () => {
      active = false;
      controller.abort();
      sessionRef.current?.close();
      sessionRef.current = null;
      negotiations.clear();
      signed.clear();
      requestIds.clear();
      pendingRef.current = null;
      setPending(null);
      setWorking(false);
      setError(null);
    };
  }, [
    preferences.feeAtomic,
    preferences.helpRelay,
    preferences.relayUrls,
    runtime.deployment.networkId,
    runtime.deployment.poolContractId,
    runtime.derivePrivateRelayPayout,
    runtime.phase,
    runtime.publicAddress,
    runtime.reviewPrivateRelayJob,
    runtime.submitPrivateRelayJob,
  ]);

  const selectedAsset = useMemo(() => pending
    ? availableAssets.find(option => option.asset.index === pending.selection.assetIndex)?.asset ?? null
    : null, [availableAssets, pending]);
  const fee = pending && selectedAsset
    ? `${fmtAmount(formatPrivateBalanceAmount(BigInt(pending.quote.feeAtomic), selectedAsset.decimals))} ${selectedAsset.code}`
    : pending ? `${pending.quote.feeAtomic} atomic units` : '';
  const networkFee = pending
    ? fmtAmount(formatPrivateBalanceXlm(
        pending.review.classicFeeStroops + pending.review.resourceFeeStroops,
      ))
    : '';

  const clearPending = () => {
    pendingRef.current = null;
    setPending(null);
    setWorking(false);
    setError(null);
  };

  const reject = async () => {
    if (!pending || !sessionRef.current) return;
    setWorking(true);
    try {
      await sessionRef.current.rejectForQuote({
        requestId: pending.job.requestId,
        quoteId: pending.job.quoteId,
        reason: 'policy',
        expiresAt: pending.job.expiresAt,
      });
      negotiationsRef.current.delete(pending.job.quoteId);
      clearPending();
    } catch {
      clearPending();
    }
  };

  const approve = async () => {
    if (!pending || !sessionRef.current) return;
    setWorking(true);
    setError(null);
    try {
      const signedEnvelopeXdr = await runtime.signPrivateRelayJob(pending.review);
      const signed = await sessionRef.current.sendSigned({
        job: pending.job,
        quote: pending.quote,
        signedEnvelopeXdr,
      });
      signedRef.current.set(pending.job.quoteId, signed);
      clearPending();
    } catch {
      setError('This relay job was not signed. Reject it or try approval again before it expires.');
      setWorking(false);
    }
  };

  return pending ? (
    <Modal open onClose={() => void reject()} dismissable={!working}>
      <ModalHeader
        title="Relay Private Payment?"
        subtitle="A peer is asking this account to submit one transaction"
        onClose={working ? undefined : () => void reject()}
      />
      <div className="space-y-4 p-4 sm:p-6">
        <dl className="panel-inset divide-y divide-white/[0.08] px-4 text-[13px]">
          <div className="flex min-h-11 items-center justify-between gap-4 py-2.5">
            <dt className="text-neutral-400">Private reward</dt>
            <dd className="font-semibold text-[#30D158]">{fee}</dd>
          </div>
          <div className="flex min-h-11 items-center justify-between gap-4 py-2.5">
            <dt className="text-neutral-400">Your max network fee</dt>
            <dd className="font-semibold text-white">{networkFee} XLM</dd>
          </div>
          <div className="flex min-h-11 items-center justify-between gap-4 py-2.5">
            <dt className="text-neutral-400">Pool action</dt>
            <dd className="capitalize text-white">Private {pending.review.method}</dd>
          </div>
          <div className="flex min-h-11 items-center justify-between gap-4 py-2.5">
            <dt className="text-neutral-400">Transaction</dt>
            <dd><HashValue value={pending.review.transactionHash} className="text-[11px]" /></dd>
          </div>
        </dl>
        <Notice>
          The wallet parsed this exact transaction, confirmed it only invokes this private pool,
          decrypted exactly one fee note addressed to you, capped its fees, and simulated its proof.
          Helping never signs automatically.
        </Notice>
        {error ? <p role="alert" className="text-[12px] text-[#FF6961]">{error}</p> : null}
        <div className="grid grid-cols-2 gap-3">
          <Button type="button" variant="ghost" disabled={working} onClick={() => void reject()}>
            Reject
          </Button>
          <Button type="button" loading={working} disabled={working} onClick={() => void approve()}>
            Approve &amp; sign
          </Button>
        </div>
      </div>
    </Modal>
  ) : null;
}
