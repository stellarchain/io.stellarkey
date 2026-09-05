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
import { loadPrivateRelayPreferences } from '../relay/preferences';
import { privateRelayRecipientDiversifier } from '../relay/recipient';
import { PrivateRelaySenderSession } from '../relay/session';
import { discoverPrivateRelayChainQuote, PrivateRelayChainChoice } from '../relay/chain-choice';
import type { PrivateRelayChainApproval } from '../runtime/relay-chain-policy';
import type { SelectPrivateRelayChainPeer } from '../runtime/relay-chained-send';
import { completePrivateActionOperation } from './private-action-operation';
import { PrivateProofConsent, type PrivateProofDisclosure } from '../runtime/proof-disclosure';
import { PrivateProofExposedError } from '../runtime/proof-exposure';
import type {
  PrivateRelayPayout,
  PrivateRelayQuote,
  PrivateRelayRequest,
  PrivateRelaySignedJob,
} from '../relay/protocol';

export type PrivateSubmissionMode = 'relay' | 'direct';
export type PrivateRelayProgress =
  | 'finding-peer'
  | 'same-account-peer'
  | 'comparing-fees'
  | 'agreeing-fee';

export type PrivateSubmissionOutcome = 'broadcast' | 'ambiguous';

/**
 * A send approved as one consent that runs as several steps because the
 * balance is spread across too many past payments for a single action.
 */
export interface PrivateChainedReview {
  approval: PrivateChainedSendApproval;
  draft: PrivateChainedSendDraft;
  relayApproval?: PrivateRelayChainApproval;
}

interface PrivateRelayDiscovery {
  session: PrivateRelaySenderSession;
  request: PrivateRelayRequest;
  quotes: PrivateRelayQuote[];
  draft: Extract<PrivateActionDraft, { kind: 'transfer' | 'withdraw' }>;
  assetIndex: number;
  takeOwnership(): void;
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
    prepareRelayChainedSend,
    submitRelayChainedSend,
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
  const relayChainChoiceRef = useRef(new PrivateRelayChainChoice());
  const proofConsentRef = useRef(new PrivateProofConsent());
  const [disclosure, setDisclosure] = useState<Readonly<PrivateProofDisclosure> | null>(null);
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

  useEffect(() => () => {
    abortRef.current?.abort();
    abortRef.current = null;
    proofConsentRef.current.cancel();
    relayChainChoiceRef.current.cancel();
    relaySelectionRef.current = null;
    relayDiscoveryRef.current?.session.close();
    relayDiscoveryRef.current = null;
    relayRef.current?.session.close();
    relayRef.current = null;
    setRelayQuotes([]);
    setRelayProgress(null);
    setPreparing(false);
    setWorking(false);
    setChained(null);
    setChainProgress(null);
    setDisclosure(null);
    setReview(null);
  }, [asset?.contractId, deployment.networkId, deployment.poolContractId, publicAddress]);

  const authorizeDisclosure = useCallback(async (request: Readonly<PrivateProofDisclosure>) => {
    const controller = abortRef.current;
    if (!controller || controller.signal.aborted) throw new DOMException('Private proof sharing cancelled.', 'AbortError');
    const waiting = proofConsentRef.current.wait(request.actionId, controller.signal);
    setDisclosure(request);
    setPreparing(false);
    setProgress(null);
    try { await waiting; } finally {
      if (abortRef.current === controller) { setDisclosure(null); setPreparing(!controller.signal.aborted); }
    }
  }, []);

  const selectChainPeer = useCallback<SelectPrivateRelayChainPeer>(async (step, signal) => {
    if (!asset || !deployment.networkId || !deployment.poolContractId) throw new Error('Private relay deployment information is unavailable.');
    const check = () => { if (signal.aborted) throw new DOMException('Private relay chain cancelled.', 'AbortError'); };
    check();
    const actionDiversifier = await privateRelayRecipientDiversifier(step.recipientAddress, networkLabel === 'Mainnet' ? 'skpay_' : 'tskpay_');
    check();
    setPreparing(true);
    setRelayProgress('finding-peer');
    setRelayQuotes([]);
    const session = await PrivateRelaySenderSession.create(loadPrivateRelayPreferences().relayUrls);
    const closeOnAbort = () => session.close();
    signal.addEventListener('abort', closeOnAbort, { once: true });
    try {
      check();
      const { request, quote } = await discoverPrivateRelayChainQuote({
        session, choice: relayChainChoiceRef.current,
        networkId: deployment.networkId, poolContractId: deployment.poolContractId,
        maximumFeeAtomic: step.maximumPrivateFeeAtomic,
        excludePeerAccounts: publicAddress ? [publicAddress] : [],
        onQuotes: quotes => {
          if (!signal.aborted) { setRelayQuotes([...quotes]); setRelayProgress('comparing-fees'); }
        },
        onSettled: () => {
          if (!signal.aborted) { setPreparing(false); setRelayProgress(null); }
        },
      }, signal);
      check();
      setRelayQuotes([]);
      setPreparing(true);
      setRelayProgress('agreeing-fee');
      const payout = await session.selectQuote({ request, quote, actionKind: 'transfer', assetIndex: asset.index,
        actionDiversifier }, signal);
      check();
      let signed: PrivateRelaySignedJob | null = null;
      setRelayProgress(null);
      return {
        binding: { feeAtomic: payout.feeAtomic, privateFeeAddress: payout.privateFeeAddress, sourceAccount: payout.peerAccount,
          requestId: payout.requestId, quoteId: payout.quoteId, peerPublicKey: quote.peerPubkey },
        preparation: { expiresAt: Math.min(quote.expiresAt, payout.expiresAt), prepare: (request, activeSignal) => session.requestPreparation({ ...request, quote, payout }, activeSignal) },
        submission: {
          requestSignature: async request => { check(); signed = await session.requestSignature({ quote, payout, unsignedEnvelopeXdr: request.envelopeXdr, transactionHash: request.transactionHash }, signal); check(); return signed.signedEnvelopeXdr; },
          requestSubmission: async request => {
            check();
            if (!signed || signed.transactionHash !== request.transactionHash || signed.signedEnvelopeXdr !== request.signedEnvelopeXdr) throw new Error('Private relay signed step changed.');
            const submitted = await session.requestSubmission({ quote, signed }, signal);
            return { status: submitted.rpcStatus, hash: submitted.transactionHash };
          },
        },
        close: () => { signal.removeEventListener('abort', closeOnAbort); session.close(); },
      };
    } catch (error) {
      signal.removeEventListener('abort', closeOnAbort); session.close(); throw error;
    } finally {
      if (!signal.aborted) { setPreparing(false); setRelayProgress(null); setRelayQuotes([]); }
    }
  }, [asset, deployment.networkId, deployment.poolContractId, networkLabel, publicAddress]);

  const prepare = useCallback(async (
    draft: PrivateActionDraft,
    submissionMode: PrivateSubmissionMode = 'direct',
  ) => {
    const controller = new AbortController();
    abortRef.current?.abort();
    let pendingRelaySession: PrivateRelaySenderSession | null = null;
    relayDiscoveryRef.current?.session.close();
    relayDiscoveryRef.current = null;
    relayRef.current?.session.close();
    relayRef.current = null;
    abortRef.current = controller;
    draftRef.current = draft;
    submissionModeRef.current = submissionMode;
    setPreparing(true);
    setWorking(false);
    setError(null);
    setErrorCause(null);
    setSubmission(null);
    setSubmittedHash(null);
    setChained(null);
    setDisclosure(null);
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
        if (draft.kind === 'transfer') {
          await privateRelayRecipientDiversifier(draft.recipientAddress, networkLabel === 'Mainnet' ? 'skpay_' : 'tskpay_');
          if (controller.signal.aborted || abortRef.current !== controller) return;
        }
        const preferences = loadPrivateRelayPreferences();
        const session = await PrivateRelaySenderSession.create(preferences.relayUrls);
        pendingRelaySession = session;
        if (controller.signal.aborted || abortRef.current !== controller) return;
        let hasEligibleQuote = false;
        setRelayProgress('finding-peer');
        const { request, quotes, ineligiblePeerAccounts } = await session.requestQuotes({
          networkId: deployment.networkId,
          poolContractId: deployment.poolContractId,
          actionKind: draft.kind,
          excludePeerAccounts: publicAddress ? [publicAddress] : [],
          onQuotes: (quotes, request) => {
            if (controller.signal.aborted || abortRef.current !== controller) return;
            hasEligibleQuote = quotes.length > 0;
            // Install the selectable context before making offers interactive.
            // Selection transfers ownership synchronously, then cancels only
            // this collection task. Its finally must not close the chosen peer.
            relayDiscoveryRef.current = {
              session, request: { ...request }, quotes: quotes.map(quote => ({ ...quote })),
              draft, assetIndex: asset.index,
              takeOwnership: () => { pendingRelaySession = null; },
            };
            setRelayQuotes([...quotes]);
            setRelayProgress('comparing-fees');
          },
          onIneligiblePeerAccounts: count => {
            if (controller.signal.aborted || count === 0 || hasEligibleQuote) return;
            setRelayProgress('same-account-peer');
          },
        }, controller.signal);
        if (controller.signal.aborted || abortRef.current !== controller) return;
        if (quotes.length === 0) {
          session.close();
          throw new Error(ineligiblePeerAccounts > 0
            ? 'A helper using this same Stellar account answered, but self-relaying would not improve privacy. Use a different account in the other browser.'
            : 'No privacy relay peer answered. Try again or explicitly choose direct submission.');
        }
        relayDiscoveryRef.current = {
          session,
          request,
          quotes,
          draft,
          assetIndex: asset.index,
          takeOwnership: () => {},
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
        undefined,
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
      if (submissionMode === 'relay') setRelayQuotes([]);
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
      if (pendingRelaySession && relayDiscoveryRef.current?.session === pendingRelaySession) relayDiscoveryRef.current = null;
      pendingRelaySession?.close();
      if (abortRef.current === controller) {
        abortRef.current = null;
        setPreparing(false);
        setProgress(null);
        setRelayProgress(null);
      }
    }
  }, [asset, authorizeDisclosure, cancelAction, deployment.networkId, deployment.poolContractId, networkLabel, prepareAction, prepareChainedSend, publicAddress]);

  const selectRelayQuote = useCallback(async (quoteId: string) => {
    if (relayChainChoiceRef.current.pending) {
      if (!relayChainChoiceRef.current.choose(quoteId)) setError('That helper quote expired or exceeds the approved fee. Cancel and review the chain again.');
      else { setPreparing(true); setRelayProgress('agreeing-fee'); }
      return;
    }
    // A consumed chain choice must not fall through into ordinary discovery
    // while its payout is being negotiated (including a same-tick double tap).
    if (chained?.relayApproval) return;
    if (relaySelectionRef.current) return;
    const discovery = relayDiscoveryRef.current;
    const available = discovery?.quotes.find(candidate => candidate.quoteId === quoteId);
    if (!discovery || !available || available.expiresAt * 1_000 <= Date.now()) {
      setError('That privacy relay offer is no longer available. Find peers again.');
      setErrorCause(null);
      return;
    }
    const quote = { ...available };
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
    discovery.takeOwnership();
    abortRef.current?.abort();
    abortRef.current = controller;
    setPreparing(true);
    setRelayProgress('agreeing-fee');
    setProgress('checking-chain');
    setError(null);
    setErrorCause(null);
    try {
      if (discovery.draft.kind === 'transfer') {
        const finalDraft: PrivateChainedSendDraft = { kind: 'transfer', amount: discovery.draft.amount,
          recipientAddress: discovery.draft.recipientAddress, ...(discovery.draft.memo ? { memo: discovery.draft.memo } : {}) };
        const approval = await prepareRelayChainedSend(finalDraft, quote.feeAtomic);
        if (controller.signal.aborted) return;
        if (approval) {
          discovery.session.close();
          relayDiscoveryRef.current = null;
          setRelayQuotes([]);
          setChained({ approval, draft: finalDraft, relayApproval: approval });
          return;
        }
      }
      let actionDiversifier: string;
      if (discovery.draft.kind === 'transfer') {
        actionDiversifier = await privateRelayRecipientDiversifier(discovery.draft.recipientAddress, networkLabel === 'Mainnet' ? 'skpay_' : 'tskpay_');
      } else {
        let diversifier: Uint8Array;
        do {
          diversifier = globalThis.crypto.getRandomValues(new Uint8Array(4));
        } while (diversifier.every(byte => byte === 0));
        actionDiversifier = Array.from(diversifier, byte => byte.toString(16).padStart(2, '0')).join('');
        diversifier.fill(0);
      }
      if (controller.signal.aborted) return;
      const payout = await discovery.session.selectQuote({
        request: discovery.request,
        quote,
        actionKind: discovery.draft.kind,
        assetIndex: discovery.assetIndex,
        actionDiversifier,
      }, controller.signal);
      if (controller.signal.aborted) {
        discovery.session.close();
        if (relayDiscoveryRef.current === discovery) relayDiscoveryRef.current = null;
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
      }, controller.signal, {
        expiresAt: Math.min(quote.expiresAt, payout.expiresAt),
        prepare: (request, signal) => discovery.session.requestPreparation({ ...request, quote, payout }, signal),
      }, authorizeDisclosure);
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
      if (controller.signal.aborted) return;
      setRelayQuotes([]);
      triggerHaptic('error');
      setError(cause instanceof Error ? cause.message : 'Private relay selection stopped safely.');
      setErrorCause(cause instanceof Error ? cause : null);
    } finally {
      if (relaySelectionRef.current === controller) relaySelectionRef.current = null;
      if (abortRef.current === controller) {
        abortRef.current = null;
        setPreparing(false);
        setProgress(null);
        setRelayProgress(null);
      }
    }
  }, [asset, authorizeDisclosure, cancelAction, chained?.relayApproval, networkLabel, prepareAction, prepareRelayChainedSend]);

  const cancelPrepared = useCallback(async () => {
    abortRef.current?.abort();
    abortRef.current = null;
    proofConsentRef.current.cancel();
    setDisclosure(null);
    relaySelectionRef.current = null;
    relayChainChoiceRef.current.cancel();
    relayDiscoveryRef.current?.session.close();
    relayDiscoveryRef.current = null;
    relayRef.current?.session.close();
    relayRef.current = null;
    const current = review;
    setReview(null);
    setChained(null);
    setChainProgress(null);
    setWorking(false);
    setPreparing(false);
    setProgress(null);
    setRelayProgress(null);
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
    abortRef.current = null;
    proofConsentRef.current.cancel();
    relayChainChoiceRef.current.cancel();
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
          return (await (chained.relayApproval
            ? submitRelayChainedSend(chained.relayApproval, selectChainPeer, controller.signal, updateProgress)
            : submitChainedSend(chained.approval, chained.draft, updateProgress))) as
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
          relayChainChoiceRef.current.cancel();
          setWorking(false);
          setPreparing(false);
          setRelayQuotes([]);
          setChainProgress(null);
        },
      });
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
        setWorking(false);
        await prepare(draftRef.current, submissionModeRef.current);
        return;
      }
      setReview(null);
      triggerHaptic('error');
      const visible = review.kind === 'deposit' ? cause : new PrivateProofExposedError(cause);
      setError(visible instanceof Error ? visible.message : 'Private action was not signed.');
      setErrorCause(visible instanceof Error ? visible : null);
    } finally {
      setWorking(false);
      if (relayRef.current === submittingRelay) {
        submittingRelay?.session.close();
        relayRef.current = null;
      }
    }
  }, [cancelAction, chained, disclosure, onSubmission, prepare, review, selectChainPeer, submitAction, submitChainedSend, submitRelayChainedSend]);

  return {
    review,
    disclosure,
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
