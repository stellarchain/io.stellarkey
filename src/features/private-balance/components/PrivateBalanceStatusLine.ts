import type { PrivateBalanceRuntimePhase } from '@/hooks/usePrivateBalanceRuntime';
import { fmtAmount } from '@/lib/format';
import { humanizePrivateError, STATUS_LINE } from '../copy';
import { formatPrivateBalanceAmount } from '../runtime/selectors';
import type { PrivatePendingAction } from '../runtime/types';

export interface PrivateStatusLine {
  label: string;
  tone: 'neutral' | 'caution';
}

/**
 * The card's single ambient status line (D1). Silence when healthy: a routine
 * background re-sync of an already-current wallet publishes `backgroundSyncing`
 * without flipping `phase`, so it renders nothing here. A line appears only
 * for first sync / catch-up / explicit refresh, safe errors, and
 * paused deposits.
 */
export function privateBalanceStatusLine(input: {
  phase: PrivateBalanceRuntimePhase;
  backgroundSyncing: boolean;
  syncProgress: { current: number; total: number } | null;
  error: string | null;
  depositsPaused: boolean | null;
}): PrivateStatusLine | null {
  const { phase } = input;
  if (phase === 'current') {
    if (input.depositsPaused === true) {
      return { label: STATUS_LINE.depositsPaused, tone: 'caution' };
    }
    // Routine background ticks stay invisible.
    return null;
  }
  if (phase === 'loading-artifacts') {
    return { label: STATUS_LINE.gettingReady, tone: 'neutral' };
  }
  if (phase === 'reading-meta' || phase === 'scanning-live') {
    return {
      label: input.syncProgress
        ? STATUS_LINE.updating(input.syncProgress.current, input.syncProgress.total)
        : STATUS_LINE.updating(1, 1),
      tone: 'neutral',
    };
  }
  if (phase === 'safe-error') {
    return {
      label: humanizePrivateError(input.error ?? 'Private payments stopped safely.').title,
      tone: 'caution',
    };
  }
  // disabled | locked render dedicated surfaces, never an ambient line.
  return null;
}

/**
 * A pending action is only "confirming" once something could actually be on
 * the network: it was signed, or a broadcast was attempted. A merely
 * prepared/reviewed action (the review screen is still open, or was
 * abandoned) must never read as an in-flight payment.
 */
export function isConfirmingPendingAction(
  action: Pick<PrivatePendingAction, 'status' | 'broadcastAttempts'>,
): boolean {
  return action.status === 'signed' || action.broadcastAttempts > 0;
}

/**
 * A chained send's internal consolidation step: a self-transfer that prepares
 * the balance. It is persisted as kind 'transfer' with no recipient
 * fingerprint (real transfers always journal one), and its protocol-true
 * balance delta is zero — so it must never display as an outgoing spend.
 */
export function isInternalPendingAction(
  action: Pick<PrivatePendingAction, 'kind' | 'recipientFingerprint'>,
): boolean {
  return action.kind === 'transfer' && !action.recipientFingerprint;
}

/**
 * The pending line under the balance while an action confirms:
 * "− 25 XLM confirming…". Amounts come from the durable `amountStroops`
 * (already net of change); at most one line, summed when several actions
 * confirm at once. Deposits confirm inward and show a plus. Internal
 * consolidation steps move nothing out, so they surface as
 * "Preparing balance…" with no amount; privacy mode masks the amounts.
 */
export function privateBalancePendingLine(
  pendingActions: ReadonlyArray<
    Pick<
      PrivatePendingAction,
      'kind' | 'status' | 'broadcastAttempts' | 'amountStroops' | 'recipientFingerprint'
    >
  >,
  decimals: number,
  code: string,
  options?: { privacyMode?: boolean },
): string | null {
  let outgoing = 0n;
  let incoming = 0n;
  let preparingBalance = false;
  for (const action of pendingActions) {
    if (!isConfirmingPendingAction(action)) continue;
    if (isInternalPendingAction(action)) {
      preparingBalance = true;
      continue;
    }
    if (!action.amountStroops) continue;
    if (action.kind === 'deposit') incoming += BigInt(action.amountStroops);
    else outgoing += BigInt(action.amountStroops);
  }
  const masked = options?.privacyMode === true;
  const amountText = (value: bigint) =>
    masked ? '••••••' : `${fmtAmount(formatPrivateBalanceAmount(value, decimals))} ${code}`;
  if (outgoing > 0n) return `− ${amountText(outgoing)} confirming…`;
  if (incoming > 0n) return `+ ${amountText(incoming)} confirming…`;
  if (preparingBalance) return 'Preparing balance…';
  return null;
}
