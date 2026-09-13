import type { PrivateActionProgressStage } from './runtime/action-flow';

/**
 * The single voice of Private Payments. Every user-facing string that is not
 * markup lives here so the flows stay consistent and protocol vocabulary
 * (pool, notes, consolidation, manifest, anchor, archive, RPC, worker…) never
 * reaches a screen. Raw runtime errors are precise for the journal and tests;
 * this module is what people read.
 */

export interface HumanizedPrivateError {
  /** Short, plain-words statement of what happened. */
  title: string;
  /** One or two sentences: the funds-are-safe fact and what happens next. */
  body: string;
  /** A hint the flow can turn into its one next action. */
  action?: 'retry' | 'add-funds' | 'lower-amount' | 'check-address' | 'take-over' | 'details';
  /** The raw message, for a collapsed "Technical details" disclosure. */
  technical: string;
}

interface ErrorRule {
  match: RegExp;
  humanize: (raw: string) => Omit<HumanizedPrivateError, 'technical'>;
}

/**
 * Ordered rules: first match wins. Matching is on the raw runtime message —
 * exact strings are asserted by the runtime tests, so prefixes are stable.
 */
const ERROR_RULES: ErrorRule[] = [
  {
    match: /previous private payment is unresolved/i,
    humanize: () => ({
      title: 'Blocked by an earlier payment',
      body: 'This new action has not started. The earlier payment’s status is still unknown; its inputs remain reserved until verified chain reconciliation. Do not reset the wallet or repeat that payment.',
    }),
  },
  {
    match: /status is unknown after proof sharing/i,
    humanize: () => ({
      title: 'Payment status unknown',
      body: 'A shared spend proof can still be submitted, even if no transaction was signed here. Cancelling or waiting for transaction expiry cannot revoke it. These inputs remain reserved until canonical reconciliation.',
    }),
  },
  {
    match: /^Private Balance simulated resource fee exceeds the approved cap\.$/i,
    humanize: () => ({
      title: 'Network fee exceeds the limit',
      body: 'Preparation stopped because the estimated network fee exceeds the approved limit. The limit has not been increased. Check private activity before starting another payment.',
      action: 'details',
    }),
  },
  {
    match: /fee-paying account.*(?:spendable public XLM|needs public XLM)/i,
    humanize: () => ({
      title: 'Not enough XLM for network fees',
      body: 'Choose a fee account with enough public XLM after its reserve and selling liabilities, or fund that account. Any already shared private proof remains held until its outcome is checked.',
      action: 'details',
    }),
  },
  {
    match: /fee-paying account.*(?:changed|unavailable|invalid)/i,
    humanize: () => ({
      title: 'Choose the fee account again',
      body: 'The selected fee account is no longer available for this review. Go back and choose an account again. Previously shared proofs remain held until their outcomes are checked.',
      action: 'details',
    }),
  },
  {
    match: /previous payment is still confirming/i,
    humanize: () => ({
      title: 'One moment',
      body: "Your previous payment is still confirming. It'll be ready in a moment.",
      action: 'retry',
    }),
  },
  {
    match: /insufficient for this amount/i,
    humanize: () => ({
      title: 'Not enough in your private balance',
      body: 'Nothing was sent. Lower the amount, or add funds from your public balance first.',
      action: 'add-funds',
    }),
  },
  {
    match: /^Insufficient public /,
    humanize: raw => ({
      title: 'Not enough in your public balance',
      body: raw.replace(/Private Balance/g, 'private balance'),
    }),
  },
  {
    match: /deposits are paused/i,
    humanize: () => ({
      title: 'Adding funds is paused',
      body: 'The network operator has paused deposits for now. Private sends and withdrawals still work, and your balance is unaffected.',
    }),
  },
  {
    match: /memo must not exceed/i,
    humanize: () => ({
      title: 'Memo is too long',
      body: 'Private memos can hold up to 32 bytes. Shorten it and try again.',
    }),
  },
  {
    match: /amount must be greater than zero/i,
    humanize: () => ({
      title: 'Enter an amount',
      body: 'The amount has to be above zero.',
      action: 'lower-amount',
    }),
  },
  {
    match: /at most 7 decimal places/i,
    humanize: () => ({
      title: 'Too many decimal places',
      body: 'Amounts support up to 7 decimal places.',
      action: 'lower-amount',
    }),
  },
  {
    match: /not a valid Stellar G or C address/i,
    humanize: () => ({
      title: "That address doesn't look right",
      body: 'Check the Stellar address and try again. Nothing was sent.',
      action: 'check-address',
    }),
  },
  {
    match: /receive address is for another network/i,
    humanize: () => ({
      title: 'Wrong network',
      body: 'This private address belongs to a different network. Ask the recipient for the address that matches yours.',
      action: 'check-address',
    }),
  },
  {
    match: /(receive address is not canonical|address is invalid|address checksum)/i,
    humanize: () => ({
      title: "This private address doesn't check out",
      body: 'It may have been copied incompletely. Ask the recipient to copy it again. Nothing was sent.',
      action: 'check-address',
    }),
  },
  {
    match: /active in another (StellarKey )?tab/i,
    humanize: () => ({
      title: 'Active in another tab',
      body: 'Private payments are running in another open tab. Continue there, or take over in this one.',
      action: 'take-over',
    }),
  },
  {
    match: /(in this tab before|in the active Private Balance tab)/i,
    humanize: () => ({
      title: 'Active in another tab',
      body: 'Private payments are running in another open tab. Continue there, or take over in this one.',
      action: 'take-over',
    }),
  },
  {
    match: /state changed in another wallet session/i,
    humanize: () => ({
      title: 'Another session got there first',
      body: 'Your private balance was updated from another session. Your money is safe — try again.',
      action: 'retry',
    }),
  },
  {
    match: /(root changed|root is too close to expiry|commitment cache is incomplete|Sync Private Balance before)/i,
    humanize: () => ({
      title: 'The network moved on',
      body: 'Your private balance refreshed while preparing. Your money is safe — review and confirm again.',
      action: 'retry',
    }),
  },
  {
    match: /contract advanced during sync/i,
    humanize: () => ({
      title: 'Still catching up',
      body: 'New activity kept arriving while updating. Your money is safe — this finishes on its own.',
      action: 'retry',
    }),
  },
  {
    match: /(RPC views disagree|contract heads did not agree|overlapping ledger|deployment checkpoint|independent origins)/i,
    humanize: () => ({
      title: "Network views don't agree",
      body: 'Your last checked balance is unchanged, but its current status is unknown. Retry after the providers agree.',
      action: 'retry',
    }),
  },
  {
    match: /witness RPC is unavailable/i,
    humanize: () => ({
      title: 'Independent check unavailable',
      body: 'Your last checked balance is unchanged. Recovery waits until the second network provider is available.',
      action: 'retry',
    }),
  },
  {
    match: /restoration review expired|Create a new approval/i,
    humanize: () => ({
      title: 'That approval expired',
      body: 'Nothing was signed. Review the fees again to continue.',
      action: 'retry',
    }),
  },
  {
    match: /private (action|proof sharing) cancelled after its wallet context changed/i,
    humanize: () => ({
      title: 'The wallet session changed',
      body: 'This action stopped updating in this session. Check private activity for any pending payment before starting another.',
      action: 'details',
    }),
  },
  {
    match: /worker (is not ready|is unavailable|terminated|crashed|stopped responding|returned an unreadable|returned a mismatched|session is not initialized)/i,
    humanize: () => ({
      title: 'Something interrupted the preparation',
      body: 'The local proof worker stopped. Sync private payments to restart it, then check activity for any pending payment before starting another.',
      action: 'details',
    }),
  },
  {
    match: /was not signed/i,
    humanize: () => ({
      title: "The payment wasn't signed",
      body: 'Nothing left your wallet. You can try again whenever you like.',
      action: 'retry',
    }),
  },
  {
    match: /(cannot be cancelled|cannot be released)/i,
    humanize: () => ({
      title: 'This payment is already on its way',
      body: "It can't be cancelled once sent. Its result appears in your activity shortly.",
      action: 'details',
    }),
  },
  {
    match: /(archive|page|checkpoint|manifest|artifact|nullifier|Merkle|transcript|anchor)/i,
    humanize: () => ({
      title: 'Private payments stopped safely',
      body: "Your money is safe — nothing was sent. Updating usually clears this; if it keeps happening, open Details.",
      action: 'details',
    }),
  },
];

export function humanizePrivateError(cause: unknown): HumanizedPrivateError {
  const raw = cause instanceof Error ? cause.message : String(cause ?? 'Unknown error');
  for (const rule of ERROR_RULES) {
    if (rule.match.test(raw)) return { ...rule.humanize(raw), technical: raw };
  }
  return {
    title: "That didn't work",
    body: 'The payment status could not be determined here. Check private activity before starting another payment, and open Details for more information.',
    action: 'details',
    technical: raw,
  };
}

/**
 * The 7 pipeline stages collapse to two user-facing labels: everything before
 * the proof is "Preparing…"; the proof and its fee simulation are the long,
 * on-device part worth naming.
 */
export function progressLabel(stage: PrivateActionProgressStage): string {
  switch (stage) {
    case 'proving-locally':
    case 'simulating':
      return 'Securing your payment…';
    case 'ready-to-review':
      return 'Ready.';
    default:
      return 'Preparing…';
  }
}

/** Terminal copy for an inconclusive network response. */
export const AMBIGUOUS_OUTCOME = {
  title: "We couldn't confirm this payment yet",
  body: "Your money is safe — we'll keep checking, and you can close this.",
} as const;

/** Review-screen privacy rows, one sentence each. */
export const PRIVACY_ROW = {
  transfer: 'Amount and recipient are encrypted',
  deposit: 'Adding funds is public; the resulting private balance is not',
  withdraw: 'Withdrawals are public, like any Stellar payment',
} as const;

/** Collapsed-details disclosure sentences (the honest edges). */
export const WHAT_STAYS_PUBLIC = {
  transfer:
    'The network fee, the fee-paying account, and the timing are public. The amount and recipient stay inside encrypted outputs.',
  deposit:
    'This deposit publicly shows its amount, source account, and timing on Stellar. The private balance it creates stays encrypted.',
  withdraw:
    'This withdrawal publicly shows its amount, recipient, and timing on Stellar, like any public payment.',
} as const;

/** Ambient status line copy, keyed by what the wallet is doing. */
export const STATUS_LINE = {
  gettingReady: 'Getting ready…',
  updating: (done: number | bigint, total: number | bigint) =>
    total > 1 ? `Updating… ${(done < total ? done : total)} of ${total}` : 'Updating…',
  restoreNeeded: 'Action needed · Restore access',
  restoring: (step: number, total: number) => `Restoring… step ${step} of ${total}`,
  statusUnknown: 'Status unknown · last checked balance unchanged',
  depositsPaused: 'Deposits paused · withdrawals still work',
} as const;

/** Human labels for verified private activity rows. */
export function activityKindLabel(kind: 'deposit' | 'transfer' | 'withdraw', direction: 'inflow' | 'outflow' | 'internal'): string {
  if (kind === 'deposit') return 'Added privately';
  if (kind === 'withdraw') return 'Moved to public';
  if (direction === 'internal') return 'Prepared balance';
  return direction === 'inflow' ? 'Received privately' : 'Sent privately';
}
