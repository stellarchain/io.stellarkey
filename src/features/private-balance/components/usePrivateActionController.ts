'use client';

import { useCallback, useRef, useState } from 'react';
import { usePrivateBalanceRuntimeData } from '@/hooks/usePrivateBalanceRuntime';
import { decodePrivateAddress } from '@stellarkey/private-balance';
import { triggerHaptic } from '@/lib/haptics';
import {
  PrivateConsolidationRequiredError,
  type PreparedPrivateActionReview,
  type PrivateActionDraft,
  type PrivateActionProgressStage,
} from '../runtime/action-flow';
import type {
  PrivateChainedSendApproval,
  PrivateChainedSendDraft,
  PrivateChainedSendProgress,
} from '../runtime/chained-send';
import { PrivateActionReviewExpiredError } from '../runtime/submission';
import { loadPrivateRelayPreferences } from '../relay/preferences';
import { PrivateRelaySenderSession } from '../relay/session';
import type {
  PrivateRelayPayout,
  PrivateRelayQuote,
  PrivateRelayRequest,
  PrivateRelaySignedJob,
} from '../relay/protocol';

export type PrivateSubmissionMode = 'relay' | 'direct';
export type PrivateRelayProgress = 'finding-peer' | 'agreeing-fee';

export type PrivateSubmissionOutcome = 'broadcast' | 'ambiguous';

/**
 * A send approved as one consent that runs as several steps because the
 * balance is spread across too many past payments for a single action.
 */
export interface PrivateChainedReview {
  approval: PrivateChainedSendApproval;
  draft: PrivateChainedSendDraft;
}

interface PrivateRelayDiscovery {
  session: PrivateRelaySenderSession;
  request: PrivateRelayRequest;
  quotes: PrivateRelayQuote[];
  draft: Extract<PrivateActionDraft, { kind: 'transfer' | 'withdraw' }>;
  assetIndex: number;
}

/**
 * Owns one private action's whole lifecycle: background preparation while the
 * review screen is already visible, the multi-step (chained) fallback when a
 * transfer needs the balance prepared first, one automatic re-preparation when
 * a review expires under the confirm tap, submission, and release on back or
 * close. Flows stay declarative; every decision on typed runtime errors
 * happens here via `instanceof` on the raw cause.
 */
export function usePrivateActionController(
  onClose: () => void,
  onSubmission?: (status: PrivateSubmissionOutcome) => void,
) {
  const {
    prepareAction,
    cancelAction,
    submitAction,
    prepareChainedSend,
    submitChainedSend,
    asset,
    deployment,
    networkLabel,
    publicAddress,
  } = usePrivateBalanceRuntimeData();
  const abortRef = useRef<AbortController | null>(null);
  const draftRef = useRef<PrivateActionDraft | null>(null);
  const submissionModeRef = useRef<PrivateSubmissionMode>('direct');
  const relayRef = useRef<{
    session: PrivateRelaySenderSession;
    quote: PrivateRelayQuote;
    payout: PrivateRelayPayout;
    signed: PrivateRelaySignedJob | null;
  } | null>(null);
  const relayDiscoveryRef = useRef<PrivateRelayDiscovery | null>(null);
  const relaySelectionRef = useRef<AbortController | null>(null);
  const [review, setReview] = useState<PreparedPrivateActionReview | null>(null);
  const [chained, setChained] = useState<PrivateChainedReview | null>(null);
  const [chainProgress, setChainProgress] = useState<PrivateChainedSendProgress | null>(null);
  const [progress, setProgress] = useState<PrivateActionProgressStage | null>(null);
  const [relayProgress, setRelayProgress] = useState<PrivateRelayProgress | null>(null);
  const [relayQuotes, setRelayQuotes] = useState<PrivateRelayQuote[]>([]);
  /** True while the background preparation runs under the review screen. */
  const [preparing, setPreparing] = useState(false);
  /** True while a confirmed action is signing/broadcasting. */
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The raw cause rides alongside the display string so components can
  // switch on instanceof (consolidation-required, expired review, in-flight,
  // chained fee preflight) instead of matching copy.
  const [errorCause, setErrorCause] = useState<Error | null>(null);
  const [submission, setSubmission] = useState<PrivateSubmissionOutcome | null>(null);
  /** The broadcast transaction hash, for the success screen's explorer link. */
  const [submittedHash, setSubmittedHash] = useState<string | null>(null);

  const prepare = useCallback(async (
    draft: PrivateActionDraft,
    submissionMode: PrivateSubmissionMode = 'direct',
  ) => {
    const controller = new AbortController();
    let pendingRelaySession: PrivateRelaySenderSession | null = null;
    relayDiscoveryRef.current?.session.close();
    relayDiscoveryRef.current = null;
    relayRef.current?.session.close();
    relayRef.current = null;
    abortRef.current = controller;
    draftRef.current = draft;
    submissionModeRef.current = submissionMode;
    setPreparing(true);
    setError(null);
    setErrorCause(null);
    setSubmission(null);
    setSubmittedHash(null);
    setChained(null);
    setRelayQuotes([]);
    setProgress('checking-chain');
    try {
      const preparedDraft = draft;
      if (submissionMode === 'relay') {
        if (draft.kind !== 'transfer' && draft.kind !== 'withdraw') {
          throw new Error('Privacy relay is available for private sends and withdrawals only.');
        }
        if (!asset || !deployment.networkId || !deployment.poolContractId) {
          throw new Error('Private relay deployment information is unavailable.');
        }
        const preferences = loadPrivateRelayPreferences();
        const session = await PrivateRelaySenderSession.create(preferences.relayUrls);
        pendingRelaySession = session;
        setRelayProgress('finding-peer');
        const { request, quotes } = await session.requestQuotes({
          networkId: deployment.networkId,
          poolContractId: deployment.poolContractId,
          actionKind: draft.kind,
          excludePeerAccounts: publicAddress ? [publicAddress] : [],
        }, controller.signal);
        if (quotes.length === 0) {
          session.close();
          throw new Error('No privacy relay peer answered. Try again or explicitly choose direct submission.');
        }
        relayDiscoveryRef.current = {
          session,
          request,
          quotes,
          draft,
          assetIndex: asset.index,
        };
        pendingRelaySession = null;
        setRelayQuotes(quotes);
        return;
      }
      setRelayProgress(null);
      const prepared = await prepareAction(
        preparedDraft,
        stage => {
          if (!controller.signal.aborted) setProgress(stage);
        },
        controller.signal,
      );
      if (controller.signal.aborted) {
        // The person already went back; release the late preparation quietly.
        void cancelAction(prepared.id).catch(() => undefined);
        return;
      }
      setReview(prepared);
    } catch (cause: unknown) {
      if (controller.signal.aborted) return;
      if (
        cause instanceof PrivateConsolidationRequiredError &&
        draft.kind === 'transfer' &&
        submissionMode === 'direct'
      ) {
        // The send needs the balance prepared first: fold it into one
        // approval that covers every step, preflighting the public XLM the
        // whole chain needs before anything is shown for approval.
        try {
          const chainedDraft: PrivateChainedSendDraft = {
            kind: 'transfer',
            amount: draft.amount,
            recipientAddress: draft.recipientAddress,
            ...(draft.memo ? { memo: draft.memo } : {}),
          };
          const approval = await prepareChainedSend(chainedDraft);
          if (!controller.signal.aborted) setChained({ approval, draft: chainedDraft });
          return;
        } catch (chainCause: unknown) {
          if (controller.signal.aborted) return;
          triggerHaptic('error');
          setError(chainCause instanceof Error ? chainCause.message : 'Private action stopped safely.');
          setErrorCause(chainCause instanceof Error ? chainCause : null);
          return;
        }
      }
      triggerHaptic('error');
      setError(cause instanceof Error ? cause.message : 'Private action stopped safely.');
      setErrorCause(cause instanceof Error ? cause : null);
    } finally {
      pendingRelaySession?.close();
      if (abortRef.current === controller) abortRef.current = null;
      setPreparing(false);
      setProgress(null);
      setRelayProgress(null);
    }
  }, [asset, cancelAction, deployment.networkId, deployment.poolContractId, prepareAction, prepareChainedSend, publicAddress]);

  const selectRelayQuote = useCallback(async (quoteId: string) => {
    if (relaySelectionRef.current) return;
    const discovery = relayDiscoveryRef.current;
    const quote = discovery?.quotes.find(candidate => candidate.quoteId === quoteId);
    if (!discovery || !quote) {
      setError('That privacy relay offer is no longer available. Find peers again.');
      setErrorCause(null);
      return;
    }
    if (!asset || asset.index !== discovery.assetIndex) {
      discovery.session.close();
      relayDiscoveryRef.current = null;
      setRelayQuotes([]);
      setError('The selected private asset changed. Review the payment again.');
      setErrorCause(null);
      return;
    }

    const controller = new AbortController();
    relaySelectionRef.current = controller;
    abortRef.current?.abort();
    abortRef.current = controller;
    setPreparing(true);
    setRelayProgress('agreeing-fee');
    setProgress('checking-chain');
    setError(null);
    setErrorCause(null);
    try {
      let diversifier: Uint8Array;
      if (discovery.draft.kind === 'transfer') {
        const prefix = networkLabel === 'Mainnet' ? 'skpay_' : 'tskpay_';
        diversifier = (await decodePrivateAddress(
          discovery.draft.recipientAddress,
          prefix,
        )).diversifier;
      } else {
        do {
          diversifier = globalThis.crypto.getRandomValues(new Uint8Array(4));
        } while (diversifier.every(byte => byte === 0));
      }
      const actionDiversifier = Array.from(
        diversifier,
        byte => byte.toString(16).padStart(2, '0'),
      ).join('');
      const payout = await discovery.session.selectQuote({
        request: discovery.request,
        quote,
        assetIndex: discovery.assetIndex,
        actionDiversifier,
      }, controller.signal);
      if (controller.signal.aborted) {
        discovery.session.close();
        if (relayDiscoveryRef.current === discovery) relayDiscoveryRef.current = null;
        setRelayQuotes([]);
        return;
      }

      relayDiscoveryRef.current = null;
      setRelayQuotes([]);
      relayRef.current = { session: discovery.session, quote, payout, signed: null };
      setRelayProgress(null);
      const prepared = await prepareAction({
        ...discovery.draft,
        relay: {
          feeAtomic: payout.feeAtomic,
          privateFeeAddress: payout.privateFeeAddress,
          sourceAccount: payout.peerAccount,
          requestId: payout.requestId,
          quoteId: payout.quoteId,
          peerPublicKey: quote.peerPubkey,
        },
      }, stage => {
        if (!controller.signal.aborted) setProgress(stage);
      }, controller.signal);
      if (controller.signal.aborted) {
        void cancelAction(prepared.id).catch(() => undefined);
        discovery.session.close();
        if (relayRef.current?.session === discovery.session) relayRef.current = null;
        return;
      }
      setReview(prepared);
    } catch (cause: unknown) {
      discovery.session.close();
      if (relayDiscoveryRef.current === discovery) relayDiscoveryRef.current = null;
      if (relayRef.current?.session === discovery.session) relayRef.current = null;
      setRelayQuotes([]);
      if (controller.signal.aborted) return;
      triggerHaptic('error');
      setError(cause instanceof Error ? cause.message : 'Private relay selection stopped safely.');
      setErrorCause(cause instanceof Error ? cause : null);
    } finally {
      if (relaySelectionRef.current === controller) relaySelectionRef.current = null;
      if (abortRef.current === controller) abortRef.current = null;
      setPreparing(false);
      setProgress(null);
      setRelayProgress(null);
    }
  }, [asset, cancelAction, networkLabel, prepareAction]);

  const cancelPrepared = useCallback(async () => {
    abortRef.current?.abort();
    relayDiscoveryRef.current?.session.close();
    relayDiscoveryRef.current = null;
    relayRef.current?.session.close();
    relayRef.current = null;
    const current = review;
    setReview(null);
    setChained(null);
    setChainProgress(null);
    setRelayQuotes([]);
    setError(null);
    setErrorCause(null);
    if (current && !submission) {
      try {
        await cancelAction(current.id);
      } catch (cause: unknown) {
        setError(cause instanceof Error ? cause.message : 'The prepared action could not be released.');
        setErrorCause(cause instanceof Error ? cause : null);
      }
    }
  }, [cancelAction, review, submission]);

  const close = useCallback(() => {
    abortRef.current?.abort();
    relayDiscoveryRef.current?.session.close();
    relayDiscoveryRef.current = null;
    relayRef.current?.session.close();
    relayRef.current = null;
    if (review && !submission) void cancelAction(review.id).catch(() => undefined);
    onClose();
  }, [cancelAction, onClose, review, submission]);

  const submit = useCallback(async () => {
    setError(null);
    setErrorCause(null);
    if (chained) {
      setWorking(true);
      setChainProgress({ step: 1, totalSteps: chained.approval.steps, stage: 'preparing' });
      try {
        // The runtime resolves the chained outcome; newer contracts also carry
        // the final send's transaction hash for the success screen's explorer
        // chip. Read both shapes defensively so either contract works.
        const outcome = (await submitChainedSend(
          chained.approval,
          chained.draft,
          setChainProgress,
        )) as
          | PrivateSubmissionOutcome
          | { status: PrivateSubmissionOutcome; finalTransactionHash?: string };
        const status = typeof outcome === 'string' ? outcome : outcome.status;
        if (typeof outcome !== 'string' && outcome.finalTransactionHash) {
          setSubmittedHash(outcome.finalTransactionHash);
        }
        setSubmission(status);
        onSubmission?.(status);
      } catch (cause: unknown) {
        // A chained approval dies on its first failure; continuing needs a
        // fresh consent, so the person returns to the form.
        setChained(null);
        triggerHaptic('error');
        setError(cause instanceof Error ? cause.message : 'Private action stopped safely.');
        setErrorCause(cause instanceof Error ? cause : null);
      } finally {
        setWorking(false);
        setChainProgress(null);
      }
      return;
    }
    if (!review) return;
    setWorking(true);
    const submittingRelay = relayRef.current;
    try {
      const relay = submittingRelay;
      const status = await submitAction(review, relay ? {
        requestSignature: async request => {
          const signed = await relay.session.requestSignature({
            quote: relay.quote,
            payout: relay.payout,
            unsignedEnvelopeXdr: request.envelopeXdr,
            transactionHash: request.transactionHash,
          });
          relay.signed = signed;
          return signed.signedEnvelopeXdr;
        },
        requestSubmission: async request => {
          const signed = relay.signed;
          if (
            !signed ||
            signed.transactionHash !== request.transactionHash ||
            signed.signedEnvelopeXdr !== request.signedEnvelopeXdr
          ) {
            throw new Error('Privacy relay signed job changed before submission.');
          }
          const submitted = await relay.session.requestSubmission({ quote: relay.quote, signed });
          return { status: submitted.rpcStatus, hash: submitted.transactionHash };
        },
      } : undefined);
      setSubmission(status);
      setSubmittedHash(review.transaction.transactionHash);
      onSubmission?.(status);
    } catch (cause: unknown) {
      if (cause instanceof PrivateActionReviewExpiredError && draftRef.current) {
        // The review sat open past its window. Nothing was signed; release
        // the expired action and rebuild the review from the same draft — at
        // most once per confirm tap, and never auto-submitting the result.
        setReview(null);
        try {
          await cancelAction(review.id);
        } catch {
          // The runtime released it on failure already.
        }
        setWorking(false);
        await prepare(draftRef.current, submissionModeRef.current);
        return;
      }
      setReview(null);
      triggerHaptic('error');
      setError(cause instanceof Error ? cause.message : 'Private action was not signed.');
      setErrorCause(cause instanceof Error ? cause : null);
    } finally {
      setWorking(false);
      if (relayRef.current === submittingRelay) {
        submittingRelay?.session.close();
        relayRef.current = null;
      }
    }
  }, [cancelAction, chained, onSubmission, prepare, review, submitAction, submitChainedSend]);

  return {
    review,
    chained,
    chainProgress,
    progress,
    relayProgress,
    relayQuotes,
    preparing,
    working,
    error,
    errorCause,
    submission,
    submittedHash,
    prepare,
    selectRelayQuote,
    submit,
    cancelPrepared,
    close,
  };
}
