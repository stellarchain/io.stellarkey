'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Button, Modal, ModalHeader, Notice } from '@/components/ui';
import { usePrivateBalanceRuntimeData } from '@/hooks/usePrivateBalanceRuntime';
import { useWalletLedger } from '@/hooks/useWallet';
import { fmtAmount } from '@/lib/format';
import { triggerHaptic } from '@/lib/haptics';
import { NETWORKS } from '@/lib/stellar';
import { stroopsToAmount } from '@/lib/stellar-domain';
import { spendableAssetBalance } from '@/lib/transaction-intent';
import { humanizePrivateError, PRIVACY_ROW } from '../copy';
import { MAX_PRIVATE_ACTION_RESOURCE_FEE_STROOPS } from '../runtime/action-flow';
import { parsePrivateAmount } from '../runtime/coin-selection';
import { PrivateActionError } from './PrivateActionError';
import { PrivateActionReview } from './PrivateActionReview';
import { PrivateAssetSelector } from './PrivateAssetSelector';
import {
  PrivateAmountField,
  PrivateQuickAmounts,
  trimAmountInput,
} from './PrivateAmountField';
import { PrivateSubmissionStatus } from './PrivateSubmissionStatus';
import { usePrivateActionController } from './usePrivateActionController';

/**
 * Moves public funds into the private balance: same form pattern as the
 * public send (Max, fiat, quick chips), review with the proof preparing
 * underneath, one confirm, the shared success morph. Issued-asset trustline
 * facts stay visible — they are protocol requirements, not fine print.
 */
export function AddPrivateFunds({
  onClose,
  prefillAmount,
  onSubmitted,
  showAssetSelector = false,
  embedded = false,
  onCloseHandlerChange,
  onBeforeLeaveChange,
  onWorkingChange,
}: {
  onClose(): void;
  prefillAmount?: string;
  /** Fires when a confirmed deposit reaches the network. */
  onSubmitted?: () => void;
  showAssetSelector?: boolean;
  embedded?: boolean;
  onCloseHandlerChange?: (handler: (() => void) | null) => void;
  onBeforeLeaveChange?: (handler: (() => Promise<void>) | null) => void;
  onWorkingChange?: (working: boolean) => void;
}) {
  const { asset, verifiedBalanceStroops, networkLabel } = usePrivateBalanceRuntimeData();
  const { balances, minimumBalanceXlm, recommendedBaseFeeStroops } = useWalletLedger();
  const decimals = asset?.decimals ?? 7;
  const code = asset?.code ?? 'Asset';
  const [stage, setStage] = useState<'form' | 'review'>('form');
  const [amount, setAmount] = useState(prefillAmount ?? '');
  const flow = usePrivateActionController(onClose, onSubmitted);

  const publicBalance = useMemo(() => {
    if (!asset || !balances) return null;
    return (
      balances.find(candidate =>
        asset.kind === 'native'
          ? candidate.isNative
          : !candidate.isNative && candidate.code === asset.code && candidate.issuer === asset.issuer,
      ) ?? null
    );
  }, [asset, balances]);

  // Max mirrors the public send: the spendable balance, and for XLM also the
  // reserve plus this action's own maximum network fee.
  const maxAddable = useMemo(() => {
    if (!publicBalance) return null;
    if (!publicBalance.isNative) return trimAmountInput(spendableAssetBalance(publicBalance));
    if (minimumBalanceXlm === null) return null;
    const feeAllowance = stroopsToAmount(
      BigInt(recommendedBaseFeeStroops) + MAX_PRIVATE_ACTION_RESOURCE_FEE_STROOPS,
    );
    return trimAmountInput(
      spendableAssetBalance(publicBalance, [minimumBalanceXlm, feeAllowance]),
    );
  }, [minimumBalanceXlm, publicBalance, recommendedBaseFeeStroops]);

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
    if (amountCheck.stroops === null) return;
    triggerHaptic('selection');
    setStage('review');
    void flow.prepare({ kind: 'deposit', amount: amount.trim() });
  };

  const backToForm = () => {
    void flow.cancelPrepared();
    setStage('form');
  };

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

  useEffect(() => {
    onWorkingChange?.(flow.working);
    return () => onWorkingChange?.(false);
  }, [flow.working, onWorkingChange]);

  const content = (
    <>
      {!embedded && <ModalHeader
        title={
          flow.submission
            ? flow.submission === 'broadcast' ? 'Deposit Sent' : 'Payment Status'
            : stage === 'review'
              ? 'Review Add Funds'
              : 'Add Funds'
        }
        subtitle={
          flow.submission
            ? undefined
            : stage === 'review'
              ? 'Verify details before confirming'
              : `Move ${code} from your public balance`
        }
        onClose={flow.working ? undefined : flow.close}
      />}
      <div>
        {flow.submission ? (
          <PrivateSubmissionStatus
            status={flow.submission}
            title="Deposit Sent"
            explorerHref={explorerHref}
            onDone={flow.close}
          />
        ) : stage === 'review' ? (
          <PrivateActionReview
            draft={{ kind: 'deposit', amount: amount.trim() }}
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
          />
        ) : (
          <form className="space-y-4 p-4 sm:p-6" onSubmit={submitForm}>
            <Notice>{PRIVACY_ROW.deposit}.</Notice>
            {asset?.kind === 'stellar' ? (
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
              />
            )}
            {flow.errorCause ?? flow.error ? (
              <PrivateActionError cause={flow.errorCause ?? new Error(flow.error ?? '')} />
            ) : null}
            <Button
              type="submit"
              className="!mt-6 w-full"
              disabled={amountCheck.stroops === null}
            >
              Review Add Funds
            </Button>
          </form>
        )}
      </div>
    </>
  );

  if (embedded) return content;

  return (
    <Modal open onClose={flow.close} dismissable={!flow.working}>
      {content}
    </Modal>
  );
}
