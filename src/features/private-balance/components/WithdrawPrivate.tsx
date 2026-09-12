'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type FormEvent } from 'react';
import { Button, Field, Modal, ModalBody, ModalFooter, ModalHeader, Notice } from '@/components/ui';
import { usePrivateBalanceRuntimeData } from '@/hooks/usePrivateBalanceRuntime';
import { fmtAmount } from '@/lib/format';
import { NETWORKS } from '@/lib/stellar';
import { humanizePrivateError, PRIVACY_ROW } from '../copy';
import { parsePrivateAmount } from '../runtime/coin-selection';
import { formatPrivateBalanceAmount } from '../runtime/selectors';
import { PrivateActionError } from './PrivateActionError';
import { PrivateActionReview } from './PrivateActionReview';
import { PrivateAssetSelector } from './PrivateAssetSelector';
import { PrivateFeeAccountSelector, usePrivateFeeAccount } from './PrivateFeeAccountSelector';
import {
  PrivateAmountField,
  PrivateQuickAmounts,
  trimAmountInput,
} from './PrivateAmountField';
import { PrivateSubmissionStatus } from './PrivateSubmissionStatus';
import {
  usePrivateActionController,
} from './usePrivateActionController';
import {
  useReportToOwner,
  type PrivateFlowHeader,
  type PrivateFlowHeaderChange,
} from './useReportToOwner';

export interface WithdrawPrivateFlowProps {
  onClose(): void;
  /** Fires when a confirmed withdrawal reaches the network. */
  onSubmitted?: () => void;
  onCloseHandlerChange?: (handler: (() => void) | null) => void;
  onWorkingChange?: (working: boolean) => void;
  /** Stage-aware header for the owning shell; `null` means the form's default. */
  onHeaderChange?: PrivateFlowHeaderChange;
  /** True while an amount or a changed recipient is typed that was not sent. */
  onDirtyChange?: (dirty: boolean) => void;
}

/**
 * Moves private funds back to a public Stellar account — prefilled with the
 * active account. This leg is public, like any Stellar payment, and the copy
 * says so plainly; the flow itself mirrors the send exactly.
 *
 * The shell is owned here; the flow inside reports its close handler, busy
 * state, dirty state and stage header through the same contract the shared
 * Send and Add sheets use, so an owner may embed it later.
 */
export function WithdrawPrivate({
  open = true,
  onClose,
  onSubmitted,
}: {
  open?: boolean;
  onClose(): void;
  onSubmitted?: () => void;
}) {
  const { asset } = usePrivateBalanceRuntimeData();
  const [closeHandler, setCloseHandler] = useState<(() => void) | null>(null);
  const [working, setWorking] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [header, setHeader] = useState<PrivateFlowHeader | null>(null);
  const reportCloseHandler = useCallback((handler: (() => void) | null) => {
    setCloseHandler(() => handler);
  }, []);

  const code = asset?.code ?? 'Asset';
  const close = closeHandler ?? onClose;
  const shown = header ?? { title: 'Withdraw Funds', subtitle: `Move ${code} to your public balance` };
  return (
    <Modal
      open={open}
      onClose={close}
      busy={working}
      busyReason="Wait for the withdrawal to finish before closing."
      dirty={dirty}
    >
      <ModalHeader
        title={shown.title}
        subtitle={shown.subtitle}
        onBack={shown.onBack}
        onClose={close}
      />
      {open ? (
        <WithdrawPrivateFlow
          onClose={onClose}
          onSubmitted={onSubmitted}
          onCloseHandlerChange={reportCloseHandler}
          onWorkingChange={setWorking}
          onHeaderChange={setHeader}
          onDirtyChange={setDirty}
        />
      ) : null}
    </Modal>
  );
}

export function WithdrawPrivateFlow({
  onClose,
  onSubmitted,
  onCloseHandlerChange,
  onWorkingChange,
  onHeaderChange,
  onDirtyChange,
}: WithdrawPrivateFlowProps) {
  const feeAccount = usePrivateFeeAccount();
  const { asset, publicAddress, verifiedBalanceStroops, networkLabel } =
    usePrivateBalanceRuntimeData();
  const decimals = asset?.decimals ?? 7;
  const code = asset?.code ?? 'Asset';
  const headerOwned = onHeaderChange !== undefined;
  const [stage, setStage] = useState<'form' | 'review'>('form');
  const [amount, setAmount] = useState('');
  const [publicRecipient, setPublicRecipient] = useState(publicAddress ?? '');
  const flow = usePrivateActionController(onClose, onSubmitted);

  const trimmedRecipient = publicRecipient.trim();
  const recipientShapeOk = /^[GC][A-Z2-7]{55}$/.test(trimmedRecipient);

  const privateBalanceMax = useMemo(
    () => trimAmountInput(formatPrivateBalanceAmount(BigInt(verifiedBalanceStroops), decimals)),
    [decimals, verifiedBalanceStroops],
  );
  const amountCheck = useMemo<{ stroops: bigint | null; error: string | null }>(() => {
    const trimmed = amount.trim();
    if (!trimmed) return { stroops: null, error: null };
    try {
      const stroops = parsePrivateAmount(trimmed, decimals);
      if (stroops > BigInt(verifiedBalanceStroops)) {
        return {
          stroops: null,
          error: `Exceeds your private balance of ${fmtAmount(privateBalanceMax)} ${code}.`,
        };
      }
      return { stroops, error: null };
    } catch (cause: unknown) {
      return { stroops: null, error: humanizePrivateError(cause).body };
    }
  }, [amount, code, decimals, privateBalanceMax, verifiedBalanceStroops]);

  const submitForm = (event: FormEvent) => {
    event.preventDefault();
    if (amountCheck.stroops === null || !recipientShapeOk) return;
    // The form leaves the tree; keep explicit navigation focus in its owner.
    const shell = event.currentTarget.closest<HTMLElement>('[data-modal-shell]');
    if (shell && !shell.closest('[inert]')) shell.focus({ preventScroll: true });
    setStage('review');
    void flow.prepare(
      { kind: 'withdraw', amount: amount.trim(), publicRecipient: trimmedRecipient, feePayerAccountId: feeAccount.feePayerAccountId || undefined },
    );
  };

  // Back keeps the draft: it releases the preparation and returns to the form.
  const { cancelPrepared } = flow;
  const backToForm = useCallback(() => {
    void cancelPrepared();
    setStage('form');
  }, [cancelPrepared]);

  const networkKey = networkLabel === 'Mainnet' ? ('mainnet' as const) : ('testnet' as const);
  const explorerHref = flow.submittedHash
    ? NETWORKS[networkKey].explorerTxUrl(flow.submittedHash)
    : undefined;

  useEffect(() => {
    onCloseHandlerChange?.(flow.close);
    return () => onCloseHandlerChange?.(null);
  }, [flow.close, onCloseHandlerChange]);

  // Signing and submitting must finish; preparing a proof may be abandoned,
  // so it never blocks the shell. Publish before the next dismissal event.
  useLayoutEffect(() => {
    onWorkingChange?.(flow.working);
    return () => onWorkingChange?.(false);
  }, [flow.working, onWorkingChange]);

  const header = useMemo<PrivateFlowHeader | null>(() => {
    if (flow.submission) {
      return { title: flow.submission === 'broadcast' ? 'Withdrawal Sent' : 'Payment Status' };
    }
    if (stage === 'review') {
      return {
        title: 'Review Withdrawal',
        subtitle: 'Verify details before confirming',
        onBack: backToForm,
      };
    }
    return null;
  }, [backToForm, flow.submission, stage]);
  useReportToOwner(onHeaderChange, header, null);

  const dirty = flow.submission === null && (
    amount.trim() !== '' || trimmedRecipient !== (publicAddress ?? '')
  );
  useReportToOwner(onDirtyChange, dirty, false);

  return (
    <>
      {flow.submission ? (
        <PrivateSubmissionStatus
          status={flow.submission}
          title="Withdrawal Sent"
          explorerHref={explorerHref}
          onDone={flow.close}
        />
      ) : stage === 'review' ? (
        <PrivateActionReview
          draft={{ kind: 'withdraw', amount: amount.trim(), publicRecipient: trimmedRecipient, feePayer: feeAccount.feePayer }}
          review={flow.review}
          chained={flow.chained}
          chainProgress={flow.chainProgress}
          progress={flow.progress}
          disclosure={flow.disclosure}
          preparing={flow.preparing}
          working={flow.working}
          error={flow.error}
          errorCause={flow.errorCause}
          balanceBeforeStroops={BigInt(verifiedBalanceStroops)}
          confirmLabel="Confirm"
          onConfirm={() => void flow.submit()}
          onBack={backToForm}
          backInHeader={headerOwned}
        />
      ) : (
        <form onSubmit={submitForm}>
          <ModalBody>
            <Notice>
              {PRIVACY_ROW.withdraw} — the amount, recipient, and timing appear on Stellar.
            </Notice>
            {asset?.kind === 'stellar' ? (
              <Notice>
                The public recipient needs an existing authorized {asset.code} trustline. Issuer
                authorization, freeze and clawback controls still apply.
              </Notice>
            ) : null}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <span className="field-label">Asset</span>
                <PrivateAssetSelector
                  presentation="field"
                  balance={privateBalanceMax}
                />
              </div>
              <PrivateAmountField
                amount={amount}
                onAmount={setAmount}
                max={privateBalanceMax}
                code={code}
                issuer={asset?.issuer}
                isNative={asset?.kind === 'native'}
                error={amountCheck.error}
                showQuickAmounts={false}
                enterKeyHint="done"
              />
            </div>
            <PrivateQuickAmounts onAmount={setAmount} max={privateBalanceMax} />
            <Field
              label="Public Recipient"
              hint={trimmedRecipient === publicAddress ? 'Active account' : 'Custom G or C address'}
              error={
                trimmedRecipient && !recipientShapeOk
                  ? 'Enter a Stellar G or C address.'
                  : undefined
              }
            >
              <input
                type="text"
                className="input mono text-base sm:text-[13px]"
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="off"
                enterKeyHint="next"
                spellCheck={false}
                value={publicRecipient}
                onChange={event => setPublicRecipient(event.target.value)}
              />
            </Field>
            {flow.errorCause ?? flow.error ? (
              <PrivateActionError cause={flow.errorCause ?? new Error(flow.error ?? '')} />
            ) : null}
            <PrivateFeeAccountSelector value={feeAccount.feePayerAccountId} onChange={feeAccount.select} />
            <ModalFooter
              primary={
                <Button type="submit" disabled={amountCheck.stroops === null || !recipientShapeOk}>
                  Review Withdrawal
                </Button>
              }
            />
          </ModalBody>
        </form>
      )}
    </>
  );
}
