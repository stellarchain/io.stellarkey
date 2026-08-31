'use client';

import { useCallback, useRef, useState } from 'react';
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
  } = usePrivateBalanceRuntimeData();
  const abortRef = useRef<AbortController | null>(null);
  const draftRef = useRef<PrivateActionDraft | null>(null);
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

  const prepare = useCallback(async (draft: PrivateActionDraft) => {
    const controller = new AbortController();
    abortRef.current = controller;
    draftRef.current = draft;
    setPreparing(true);
    setError(null);
    setErrorCause(null);
    setSubmission(null);
    setSubmittedHash(null);
    setChained(null);
    setProgress('checking-chain');
    try {
      const prepared = await prepareAction(
        draft,
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
      if (cause instanceof PrivateConsolidationRequiredError && draft.kind === 'transfer') {
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
      if (abortRef.current === controller) abortRef.current = null;
      setPreparing(false);
      setProgress(null);
    }
  }, [cancelAction, prepareAction, prepareChainedSend]);

  const cancelPrepared = useCallback(async () => {
    abortRef.current?.abort();
    const current = review;
    setReview(null);
    setChained(null);
    setChainProgress(null);
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
    try {
      const status = await submitAction(review);
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
        await prepare(draftRef.current);
        return;
      }
      setReview(null);
      triggerHaptic('error');
      setError(cause instanceof Error ? cause.message : 'Private action was not signed.');
      setErrorCause(cause instanceof Error ? cause : null);
    } finally {
      setWorking(false);
    }
  }, [cancelAction, chained, onSubmission, prepare, review, submitAction, submitChainedSend]);

  return {
    review,
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
