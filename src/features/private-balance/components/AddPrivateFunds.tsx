'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type FormEvent } from 'react';
import { Button, Modal, ModalBody, ModalFooter, ModalHeader, Notice } from '@/components/ui';
import { usePrivateBalanceRuntimeData } from '@/hooks/usePrivateBalanceRuntime';
import { useWalletLedger } from '@/hooks/useWallet';
import { fmtAmount } from '@/lib/format';
import { NETWORKS } from '@/lib/stellar';
import { stroopsToAmount } from '@/lib/stellar-domain';
import { spendableAssetBalance } from '@/lib/transaction-intent';
import { humanizePrivateError, PRIVACY_ROW } from '../copy';
import { PrivatePrivacyAdvisory } from './PrivatePrivacyAdvisory';
import { MAX_PRIVATE_ACTION_RESOURCE_FEE_STROOPS } from '../runtime/action-flow';
import { parsePrivateAmount } from '../runtime/coin-selection';
import { privateBalanceAssetMatchesPublicBalance } from '@/lib/private-balance-assets';
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
import { usePrivateActionController } from './usePrivateActionController';
import {
  useReportToOwner,
  type PrivateFlowHeader,
  type PrivateFlowHeaderChange,
} from './useReportToOwner';

interface AddPrivateFundsFlowProps {
  onClose(): void;
  prefillAmount?: string;
  /** Fires when a confirmed deposit reaches the network. */
  onSubmitted?: () => void;
  showAssetSelector?: boolean;
  onCloseHandlerChange?: (handler: (() => void) | null) => void;
  onBeforeLeaveChange?: (handler: (() => Promise<void>) | null) => void;
  onWorkingChange?: (working: boolean) => void;
  /** Stage-aware header for the owning shell; `null` means the form's default. */
  onHeaderChange?: PrivateFlowHeaderChange;
  /** True while an amount is typed that was not sent. */
  onDirtyChange?: (dirty: boolean) => void;
}

/**
 * Moves public funds into the private balance: same form pattern as the
 * public send (Max, fiat, quick chips), review with the proof preparing
 * underneath, one confirm, the shared success morph. Issued-asset trustline
 * facts stay visible — they are protocol requirements, not fine print.
 *
 * Embedded (inside the shared Add sheet) the flow reports its close handler,
 * busy state, dirty state and stage header to the owner; standalone it owns
 * a shell that consumes the same contract.
 */
export function AddPrivateFunds({
  open = true,
  embedded = false,
  onClose,
  ...flowProps
}: AddPrivateFundsFlowProps & {
  open?: boolean;
  embedded?: boolean;
}) {
  const { asset } = usePrivateBalanceRuntimeData();
  const [closeHandler, setCloseHandler] = useState<(() => void) | null>(null);
  const [working, setWorking] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [header, setHeader] = useState<PrivateFlowHeader | null>(null);
  const reportCloseHandler = useCallback((handler: (() => void) | null) => {
    setCloseHandler(() => handler);
  }, []);

  if (embedded) return <AddPrivateFundsFlow onClose={onClose} {...flowProps} />;

  const code = asset?.code ?? 'Asset';
  const close = closeHandler ?? onClose;
  const shown = header ?? { title: 'Add Funds', subtitle: `Move ${code} from your public balance` };
  return (
    <Modal
      open={open}
      onClose={close}
      busy={working}
      busyReason="Wait for the deposit to finish before closing."
      dirty={dirty}
    >
      <ModalHeader
        title={shown.title}
        subtitle={shown.subtitle}
        onBack={shown.onBack}
        onClose={close}
      />
      {open ? (
        <AddPrivateFundsFlow
          onClose={onClose}
          prefillAmount={flowProps.prefillAmount}
          onSubmitted={flowProps.onSubmitted}
          showAssetSelector={flowProps.showAssetSelector}
          onCloseHandlerChange={reportCloseHandler}
          onWorkingChange={setWorking}
          onHeaderChange={setHeader}
          onDirtyChange={setDirty}
        />
      ) : null}
    </Modal>
  );
}

function AddPrivateFundsFlow({
  onClose,
  prefillAmount,
  onSubmitted,
  showAssetSelector = false,
  onCloseHandlerChange,
  onBeforeLeaveChange,
  onWorkingChange,
  onHeaderChange,
  onDirtyChange,
}: AddPrivateFundsFlowProps) {
  const { asset, verifiedBalanceStroops, networkLabel } = usePrivateBalanceRuntimeData();
  const feeAccount = usePrivateFeeAccount();
  const { balances, minimumBalanceXlm, recommendedBaseFeeStroops } = useWalletLedger();
  const decimals = asset?.decimals ?? 7;
  const code = asset?.code ?? 'Asset';
  const exitOnly = asset?.status === 'exit-only';
  const headerOwned = onHeaderChange !== undefined;
  const [stage, setStage] = useState<'form' | 'review'>('form');
  const [amount, setAmount] = useState(prefillAmount ?? '');
  const flow = usePrivateActionController(onClose, onSubmitted);

  const publicBalance = useMemo(() => {
    if (!asset || !balances) return null;
    return (
      balances.find(candidate => privateBalanceAssetMatchesPublicBalance(
        asset,
        candidate,
        NETWORKS[networkLabel === 'Mainnet' ? 'mainnet' : 'testnet'].networkPassphrase,
      )) ?? null
    );
  }, [asset, balances, networkLabel]);

  // Max mirrors the public send: the spendable balance, and for XLM also the
  // reserve plus this action's own maximum network fee.
  const maxAddable = useMemo(() => {
    if (publicBalance === null) return null;
    if (!publicBalance.isNative) return trimAmountInput(spendableAssetBalance(publicBalance));
    if (minimumBalanceXlm === null) return null;
    const feeAllowance = stroopsToAmount(
      feeAccount.feePayer ? 0n : BigInt(recommendedBaseFeeStroops) + MAX_PRIVATE_ACTION_RESOURCE_FEE_STROOPS,
    );
    return trimAmountInput(
      spendableAssetBalance(publicBalance, [minimumBalanceXlm, feeAllowance]),
    );
  }, [minimumBalanceXlm, publicBalance, recommendedBaseFeeStroops, feeAccount.feePayer]);

  const amountCheck = useMemo<{ stroops: bigint | null; error: string | null }>(() => {
    const trimmed = amount.trim();
    if (!trimmed) return { stroops: null, error: null };
    try {
      const stroops = parsePrivateAmount(trimmed, decimals);
      if (maxAddable !== null) {
        let maxStroops = BigInt(0);
        try {
          maxStroops = parsePrivateAmount(maxAddable, decimals);
        } catch {
          maxStroops = BigInt(0);
        }
        if (stroops > maxStroops) {
          return {
            stroops: null,
            error: `Your public balance covers up to ${fmtAmount(maxAddable)} ${code}.`,
          };
        }
      }
      return { stroops, error: null };
    } catch (cause: unknown) {
      return { stroops: null, error: humanizePrivateError(cause).body };
    }
  }, [amount, code, decimals, maxAddable]);

  const submitForm = (event: FormEvent) => {
    event.preventDefault();
    if (amountCheck.stroops === null || exitOnly) return;
    const shell = event.currentTarget.closest<HTMLElement>('[data-modal-shell]');
    if (shell && !shell.closest('[inert]')) shell.focus({ preventScroll: true });
    setStage('review');
    void flow.prepare({ kind: 'deposit', amount: amount.trim(), feePayerAccountId: feeAccount.feePayerAccountId || undefined });
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

  useEffect(() => {
    onBeforeLeaveChange?.(flow.cancelPrepared);
    return () => onBeforeLeaveChange?.(null);
  }, [flow.cancelPrepared, onBeforeLeaveChange]);

  useLayoutEffect(() => {
    onWorkingChange?.(flow.working);
    return () => onWorkingChange?.(false);
  }, [flow.working, onWorkingChange]);

  // The owner's single header follows the stage: review lifts Back into it
  // and the terminal screen names its outcome.
  const header = useMemo<PrivateFlowHeader | null>(() => {
    if (flow.submission) {
      return { title: flow.submission === 'broadcast' ? 'Deposit Sent' : 'Payment Status' };
    }
    if (stage === 'review') {
      return {
        title: 'Review Add Funds',
        subtitle: 'Verify details before confirming',
        onBack: backToForm,
      };
    }
    return null;
  }, [backToForm, flow.submission, stage]);
  useReportToOwner(onHeaderChange, header, null);

  const dirty = flow.submission === null && amount.trim() !== (prefillAmount ?? '').trim();
  useReportToOwner(onDirtyChange, dirty, false);

  return (
    <>
      {flow.submission ? (
        <PrivateSubmissionStatus
          status={flow.submission}
          title="Deposit Sent"
          explorerHref={explorerHref}
          onDone={flow.close}
        />
      ) : stage === 'review' ? (
        <PrivateActionReview
          draft={{ kind: 'deposit', amount: amount.trim(), feePayer: feeAccount.feePayer }}
          review={flow.review}
          chained={flow.chained}
          chainProgress={flow.chainProgress}
          progress={flow.progress}
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
            <Notice>{PRIVACY_ROW.deposit}.</Notice>
            {exitOnly ? (
              <Notice>
                {code} is exit-only. You can transfer or withdraw existing private funds, but cannot add more.
              </Notice>
            ) : null}
            {asset && asset.kind !== 'native' ? (
              <Notice>
                Your public account needs an authorized {asset.code} trustline and sufficient{' '}
                {asset.code} balance. Issuer authorization, freeze and clawback controls still apply.
              </Notice>
            ) : null}
            {showAssetSelector ? (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <span className="field-label">Asset</span>
                    <PrivateAssetSelector
                      presentation="field"
                      balance={publicBalance?.balance ?? null}
                      balanceScope="public"
                    />
                  </div>
                  <PrivateAmountField
                    amount={amount}
                    onAmount={setAmount}
                    max={maxAddable}
                    code={code}
                    issuer={asset?.issuer}
                    isNative={asset?.kind === 'native'}
                    error={amountCheck.error}
                    showQuickAmounts={false}
                    enterKeyHint="done"
                  />
                </div>
                <PrivateQuickAmounts onAmount={setAmount} max={maxAddable} />
              </>
            ) : (
              <PrivateAmountField
                amount={amount}
                onAmount={setAmount}
                max={maxAddable}
                code={code}
                issuer={asset?.issuer}
                isNative={asset?.kind === 'native'}
                error={amountCheck.error}
                enterKeyHint="done"
              />
            )}
            <PrivatePrivacyAdvisory kind="deposit" amount={amountCheck.stroops} />
            {flow.errorCause ?? flow.error ? (
              <PrivateActionError cause={flow.errorCause ?? new Error(flow.error ?? '')} />
            ) : null}
            <PrivateFeeAccountSelector value={feeAccount.feePayerAccountId} onChange={feeAccount.select} />
            <ModalFooter
              primary={
                <Button type="submit" disabled={amountCheck.stroops === null || exitOnly}>
                  Review Add Funds
                </Button>
              }
            />
          </ModalBody>
        </form>
      )}
    </>
  );
}
