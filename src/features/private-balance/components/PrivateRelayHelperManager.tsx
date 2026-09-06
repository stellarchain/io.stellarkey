'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, HashValue, Modal, ModalHeader, Notice } from '@/components/ui';
import {
  usePrivateBalanceRuntime,
  usePrivateBalanceRuntimeData,
} from '@/hooks/usePrivateBalanceRuntime';
import { fmtAmount } from '@/lib/format';
import { signOptedInPrivateRelayQuote } from '@/lib/private-relay-quote-signing';
import { formatPrivateBalanceAmount, formatPrivateBalanceXlm } from '../runtime/selectors';
import {
  loadPrivateRelayPreferences,
  PRIVATE_RELAY_PREFERENCES_EVENT,
  PRIVATE_RELAY_PREFERENCES_STORAGE_KEY,
  retainPrivateRelayHelperPreferences,
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
import { PrivateRelayPreparationLease, PrivateRelayQuoteExpiries, releasePrivateRelayHelperQuote } from '../relay/preparation';
import {
  publishPrivateRelayHelperStatus,
  resetPrivateRelayHelperStatus,
  retryPrivateRelayHelperReadiness,
} from '../relay/helper-status';
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
  const {
    deployment: { networkId, poolContractId },
    derivePrivateRelayPayout,
    phase,
    publicAddress,
    preparePrivateRelayJob,
    reviewPrivateRelayJob,
    signPrivateRelayJob,
    submitPrivateRelayJob,
  } = usePrivateBalanceRuntimeData();
  const { availableAssets } = usePrivateBalanceRuntime();
  const [preferences, setPreferences] = useState<PrivateRelayPreferences>(loadPrivateRelayPreferences);
  const [pending, setPending] = useState<PendingRelayApproval | null>(null);
  const [working, setWorking] = useState(false);
  const [signatureShared, setSignatureShared] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<PrivateRelayHelperSession | null>(null);
  const pendingRef = useRef<PendingRelayApproval | null>(null);
  const decisionRef = useRef<PendingRelayApproval | null>(null);
  const approvalDetailsRef = useRef<HTMLDivElement | null>(null);
  const negotiationsRef = useRef(new Map<string, RelayNegotiation>());
  const signedRef = useRef(new Map<string, PrivateRelaySignedJob>());
  const submissionAttemptsRef = useRef(new Set<string>());
  const preparationLeaseRef = useRef(new PrivateRelayPreparationLease());
  const quoteExpiriesRef = useRef(new PrivateRelayQuoteExpiries());
  const reviewingRef = useRef<{ quoteId: string } | null>(null);
  const forgetNegotiation = useCallback((quoteId: string) => {
    quoteExpiriesRef.current.forget(quoteId);
    submissionAttemptsRef.current.delete(quoteId);
    if (reviewingRef.current?.quoteId === quoteId) reviewingRef.current = null;
    if (decisionRef.current?.quote.quoteId === quoteId) decisionRef.current = null;
    releasePrivateRelayHelperQuote(quoteId, {
      negotiations: negotiationsRef.current, signed: signedRef.current,
      preparationLease: preparationLeaseRef.current, pending: pendingRef,
      onPendingReleased: released => {
        setPending(current => current === released ? null : current);
        setWorking(false);
        setSignatureShared(false);
        setError(null);
      },
    });
  }, []);

  useEffect(() => {
    const update = (event: Event) => {
      if (event instanceof StorageEvent && event.key !== null &&
          event.key !== PRIVATE_RELAY_PREFERENCES_STORAGE_KEY) return;
      const next = loadPrivateRelayPreferences();
      setPreferences(current => retainPrivateRelayHelperPreferences(current, next));
    };
    window.addEventListener(PRIVATE_RELAY_PREFERENCES_EVENT, update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener(PRIVATE_RELAY_PREFERENCES_EVENT, update);
      window.removeEventListener('storage', update);
    };
  }, []);

  useEffect(() => {
    if (!preferences.helpRelay) {
      resetPrivateRelayHelperStatus();
      return;
    }
    const totalRelays = preferences.relayUrls.length;
    if (phase !== 'current' || !publicAddress || !networkId || !poolContractId) {
      publishPrivateRelayHelperStatus({
        phase: 'waiting',
        connectedRelays: 0,
        totalRelays,
      });
      return;
    }
    let active = true;
    let statusTimer: ReturnType<typeof setInterval> | null = null;
    let visibilityChange: (() => void) | null = null;
    const controller = new AbortController();
    const negotiations = negotiationsRef.current;
    const signed = signedRef.current;
    const preparationLease = preparationLeaseRef.current;
    const quoteExpiries = quoteExpiriesRef.current;
    const selectingQuotes = new Set<string>();
    const submissionAttempts = submissionAttemptsRef.current;
    const requestIds = new Set<string>();
    const requestExpiryTimers = new Map<string, ReturnType<typeof setTimeout>>();
    publishPrivateRelayHelperStatus({
      phase: 'connecting',
      connectedRelays: 0,
      totalRelays,
    });

    void PrivateRelayHelperSession.create(preferences.relayUrls).then(session => {
      if (!active) {
        session.close();
        return;
      }
      sessionRef.current = session;
      session.listenForRequests(request => {
        if (
          request.networkId !== networkId ||
          request.poolContractId !== poolContractId ||
          requestIds.has(request.requestId) ||
          requestIds.size >= MAX_OPEN_QUOTES
        ) return;
        requestIds.add(request.requestId);
        let offeredQuoteId: string | null = null;
        const forgetRequest = () => {
          requestIds.delete(request.requestId);
          const timer = requestExpiryTimers.get(request.requestId);
          if (timer) clearTimeout(timer);
          requestExpiryTimers.delete(request.requestId);
          if (offeredQuoteId) forgetNegotiation(offeredQuoteId);
          for (const [quoteId, negotiation] of negotiations) {
            if (negotiation.quote.requestId !== request.requestId) continue;
            forgetNegotiation(quoteId);
          }
        };
        requestExpiryTimers.set(
          request.requestId,
          setTimeout(forgetRequest, Math.max(0, request.expiresAt * 1_000 - Date.now())),
        );
        void session.offerQuote({
          request,
          peerAccount: publicAddress,
          feeAtomic: preferences.feeAtomic,
          signAccountQuote: (request, quote) => {
            offeredQuoteId = quote.quoteId;
            quoteExpiries.watch(quote, () => { if (active) forgetRequest(); });
            return signOptedInPrivateRelayQuote({
              request, quote, expectedAccount: publicAddress, expectedNetworkId: networkId,
              expectedPoolContractId: poolContractId, signal: controller.signal,
            });
          },
        }, controller.signal).catch(forgetRequest);
      }, controller.signal);
      session.listenForPrivateMessages((message, quote) => {
        if (!active || controller.signal.aborted) return;
        if (message.type === 'selection') {
          if (negotiations.size + selectingQuotes.size >= MAX_OPEN_QUOTES || negotiations.has(message.quoteId) || selectingQuotes.has(message.quoteId)) return;
          selectingQuotes.add(message.quoteId);
          void derivePrivateRelayPayout({
            assetIndex: message.assetIndex,
            actionDiversifier: message.actionDiversifier,
          }).then(privateFeeAddress => {
            if (!active || !requestIds.has(message.requestId) || quote.expiresAt * 1_000 <= Date.now()) return;
            const negotiation = { quote, selection: message };
            negotiations.set(message.quoteId, negotiation);
            return session.sendPayout({
              selection: message,
              quote,
              privateFeeAddress,
            }, controller.signal);
          }).catch(() => {
            forgetNegotiation(message.quoteId);
            void session.rejectForQuote({
              requestId: message.requestId,
              quoteId: message.quoteId,
              reason: 'policy',
              expiresAt: message.expiresAt,
            }, controller.signal).catch(() => undefined);
          }).finally(() => { selectingQuotes.delete(message.quoteId); });
          return;
        }
        if (message.type === 'prepare-job') {
          const negotiation = negotiations.get(message.quoteId);
          if (!negotiation) return;
          const preparationToken = pendingRef.current || reviewingRef.current || signed.size > 0 ? null : preparationLease.begin(message.quoteId);
          if (!preparationToken) {
            void session.rejectForQuote({ ...message, reason: 'busy' }, controller.signal).catch(() => undefined);
            return;
          }
          void preparePrivateRelayJob({
            job: message, sourceAccount: quote.peerAccount,
            assetIndex: negotiation.selection.assetIndex, actionDiversifier: negotiation.selection.actionDiversifier,
            feeAtomic: quote.feeAtomic, expectedMethod: negotiation.selection.actionKind, quoteExpiresAt: quote.expiresAt,
          }, controller.signal).then(prepared => {
            if (!active || controller.signal.aborted || quote.expiresAt * 1_000 <= Date.now() ||
              negotiations.get(message.quoteId) !== negotiation) {
              preparationLease.cancel(preparationToken);
              return;
            }
            if (!preparationLease.complete(preparationToken, prepared)) return;
            return session.sendPrepared({ job: message, ...prepared }, controller.signal);
          }).catch(() => {
            preparationLease.cancel(preparationToken);
            void session.rejectForQuote({ ...message, reason: 'simulation' }, controller.signal).catch(() => undefined);
          });
          return;
        }
        if (message.type === 'sign-job') {
          const negotiation = negotiations.get(message.quoteId);
          if (!negotiation) return;
          const prepared = preparationLease.get(message.quoteId);
          if (!prepared || prepared.preparedEnvelopeXdr !== message.unsignedEnvelopeXdr) {
            void session.rejectForQuote({ ...message, reason: 'invalid' }, controller.signal).catch(() => undefined);
            return;
          }
          if (pendingRef.current || reviewingRef.current || signed.size > 0) {
            void session.rejectForQuote({
              requestId: message.requestId,
              quoteId: message.quoteId,
              reason: 'busy',
              expiresAt: message.expiresAt,
            }, controller.signal).catch(() => undefined);
            return;
          }
          const reviewToken = { quoteId: message.quoteId };
          reviewingRef.current = reviewToken;
          void reviewPrivateRelayJob({
            unsignedEnvelopeXdr: message.unsignedEnvelopeXdr,
            transactionHash: message.transactionHash,
            sourceAccount: quote.peerAccount,
            assetIndex: negotiation.selection.assetIndex,
            actionDiversifier: negotiation.selection.actionDiversifier,
            feeAtomic: quote.feeAtomic,
          }).then(review => {
            if (!active || reviewingRef.current !== reviewToken || pendingRef.current || quote.expiresAt * 1_000 <= Date.now() ||
              negotiations.get(message.quoteId) !== negotiation || preparationLease.get(message.quoteId) !== prepared) return;
            const approval = { ...negotiation, job: message, review };
            pendingRef.current = approval;
            setPending(approval);
            setSignatureShared(false);
            setError(null);
          }).catch(() => {
            if (negotiations.get(message.quoteId) === negotiation) forgetNegotiation(message.quoteId);
            void session.rejectForQuote({
              requestId: message.requestId,
              quoteId: message.quoteId,
              reason: 'simulation',
              expiresAt: message.expiresAt,
            }, controller.signal).catch(() => undefined);
          }).finally(() => {
            if (reviewingRef.current === reviewToken) reviewingRef.current = null;
          });
          return;
        }
        const submittedJob = message as PrivateRelaySubmitJob;
        const accepted = signed.get(submittedJob.quoteId);
        if (
          !accepted ||
          accepted.requestId !== submittedJob.requestId ||
          accepted.expiresAt * 1_000 <= Date.now() ||
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
        // Claim once until expiry/cleanup, including uncertain RPC or reply delivery.
        // A fresh nonce is not renewed user intent to submit again.
        if (submissionAttempts.has(submittedJob.quoteId)) return;
        submissionAttempts.add(submittedJob.quoteId);
        void submitPrivateRelayJob({
          signedEnvelopeXdr: submittedJob.signedEnvelopeXdr,
          transactionHash: submittedJob.transactionHash,
        }).then(response => session.sendSubmitted({
          job: submittedJob,
          quote,
          rpcStatus: response.status,
        }, controller.signal)).then(() => {
          forgetNegotiation(submittedJob.quoteId);
        }).catch(() => {
          if (!active) return;
          void session.rejectForQuote({
            requestId: submittedJob.requestId,
            quoteId: submittedJob.quoteId,
            reason: 'submission',
            expiresAt: submittedJob.expiresAt,
          }, controller.signal).catch(() => undefined);
        });
      }, controller.signal);
      const refreshConnectionStatus = async () => {
        const status = await session.connectionStatus();
        if (!active) return;
        publishPrivateRelayHelperStatus({
          phase: status.connected > 0 ? 'connected' : 'reconnecting',
          connectedRelays: status.connected,
          totalRelays: status.total,
        });
      };
      return retryPrivateRelayHelperReadiness({
        signal: controller.signal,
        connect: signal => session.waitUntilConnected(signal),
        onUnavailable: () => {
          if (!active) return;
          publishPrivateRelayHelperStatus({
            phase: 'unavailable',
            connectedRelays: 0,
            totalRelays,
          });
        },
        onRetry: () => {
          if (!active) return;
          publishPrivateRelayHelperStatus({
            phase: 'reconnecting',
            connectedRelays: 0,
            totalRelays,
          });
        },
      }).then(status => {
        if (!active) return;
        publishPrivateRelayHelperStatus({
          phase: 'connected',
          connectedRelays: status.connected,
          totalRelays: status.total,
        });
        statusTimer = setInterval(() => {
          void refreshConnectionStatus().catch(() => undefined);
        }, 2_000);
        visibilityChange = () => {
          if (document.visibilityState === 'visible') {
            void refreshConnectionStatus().catch(() => undefined);
          }
        };
        document.addEventListener('visibilitychange', visibilityChange);
      });
    }).catch(() => {
      if (!active || controller.signal.aborted) return;
      publishPrivateRelayHelperStatus({
        phase: 'unavailable',
        connectedRelays: 0,
        totalRelays,
      });
    });

    return () => {
      active = false;
      controller.abort();
      if (statusTimer) clearInterval(statusTimer);
      if (visibilityChange) document.removeEventListener('visibilitychange', visibilityChange);
      sessionRef.current?.close();
      sessionRef.current = null;
      negotiations.clear();
      signed.clear();
      submissionAttempts.clear();
      preparationLease.clear();
      quoteExpiries.clear();
      reviewingRef.current = null;
      decisionRef.current = null;
      selectingQuotes.clear();
      for (const timer of requestExpiryTimers.values()) clearTimeout(timer);
      requestExpiryTimers.clear();
      requestIds.clear();
      pendingRef.current = null;
      setPending(null);
      setWorking(false);
      setSignatureShared(false);
      setError(null);
      resetPrivateRelayHelperStatus();
    };
  }, [
    preferences.feeAtomic,
    preferences.helpRelay,
    preferences.relayUrls,
    derivePrivateRelayPayout,
    forgetNegotiation,
    networkId,
    phase,
    poolContractId,
    publicAddress,
    preparePrivateRelayJob,
    reviewPrivateRelayJob,
    submitPrivateRelayJob,
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
    setSignatureShared(false);
    setError(null);
  };

  const reject = async () => {
    if (!pending || pendingRef.current !== pending || !sessionRef.current || decisionRef.current) return;
    // Dismissing an uncertain delivery cannot revoke a signature already shared.
    // Keep exact authorization and its sequence lease until submission or expiry.
    if (signedRef.current.has(pending.job.quoteId)) { clearPending(); return; }
    decisionRef.current = pending;
    approvalDetailsRef.current?.focus({ preventScroll: true });
    setWorking(true);
    try {
      await sessionRef.current.rejectForQuote({
        requestId: pending.job.requestId,
        quoteId: pending.job.quoteId,
        reason: 'policy',
        expiresAt: pending.job.expiresAt,
      });
    } catch {
      // Local rejection releases the sequence lease even if the peer is offline.
    } finally {
      forgetNegotiation(pending.job.quoteId);
    }
  };

  const approve = async () => {
    if (!pending || pendingRef.current !== pending || !sessionRef.current || decisionRef.current || signedRef.current.has(pending.job.quoteId)) return;
    const approval = pending;
    const session = sessionRef.current;
    decisionRef.current = approval;
    let shared = false;
    // Native disabled buttons can drop focus to the inert page. The reviewed
    // details remain mounted and own focus throughout signing and delivery.
    approvalDetailsRef.current?.focus({ preventScroll: true });
    setWorking(true);
    setError(null);
    try {
      const signedEnvelopeXdr = await signPrivateRelayJob(pending.review);
      if (pendingRef.current !== approval || sessionRef.current !== session || approval.quote.expiresAt * 1_000 <= Date.now()) return;
      await session.sendSigned({
        job: pending.job,
        quote: pending.quote,
        signedEnvelopeXdr,
        onBeforePublish: signed => {
          if (pendingRef.current !== approval || sessionRef.current !== session || signed.expiresAt * 1_000 <= Date.now()) {
            throw new Error('Private relay approval expired or changed.');
          }
          signedRef.current.set(approval.job.quoteId, signed);
          shared = true;
          setSignatureShared(true);
        },
      });
      if (pendingRef.current !== approval || sessionRef.current !== session) return;
      clearPending();
    } catch {
      if (pendingRef.current !== approval) return;
      setError(shared
        ? 'This transaction was signed, but delivery to the sender is unconfirmed. It may still be submitted. Do not approve a replacement. Dismissing this notice cannot revoke the signature.'
        : 'No signed response was shared by this helper. Reject this request or try approval again before it expires.');
      setWorking(false);
    } finally {
      if (decisionRef.current === approval) decisionRef.current = null;
    }
  };

  return pending ? (
    <Modal open onClose={() => void reject()} dismissable={!working}>
      <ModalHeader
        title="Relay Private Payment?"
        subtitle="A peer is asking this account to submit one transaction"
        onClose={() => void reject()}
        closeDisabled={working}
      />
      <div ref={approvalDetailsRef} tabIndex={-1} role="group" aria-label="Relay approval details" className="space-y-4 p-4 sm:p-6">
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
          Helping never signs transactions automatically.
        </Notice>
        {error ? <p role="alert" className="text-[12px] text-[#FF6961]">{error}</p> : null}
        <div className="grid grid-cols-2 gap-3">
          <Button type="button" variant="ghost" disabled={working} onClick={() => void reject()}>
            {signatureShared ? 'Dismiss' : 'Reject'}
          </Button>
          <Button type="button" loading={working} disabled={working || signatureShared} onClick={() => void approve()}>
            Approve &amp; sign
          </Button>
        </div>
      </div>
    </Modal>
  ) : null;
}
