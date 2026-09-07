'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { AccountMark } from '@/components/AccountMark';
import { IconCheck, IconQrScan } from '@/components/icons';
import { Button, Field, Modal, ModalBody, ModalFooter, ModalHeader, QrScannerBox } from '@/components/ui';
import { usePrivateBalanceRuntimeData } from '@/hooks/usePrivateBalanceRuntime';
import { fmtAmount } from '@/lib/format';
import { requestPublicSend } from '@/lib/private-address';
import { NETWORKS } from '@/lib/stellar';
import { isValidPublicAddress } from '@/lib/vault';
import { humanizePrivateError } from '../copy';
import { parsePrivateAmount } from '../runtime/coin-selection';
import { formatPrivateBalanceAmount } from '../runtime/selectors';
import { loadPrivateRelayPreferences } from '../relay/preferences';
import { privateRelayRecipientDiversifier } from '../relay/recipient';
import type { PrivateRecentRecipient } from '../runtime/types';
import { PrivateActionError } from './PrivateActionError';
import { PrivateActionReview } from './PrivateActionReview';
import { PrivateAssetSelector } from './PrivateAssetSelector';
import {
  PrivateAmountField,
  PrivateQuickAmounts,
  trimAmountInput,
} from './PrivateAmountField';
import { PrivateSubmissionStatus } from './PrivateSubmissionStatus';
import { PrivateRelaySubmissionChoice } from './PrivateRelaySubmissionChoice';
import {
  usePrivateActionController,
  type PrivateSubmissionMode,
} from './usePrivateActionController';
import {
  useReportToOwner,
  type PrivateFlowHeader,
  type PrivateFlowHeaderChange,
} from './useReportToOwner';

const FIRST_SEND_FLAG = 'stellarkey.private.first-send-celebrated.v1';

const MEMO_PRESETS = ['Payment', 'Invoice', 'Gift', 'Tip'] as const;

const SEND_DEFAULT_HEADER: PrivateFlowHeader = {
  title: 'Send Privately',
  subtitle: 'Amount and recipient stay encrypted',
};

interface SendPrivateFlowProps {
  onClose(): void;
  prefill?: { recipient?: string };
  /** Fires when a confirmed send reaches the network (broadcast/ambiguous). */
  onSubmitted?: () => void;
  modeControl?: ReactNode;
  showAssetSelector?: boolean;
  onCloseHandlerChange?: (handler: (() => void) | null) => void;
  onBeforeLeaveChange?: (handler: (() => Promise<void>) | null) => void;
  onWorkingChange?: (working: boolean) => void;
  /** Stage-aware header for the owning shell; `null` means the form's default. */
  onHeaderChange?: PrivateFlowHeaderChange;
  /** True while the form holds a typed recipient, amount or memo that was not sent. */
  onDirtyChange?: (dirty: boolean) => void;
}

/**
 * The private send, mirroring the public SendModal exactly: one form screen,
 * then straight to the review screen where the proof is prepared underneath,
 * then the shared success morph. A fragmented balance folds into one
 * multi-step approval instead of a separate flow.
 *
 * Embedded (inside the shared Send sheet) the flow reports its close handler,
 * busy state, dirty state and stage header to the owner; standalone it owns
 * a shell that consumes the same contract.
 */
export function SendPrivate({
  open = true,
  embedded = false,
  onClose,
  ...flowProps
}: SendPrivateFlowProps & {
  open?: boolean;
  embedded?: boolean;
}) {
  const [closeHandler, setCloseHandler] = useState<(() => void) | null>(null);
  const [working, setWorking] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [header, setHeader] = useState<PrivateFlowHeader | null>(null);
  const reportCloseHandler = useCallback((handler: (() => void) | null) => {
    setCloseHandler(() => handler);
  }, []);

  if (embedded) return <SendPrivateFlow onClose={onClose} {...flowProps} />;

  const close = closeHandler ?? onClose;
  const shown = header ?? SEND_DEFAULT_HEADER;
  return (
    <Modal
      open={open}
      onClose={close}
      busy={working}
      busyReason="Wait for the payment to finish before closing."
      dirty={dirty}
    >
      <ModalHeader
        title={shown.title}
        subtitle={shown.subtitle}
        onBack={shown.onBack}
        onClose={close}
      />
      {open ? (
        <SendPrivateFlow
          onClose={onClose}
          prefill={flowProps.prefill}
          onSubmitted={flowProps.onSubmitted}
          modeControl={flowProps.modeControl}
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

function SendPrivateFlow({
  onClose,
  prefill,
  onSubmitted,
  modeControl,
  showAssetSelector = false,
  onCloseHandlerChange,
  onBeforeLeaveChange,
  onWorkingChange,
  onHeaderChange,
  onDirtyChange,
}: SendPrivateFlowProps) {
  const runtime = usePrivateBalanceRuntimeData();
  const { asset, validateRecipient, verifiedBalanceStroops, networkLabel } = runtime;
  const recentRecipients: PrivateRecentRecipient[] = runtime.recentPrivateRecipients;
  const decimals = asset?.decimals ?? 7;
  const code = asset?.code ?? 'Asset';
  const headerOwned = onHeaderChange !== undefined;

  const [stage, setStage] = useState<'form' | 'review'>('form');
  const [recipientAddress, setRecipientAddress] = useState(prefill?.recipient ?? '');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [submissionMode, setSubmissionMode] = useState<PrivateSubmissionMode>(() =>
    loadPrivateRelayPreferences().useRelay ? 'relay' : 'direct');
  const [showScanner, setShowScanner] = useState(false);
  const [pasteGuidance, setPasteGuidance] = useState<string | null>(null);
  const [recipientValidation, setRecipientValidation] = useState<{
    address: string;
    submissionMode: PrivateSubmissionMode;
    networkLabel: string;
    fingerprint: string | null;
    error: string | null;
  } | null>(null);
  const recipientFieldRef = useRef<HTMLInputElement>(null);
  const [celebrate, setCelebrate] = useState(false);
  const flow = usePrivateActionController(onClose, onSubmitted);

  const trimmedRecipient = recipientAddress.trim();
  const isPublicStellarAddress =
    isValidPublicAddress(trimmedRecipient) || /^C[A-Z2-7]{55}$/.test(trimmedRecipient);

  useEffect(() => {
    const address = recipientAddress.trim();
    let current = true;
    if (!address || isValidPublicAddress(address) || /^C[A-Z2-7]{55}$/.test(address)) {
      return () => {
        current = false;
      };
    }
    void validateRecipient(address)
      .then(async result => {
        if (submissionMode === 'relay') {
          await privateRelayRecipientDiversifier(address, networkLabel === 'Mainnet' ? 'skpay_' : 'tskpay_');
        }
        if (current) setRecipientValidation({ address, submissionMode, networkLabel, fingerprint: result.fingerprint, error: null });
      })
      .catch((cause: unknown) => {
        if (current) {
          setRecipientValidation({
            address,
            submissionMode,
            networkLabel,
            fingerprint: null,
            error: humanizePrivateError(cause).body,
          });
        }
      });
    return () => {
      current = false;
    };
  }, [networkLabel, recipientAddress, submissionMode, validateRecipient]);
  const currentValidation =
    recipientValidation?.address === trimmedRecipient && recipientValidation.submissionMode === submissionMode &&
    recipientValidation.networkLabel === networkLabel ? recipientValidation : null;
  const fingerprint = currentValidation?.fingerprint ?? null;
  const recipientError =
    !isPublicStellarAddress && trimmedRecipient ? currentValidation?.error ?? null : null;

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

  const memoBytes = useMemo(() => new TextEncoder().encode(memo.trim()).length, [memo]);
  const memoOk = memoBytes <= 32;
  const canReview =
    fingerprint !== null &&
    !recipientError &&
    amountCheck.stroops !== null &&
    memoOk &&
    !isPublicStellarAddress;

  const setRecipient = (value: string) => {
    setPasteGuidance(null);
    setRecipientAddress(value);
  };

  const pasteAddress = async () => {
    setPasteGuidance(null);
    try {
      const clipboard = navigator.clipboard;
      if (!clipboard?.readText) throw new Error('Clipboard read is unavailable');
      const value = await clipboard.readText();
      if (!value.trim()) {
        recipientFieldRef.current?.focus();
        setPasteGuidance('Clipboard has no text. Press ⌘V, Ctrl+V, or long-press the field and choose Paste.');
        return;
      }
      setRecipientAddress(value);
    } catch {
      recipientFieldRef.current?.focus();
      setPasteGuidance('Press ⌘V, Ctrl+V, or long-press the field and choose Paste.');
    }
  };

  const submitForm = (event: FormEvent) => {
    event.preventDefault();
    if (!canReview) return;
    setStage('review');
    // Straight to the review screen with the known draft; the proof prepares
    // underneath while the fee row shows its two calm labels.
    void flow.prepare(
      {
        kind: 'transfer',
        amount: amount.trim(),
        recipientAddress: trimmedRecipient,
        ...(memo.trim() ? { memo: memo.trim() } : {}),
      },
      submissionMode,
    );
  };

  // Back keeps the draft: it releases the preparation and returns to the form.
  const { cancelPrepared } = flow;
  const backToForm = useCallback(() => {
    void cancelPrepared();
    setStage('form');
  }, [cancelPrepared]);

  const confirmSend = () => {
    // Decide the first-ever celebration before the outcome lands so the
    // success moment mounts once with the right answer.
    let firstEver = false;
    try {
      firstEver = !window.localStorage.getItem(FIRST_SEND_FLAG);
    } catch {
      firstEver = false;
    }
    setCelebrate(firstEver);
    void flow.submit();
  };

  useEffect(() => {
    if (flow.submission !== 'broadcast' || !celebrate) return;
    try {
      window.localStorage.setItem(FIRST_SEND_FLAG, new Date().toISOString());
    } catch {
      // Storage unavailable — the confetti simply stays one-shot per session.
    }
  }, [celebrate, flow.submission]);

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

  const blocksNavigation = flow.working && !flow.chained?.relayApproval;
  useEffect(() => {
    onWorkingChange?.(blocksNavigation);
    return () => onWorkingChange?.(false);
  }, [blocksNavigation, onWorkingChange]);

  // The owner's single header follows the stage: review lifts Back into it
  // and the terminal screen names its outcome.
  const header = useMemo<PrivateFlowHeader | null>(() => {
    if (flow.submission) {
      return { title: flow.submission === 'broadcast' ? 'Sent Privately' : 'Payment Status' };
    }
    if (stage === 'review') {
      return {
        title: 'Review Private Send',
        subtitle: 'Verify details before confirming',
        onBack: backToForm,
      };
    }
    return null;
  }, [backToForm, flow.submission, stage]);
  useReportToOwner(onHeaderChange, header, null);

  const dirty = flow.submission === null && (
    trimmedRecipient !== (prefill?.recipient ?? '').trim() ||
    amount.trim() !== '' ||
    memo.trim() !== ''
  );
  useReportToOwner(onDirtyChange, dirty, false);

  return (
    <>
      {modeControl}
      {flow.submission ? (
        <PrivateSubmissionStatus
          status={flow.submission}
          title="Sent Privately"
          explorerHref={explorerHref}
          celebrate={celebrate}
          onDone={flow.close}
        />
      ) : stage === 'review' ? (
        <PrivateActionReview
          draft={{
            kind: 'transfer',
            amount: amount.trim(),
            fingerprint,
            recipientAddress: trimmedRecipient,
            ...(memo.trim() ? { memo: memo.trim() } : {}),
          }}
          review={flow.review}
          chained={flow.chained}
          chainProgress={flow.chainProgress}
          progress={flow.progress}
          relayProgress={flow.relayProgress}
          relayQuotes={flow.relayQuotes}
          disclosure={flow.disclosure}
          preparing={flow.preparing}
          working={flow.working}
          error={flow.error}
          errorCause={flow.errorCause}
          balanceBeforeStroops={BigInt(verifiedBalanceStroops)}
          confirmLabel="Confirm Send"
          onConfirm={confirmSend}
          onBack={backToForm}
          backInHeader={headerOwned}
          onSelectRelayQuote={quoteId => void flow.selectRelayQuote(quoteId)}
        />
      ) : (
        <form onSubmit={submitForm}>
          <ModalBody>
            {showAssetSelector ? (
              <>
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
              </>
            ) : (
              <PrivateAmountField
                amount={amount}
                onAmount={setAmount}
                max={privateBalanceMax}
                code={code}
                issuer={asset?.issuer}
                isNative={asset?.kind === 'native'}
                error={amountCheck.error}
              />
            )}
            <PrivateRelaySubmissionChoice
              value={submissionMode}
              onChange={setSubmissionMode}
            />
            <div>
              <div className="flex items-center justify-between">
                <label htmlFor="private-recipient" className="field-label !pb-0">
                  Private recipient
                </label>
                <div className="-mr-2 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void pasteAddress()}
                    className="flex min-h-11 items-center rounded-lg px-2 text-[13px] font-medium text-[#0A84FF] transition-colors active:bg-white/[0.06]"
                  >
                    Paste
                  </button>
                  <button
                    type="button"
                    aria-expanded={showScanner}
                    onClick={() => setShowScanner(current => !current)}
                    className="flex min-h-11 items-center gap-1 rounded-lg px-2 text-[13px] font-medium text-[#0A84FF] transition-colors active:bg-white/[0.06]"
                  >
                    <IconQrScan size={14} />
                    <span>{showScanner ? 'Hide QR Input' : 'Paste QR Payload'}</span>
                  </button>
                </div>
              </div>
              <input
                id="private-recipient"
                ref={recipientFieldRef}
                type="text"
                className="input mono text-base sm:text-[13px]"
                placeholder="tskpay_… or skpay_…"
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="off"
                enterKeyHint="next"
                spellCheck={false}
                value={recipientAddress}
                onPaste={() => setPasteGuidance(null)}
                onChange={event => setRecipient(event.target.value)}
              />
              {pasteGuidance ? (
                <p className="mt-1 text-[11.5px] leading-5 text-neutral-400" role="status" aria-live="polite">
                  {pasteGuidance}
                </p>
              ) : null}
              {isPublicStellarAddress ? (
                <div className="mt-2 space-y-2.5 rounded-2xl border border-[#0A84FF]/30 bg-[#0A84FF]/10 p-3.5 text-[12.5px] leading-relaxed text-neutral-200">
                  <p>That&apos;s a public Stellar address — continue in the regular Send?</p>
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full"
                    onClick={() => {
                      // One tap: hand the pasted address to the public send,
                      // prefilled, and close this flow.
                      requestPublicSend(trimmedRecipient);
                      flow.close();
                    }}
                  >
                    Use Regular Send
                  </Button>
                </div>
              ) : null}
              {fingerprint ? (
                <p className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-[#30D158]">
                  <AccountMark publicKey={fingerprint} size={16} />
                  <IconCheck size={12} aria-hidden="true" />
                  <span className="sr-only">Recipient verified,</span>
                  <span className="mono">{fingerprint}</span>
                </p>
              ) : null}
              {recipientError ? (
                <p role="alert" className="mt-1 text-[11.5px] text-[#FF453A]">{recipientError}</p>
              ) : null}
              {recentRecipients.length > 0 && !recipientAddress ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-[12px] text-neutral-500">Recent:</span>
                  {recentRecipients.map(recent => (
                    <button
                      key={recent.address}
                      type="button"
                      onClick={() => setRecipient(recent.address)}
                      className="chip flex min-h-11 items-center gap-1.5 text-[12px] text-neutral-300 hover:text-white"
                    >
                      <AccountMark publicKey={recent.fingerprint} size={14} />
                      <span className="mono">{recent.fingerprint}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {showScanner ? (
              <QrScannerBox
                onScan={text => {
                  setRecipient(text);
                  setShowScanner(false);
                }}
                onClose={() => setShowScanner(false)}
              />
            ) : null}

            <Field
              label="Private memo (optional)"
              hint={`${memoBytes}/32 bytes`}
              error={memoOk ? undefined : 'Private memos can hold up to 32 bytes.'}
            >
              <input
                type="text"
                className="input text-base sm:text-[13px]"
                maxLength={32}
                enterKeyHint="done"
                value={memo}
                onChange={event => setMemo(event.target.value)}
              />
            </Field>
            <div className="-mt-2 flex flex-wrap items-center gap-2">
              <span className="text-[12px] text-neutral-500">Presets:</span>
              {MEMO_PRESETS.map(preset => (
                <button
                  key={preset}
                  type="button"
                  aria-pressed={memo === preset}
                  onClick={() => setMemo(preset)}
                  className={`flex min-h-11 items-center rounded-xl px-3 text-[12px] font-medium transition-colors ${
                    memo === preset
                      ? 'bg-[#0A84FF] font-semibold text-white'
                      : 'bg-white/[0.06] text-neutral-400 hover:text-white'
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>

            {flow.errorCause ?? flow.error ? (
              <PrivateActionError cause={flow.errorCause ?? new Error(flow.error ?? '')} />
            ) : null}

            <ModalFooter
              primary={
                <Button type="submit" disabled={!canReview}>
                  Review Private Send
                </Button>
              }
            />
          </ModalBody>
        </form>
      )}
    </>
  );
}
