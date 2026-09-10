'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertContent, Button, ErrorText, HashValue, Modal, ModalFooter, Notice } from '@/components/ui';
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
  PrivateRelayJob,
  PrivateRelayOutcome,
  PrivateRelayQuote,
  PrivateRelaySelection,
} from '../relay/protocol';
import type { PrivateRelayPreparedEnvelope } from '../relay/prepared-envelope';
import type { PrivateRelayJobReview } from '../relay/review';
import { PrivateRelayPreparationLease, PrivateRelayQuoteExpiries, releasePrivateRelayHelperQuote } from '../relay/preparation';
import {
  publishPrivateRelayHelperStatus,
  resetPrivateRelayHelperStatus,
  retryPrivateRelayHelperReadiness,
} from '../relay/helper-status';
import { privateRelayNetwork } from '../relay/network';
import { PrivateRelayConfigurationError } from '../relay/connection-error';
import { PrivateRelayHelperSession } from '../relay/session';
import { WAKU_PRIVATE_RELAY_ENDPOINTS } from '../relay/waku';

const MAX_OPEN_QUOTES = 16;

interface RelayNegotiation {
  quote: PrivateRelayQuote;
  selection: PrivateRelaySelection;
}

interface PendingRelayApproval extends RelayNegotiation {
  job: PrivateRelayJob;
  prepared: PrivateRelayPreparedEnvelope & { transactionHash: string };
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
  /** True once this account signed and submitted: the decision cannot be taken back. */
  const [committed, setCommitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<PrivateRelayHelperSession | null>(null);
  const pendingRef = useRef<PendingRelayApproval | null>(null);
  const decisionRef = useRef<PendingRelayApproval | null>(null);
  const approvalDetailsRef = useRef<HTMLDivElement | null>(null);
  const negotiationsRef = useRef(new Map<string, RelayNegotiation>());
  const outcomesRef = useRef(new Map<string, PrivateRelayOutcome>());
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
      negotiations: negotiationsRef.current, signed: outcomesRef.current,
      preparationLease: preparationLeaseRef.current, pending: pendingRef,
      onPendingReleased: released => {
        setPending(current => current === released ? null : current);
        setWorking(false);
        setCommitted(false);
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
    const network = privateRelayNetwork({ wakuPeers: preferences.wakuPeers, wakuClusterId: preferences.wakuClusterId });
    const totalRelays = WAKU_PRIVATE_RELAY_ENDPOINTS.length;
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
    let connectionProblem = false;
    let refreshingStatus = false;
    const controller = new AbortController();
    const reportConnectionFailure = (cause: unknown) => {
      if (!active || controller.signal.aborted || connectionProblem) return;
      if (cause instanceof PrivateRelayConfigurationError) {
        connectionProblem = true;
        if (statusTimer) clearInterval(statusTimer);
        statusTimer = null;
        publishPrivateRelayHelperStatus({
          phase: 'configuration-error', connectedRelays: 0, totalRelays, configurationProblem: cause.problem,
        });
      } else {
        publishPrivateRelayHelperStatus({ phase: 'unavailable', connectedRelays: 0, totalRelays });
      }
    };
    const negotiations = negotiationsRef.current;
    const outcomes = outcomesRef.current;
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

    void PrivateRelayHelperSession.create(network).then(session => {
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
        if (message.type !== 'job') return;
        const negotiation = negotiations.get(message.quoteId);
        if (!negotiation) return;
        const busy = pendingRef.current || reviewingRef.current || outcomes.size > 0 || submissionAttempts.size > 0;
        const preparationToken = busy ? null : preparationLease.begin(message.quoteId);
        if (!preparationToken) {
          void session.rejectForQuote({ ...message, reason: 'busy' }, controller.signal).catch(() => undefined);
          return;
        }
        const reviewToken = { quoteId: message.quoteId };
        reviewingRef.current = reviewToken;
        void preparePrivateRelayJob({
          job: message, sourceAccount: quote.peerAccount,
          assetIndex: negotiation.selection.assetIndex, actionDiversifier: negotiation.selection.actionDiversifier,
          feeAtomic: quote.feeAtomic, expectedMethod: negotiation.selection.actionKind, quoteExpiresAt: quote.expiresAt,
        }, controller.signal).then(async prepared => {
          if (!active || controller.signal.aborted || quote.expiresAt * 1_000 <= Date.now() ||
            negotiations.get(message.quoteId) !== negotiation || reviewingRef.current !== reviewToken) {
            preparationLease.cancel(preparationToken);
            return;
          }
          if (!prepared.transactionHash || !preparationLease.complete(preparationToken, prepared)) {
            preparationLease.cancel(preparationToken);
            throw new Error('Private relay preparation is incomplete');
          }
          const leased = preparationLease.get(message.quoteId);
          if (!leased) throw new Error('Private relay preparation lease was lost');
          // This account reviews the envelope it simulated itself; the sender never signs.
          const review = await reviewPrivateRelayJob({
            unsignedEnvelopeXdr: leased.preparedEnvelopeXdr, transactionHash: prepared.transactionHash,
            sourceAccount: quote.peerAccount, assetIndex: negotiation.selection.assetIndex,
            actionDiversifier: negotiation.selection.actionDiversifier, feeAtomic: quote.feeAtomic,
          });
          if (!active || reviewingRef.current !== reviewToken || pendingRef.current || quote.expiresAt * 1_000 <= Date.now() ||
            negotiations.get(message.quoteId) !== negotiation || preparationLease.get(message.quoteId) !== leased) return;
          const approval: PendingRelayApproval = {
            ...negotiation, job: message, review,
            prepared: { ...leased, transactionHash: prepared.transactionHash },
          };
          pendingRef.current = approval;
          setPending(approval);
          setCommitted(false);
          setError(null);
        }).catch(() => {
          preparationLease.release(message.quoteId);
          if (negotiations.get(message.quoteId) === negotiation) forgetNegotiation(message.quoteId);
          void session.rejectForQuote({ ...message, reason: 'simulation' }, controller.signal).catch(() => undefined);
        }).finally(() => {
          if (reviewingRef.current === reviewToken) reviewingRef.current = null;
        });
      }, controller.signal);
      const refreshConnectionStatus = async () => {
        if (!active || connectionProblem || refreshingStatus) return;
        refreshingStatus = true;
        try {
          const status = await session.connectionStatus();
          if (!active || connectionProblem) return;
          publishPrivateRelayHelperStatus({
            phase: status.connected > 0 ? 'connected' : 'reconnecting',
            connectedRelays: status.connected,
            totalRelays: status.total,
          });
        } catch (cause) {
          reportConnectionFailure(cause);
        } finally {
          refreshingStatus = false;
        }
      };
      return retryPrivateRelayHelperReadiness({
        signal: controller.signal,
        connect: signal => session.waitUntilConnected(signal),
        shouldRetry: cause => !(cause instanceof PrivateRelayConfigurationError),
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
        if (!active || connectionProblem) return;
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
    }).catch(reportConnectionFailure);

    return () => {
      active = false;
      controller.abort();
      if (statusTimer) clearInterval(statusTimer);
      if (visibilityChange) document.removeEventListener('visibilitychange', visibilityChange);
      sessionRef.current?.close();
      sessionRef.current = null;
      negotiations.clear();
      outcomes.clear();
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
      setCommitted(false);
      setError(null);
      resetPrivateRelayHelperStatus();
    };
  }, [
    preferences.feeAtomic,
    preferences.helpRelay,
    preferences.wakuPeers,
    preferences.wakuClusterId,
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
    setCommitted(false);
    setError(null);
  };

  const reject = async () => {
    if (!pending || pendingRef.current !== pending || !sessionRef.current || decisionRef.current) return;
    // Dismissing an uncertain delivery cannot undo a submitted transaction.
    // Keep the exact outcome and its sequence lease until the quote expires.
    if (outcomesRef.current.has(pending.job.quoteId) || submissionAttemptsRef.current.has(pending.job.quoteId)) { clearPending(); return; }
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
    if (!pending || pendingRef.current !== pending || !sessionRef.current || decisionRef.current ||
      outcomesRef.current.has(pending.job.quoteId) || submissionAttemptsRef.current.has(pending.job.quoteId)) return;
    const approval = pending;
    const session = sessionRef.current;
    decisionRef.current = approval;
    let submitted = false;
    // Native disabled buttons can drop focus to the inert page. The reviewed
    // details remain mounted and own focus throughout signing and delivery.
    approvalDetailsRef.current?.focus({ preventScroll: true });
    setWorking(true);
    setError(null);
    try {
      const signedEnvelopeXdr = await signPrivateRelayJob(approval.review);
      if (pendingRef.current !== approval || sessionRef.current !== session || approval.quote.expiresAt * 1_000 <= Date.now()) return;
      // Approval is the submission decision: submit from this account at once,
      // exactly once per quote, then report. An uncertain RPC answer is reported
      // as ERROR and never retried here; the sender reconciles from the ledger.
      submissionAttemptsRef.current.add(approval.job.quoteId);
      let rpcStatus: PrivateRelayOutcome['rpcStatus'];
      try {
        rpcStatus = (await submitPrivateRelayJob({ signedEnvelopeXdr, transactionHash: approval.review.transactionHash })).status;
      } catch {
        rpcStatus = 'ERROR';
      }
      submitted = true;
      setCommitted(true);
      if (pendingRef.current !== approval || sessionRef.current !== session) return;
      await session.sendOutcome({
        job: approval.job, quote: approval.quote,
        preparedEnvelopeXdr: approval.prepared.preparedEnvelopeXdr, accountSequence: approval.prepared.accountSequence,
        simulationLedger: approval.prepared.simulationLedger, signedEnvelopeXdr,
        transactionHash: approval.review.transactionHash, rpcStatus,
        onBeforePublish: outcome => {
          if (sessionRef.current !== session) throw new Error('Private relay session changed.');
          outcomesRef.current.set(approval.job.quoteId, outcome);
        },
      });
      if (pendingRef.current !== approval || sessionRef.current !== session) return;
      clearPending();
      forgetNegotiation(approval.job.quoteId);
    } catch {
      if (pendingRef.current !== approval) return;
      setError(submitted
        ? 'This transaction was signed and submitted, but the receipt did not reach the sender. It may still confirm on the network. Do not approve a replacement; dismissing this notice cannot undo the submission.'
        : 'No signed response was shared by this helper. Reject this request or try approval again before it expires.');
      setWorking(false);
    } finally {
      if (decisionRef.current === approval) decisionRef.current = null;
    }
  };

  // The approval is an interrupt: a centred alert that a stray tap cannot
  // dismiss. Its hashes and fees are sensitive, so the content renders only
  // while a request is pending; the shell keeps its geometry through the exit.
  return (
    <Modal
      open={pending !== null}
      onClose={() => void reject()}
      presentation="alert"
      busy={working}
      busyReason="Wait for signing, submission and delivery to finish before dismissing."
    >
      {pending ? (
        <AlertContent
          title="Relay a private payment?"
          message="A peer is asking this account to submit one transaction"
          actions={
            <ModalFooter
              stack
              secondary={
                <Button type="button" variant="ghost" disabled={working} onClick={() => void reject()}>
                  {committed ? 'Dismiss' : 'Reject'}
                </Button>
              }
              primary={
                <Button type="button" loading={working} disabled={working || committed} onClick={() => void approve()}>
                  Approve and submit
                </Button>
              }
            />
          }
        >
          <div ref={approvalDetailsRef} tabIndex={-1} role="group" aria-label="Relay approval details" className="space-y-3 outline-none">
            <dl className="panel-inset divide-y divide-white/[0.08] px-3.5 text-[13px]">
              <div className="flex tap flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2.5">
                <dt className="shrink-0 text-neutral-400">Private reward</dt>
                <dd className="text-right font-semibold text-[#30D158]">{fee}</dd>
              </div>
              <div className="flex tap flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2.5">
                <dt className="shrink-0 text-neutral-400">Your max network fee</dt>
                <dd className="text-right font-semibold text-white">{networkFee} XLM</dd>
              </div>
              <div className="flex tap flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2.5">
                <dt className="shrink-0 text-neutral-400">Pool action</dt>
                <dd className="capitalize text-white">Private {pending.review.method}</dd>
              </div>
              <div className="flex tap flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2.5">
                <dt className="shrink-0 text-neutral-400">Transaction</dt>
                <dd className="min-w-0 flex-1 text-right"><HashValue value={pending.review.transactionHash} className="justify-end text-[11px]" /></dd>
              </div>
            </dl>
            <Notice>
              The wallet built and simulated this exact transaction from your account, confirmed it only
              invokes this private pool, decrypted exactly one fee note addressed to you and capped its fees.
              Approving signs and submits it once; helping never does either automatically.
            </Notice>
            {error ? <ErrorText message={error} /> : null}
          </div>
        </AlertContent>
      ) : null}
    </Modal>
  );
}
