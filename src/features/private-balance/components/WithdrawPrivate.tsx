'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { Button, Field, Modal, ModalHeader, Notice } from '@/components/ui';
import { usePrivateBalanceRuntimeData } from '@/hooks/usePrivateBalanceRuntime';
import { fmtAmount } from '@/lib/format';
import { triggerHaptic } from '@/lib/haptics';
import { NETWORKS } from '@/lib/stellar';
import { humanizePrivateError, PRIVACY_ROW } from '../copy';
import { parsePrivateAmount } from '../runtime/coin-selection';
import { formatPrivateBalanceAmount } from '../runtime/selectors';
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
 * Moves private funds back to a public Stellar account — prefilled with the
 * active account. This leg is public, like any Stellar payment, and the copy
 * says so plainly; the flow itself mirrors the send exactly.
 */
export function WithdrawPrivate({
  onClose,
  onSubmitted,
}: {
  onClose(): void;
  /** Fires when a confirmed withdrawal reaches the network. */
  onSubmitted?: () => void;
}) {
  const { asset, publicAddress, verifiedBalanceStroops, networkLabel } =
    usePrivateBalanceRuntimeData();
  const decimals = asset?.decimals ?? 7;
  const code = asset?.code ?? 'Asset';
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
    triggerHaptic('selection');
    setStage('review');
    void flow.prepare({ kind: 'withdraw', amount: amount.trim(), publicRecipient: trimmedRecipient });
  };

  const backToForm = () => {
    void flow.cancelPrepared();
    setStage('form');
  };

  const networkKey = networkLabel === 'Mainnet' ? ('mainnet' as const) : ('testnet' as const);
  const explorerHref = flow.submittedHash
    ? NETWORKS[networkKey].explorerTxUrl(flow.submittedHash)
    : undefined;

  return (
    <Modal open onClose={flow.close} dismissable={!flow.working}>
      <ModalHeader
        title={
          flow.submission
            ? flow.submission === 'broadcast' ? 'Withdrawal Sent' : 'Payment Status'
            : stage === 'review'
              ? 'Review Withdrawal'
              : 'Withdraw Funds'
        }
        subtitle={
          flow.submission
            ? undefined
            : stage === 'review'
              ? 'Verify details before confirming'
              : `Move ${code} to your public balance`
        }
        onClose={flow.working ? undefined : flow.close}
      />
      {flow.submission ? (
        <PrivateSubmissionStatus
          status={flow.submission}
          title="Withdrawal Sent"
          explorerHref={explorerHref}
          onDone={flow.close}
        />
      ) : stage === 'review' ? (
        <PrivateActionReview
          draft={{ kind: 'withdraw', amount: amount.trim(), publicRecipient: trimmedRecipient }}
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
            />
          </div>
          <PrivateQuickAmounts onAmount={setAmount} max={privateBalanceMax} />
          <Field
            label="Public recipient"
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
              spellCheck={false}
              value={publicRecipient}
              onChange={event => setPublicRecipient(event.target.value)}
            />
          </Field>
          {flow.errorCause ?? flow.error ? (
            <PrivateActionError cause={flow.errorCause ?? new Error(flow.error ?? '')} />
          ) : null}
          <Button
            type="submit"
            className="!mt-6 w-full"
            disabled={amountCheck.stroops === null || !recipientShapeOk}
          >
            Review Withdrawal
          </Button>
        </form>
      )}
    </Modal>
  );
}
