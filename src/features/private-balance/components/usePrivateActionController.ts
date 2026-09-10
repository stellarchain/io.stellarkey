'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePrivateBalanceRuntimeData } from '@/hooks/usePrivateBalanceRuntime';
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
import { completePrivateActionOperation } from './private-action-operation';
import { PrivateProofConsent, type PrivateProofDisclosure } from '../runtime/proof-disclosure';
import { PrivateProofExposedError } from '../runtime/proof-exposure';

export type PrivateSubmissionOutcome = 'broadcast' | 'ambiguous';

/**
 * A send approved as one consent that runs as several steps because the
 * balance is spread across too many past payments for a single action.
 */
export interface PrivateChainedReview {
  approval: PrivateChainedSendApproval;
  draft: PrivateChainedSendDraft;
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
    publicAddress,
  } = usePrivateBalanceRuntimeData();
  const abortRef = useRef<AbortController | null>(null);
  const draftRef = useRef<PrivateActionDraft | null>(null);
  const proofConsentRef = useRef(new PrivateProofConsent());
  const [disclosure, setDisclosure] = useState<Readonly<PrivateProofDisclosure> | null>(null);
  const [review, setReview] = useState<PreparedPrivateActionReview | null>(null);
  const [chained, setChained] = useState<PrivateChainedReview | null>(null);
  const [chainProgress, setChainProgress] = useState<PrivateChainedSendProgress | null>(null);
  const [progress, setProgress] = useState<PrivateActionProgressStage | null>(null);
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

  useEffect(() => () => {
    abortRef.current?.abort();
    abortRef.current = null;
    proofConsentRef.current.cancel();
    setPreparing(false);
    setWorking(false);
    setChained(null);
    setChainProgress(null);
    setDisclosure(null);
    setReview(null);
  }, [asset?.contractId, deployment.networkId, deployment.poolContractId, publicAddress]);

  const prepare = useCallback(async (
    draft: PrivateActionDraft,
  ) => {
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    draftRef.current = draft;
    setPreparing(true);
    setWorking(false);
    setError(null);
    setErrorCause(null);
    setSubmission(null);
    setSubmittedHash(null);
    setChained(null);
    setReview(null);
    setDisclosure(null);
    setProgress('checking-chain');
    const authorizeDisclosure = async (request: Readonly<PrivateProofDisclosure>) => {
      if (controller.signal.aborted || abortRef.current !== controller) {
        throw new DOMException('Private proof sharing cancelled.', 'AbortError');
      }
      const waiting = proofConsentRef.current.wait(request.actionId, controller.signal);
      setDisclosure(request);
      setPreparing(false);
      setProgress(null);
      try { await waiting; } finally {
        if (abortRef.current === controller) {
          setDisclosure(null);
          setPreparing(!controller.signal.aborted);
        }
      }
    };
    try {
      const prepared = await prepareAction(
        draft,
        stage => {
          if (!controller.signal.aborted) setProgress(stage);
        },
        controller.signal,
        authorizeDisclosure,
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
        draft.kind === 'transfer'
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
      if (abortRef.current === controller) {
        abortRef.current = null;
        setPreparing(false);
        setProgress(null);
      }
    }
  }, [cancelAction, prepareAction, prepareChainedSend]);

  const cancelPrepared = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    proofConsentRef.current.cancel();
    setDisclosure(null);
    const current = review;
    setReview(null);
    setChained(null);
    setChainProgress(null);
    setWorking(false);
    setPreparing(false);
    setProgress(null);
    setError(null);
    setErrorCause(null);
    if (current && !submission) {
      try {
        await cancelAction(current.id);
      } catch (cause: unknown) {
        if (abortRef.current === controller && !controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : 'The prepared action could not be released.');
          setErrorCause(cause instanceof Error ? cause : null);
        }
      }
    }
    if (abortRef.current === controller) abortRef.current = null;
  }, [cancelAction, review, submission]);

  const close = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    proofConsentRef.current.cancel();
    if (review && !submission) void cancelAction(review.id).catch(() => undefined);
    onClose();
  }, [cancelAction, onClose, review, submission]);

  const submit = useCallback(async () => {
    // React's working state is stale within one render; retain the first owner.
    // Proof consent is the one submit action that belongs to an active preparation.
    if (abortRef.current && !disclosure) return;
    setError(null);
    setErrorCause(null);
    if (disclosure) { proofConsentRef.current.approve(disclosure.actionId); return; }
    if (chained) {
      const controller = new AbortController();
      abortRef.current = controller;
      setWorking(true);
      setChainProgress({ step: 1, totalSteps: chained.approval.steps, stage: 'preparing' });
      await completePrivateActionOperation({
        controller, current: abortRef,
        run: async () => {
          // Accept both supported runtime outcome shapes for the explorer chip.
          const updateProgress = (value: PrivateChainedSendProgress) => {
            if (abortRef.current === controller && !controller.signal.aborted) setChainProgress(value);
          };
          return (await submitChainedSend(chained.approval, chained.draft, updateProgress)) as
              | PrivateSubmissionOutcome
              | { status: PrivateSubmissionOutcome; finalTransactionHash?: string };
        },
        success: outcome => {
          const status = typeof outcome === 'string' ? outcome : outcome.status;
          if (typeof outcome !== 'string' && outcome.finalTransactionHash) {
            setSubmittedHash(outcome.finalTransactionHash);
          }
          setSubmission(status);
          onSubmission?.(status);
        },
        failure: cause => {
          // A failed chain needs fresh consent; only its own UI is invalidated.
          setChained(null);
          triggerHaptic('error');
          setError(cause instanceof Error ? cause.message : 'Private action stopped safely.');
          setErrorCause(cause instanceof Error ? cause : null);
        },
        finish: () => {
          setWorking(false);
          setPreparing(false);
          setChainProgress(null);
        },
      });
      return;
    }
    if (!review) return;
    if (working) return;
    const controller = new AbortController();
    abortRef.current = controller;
    const ownsOperation = () => abortRef.current === controller && !controller.signal.aborted;
    setWorking(true);
    try {
      const status = await submitAction(review);
      if (!ownsOperation()) return;
      setSubmission(status);
      setSubmittedHash(review.transaction.transactionHash);
      onSubmission?.(status);
    } catch (cause: unknown) {
      if (!ownsOperation()) return;
      if (cause instanceof PrivateActionReviewExpiredError && draftRef.current?.kind === 'deposit') {
        // The review sat open past its window. Nothing was signed; release
        // the expired action and rebuild the review from the same draft — at
        // most once per confirm tap, and never auto-submitting the result.
        setReview(null);
        try {
          await cancelAction(review.id);
        } catch {
          // The runtime released it on failure already.
        }
        if (!ownsOperation()) return;
        setWorking(false);
        await prepare(draftRef.current);
        return;
      }
      setReview(null);
      triggerHaptic('error');
      const visible = review.kind === 'deposit' ? cause : new PrivateProofExposedError(cause);
      setError(visible instanceof Error ? visible.message : 'Private action was not signed.');
      setErrorCause(visible instanceof Error ? visible : null);
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setWorking(false);
      }
    }
  }, [cancelAction, chained, disclosure, onSubmission, prepare, review, submitAction, submitChainedSend, working]);

  return {
    review,
    disclosure,
    chained,
    chainProgress,
    progress,
    preparing,
    working,
    error,
    errorCause,
    submission,
    submittedHash,
    prepare,
    submit,
    cancelPrepared,
    close,
  };
}
