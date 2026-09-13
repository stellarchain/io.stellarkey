export type PrivateOutgoingHistoryMode = 'recoverable' | 'minimized';

/** Fresh, unconfigured sessions default to recoverable outgoing history. */
export function privateOutgoingHistoryMode(value: unknown): PrivateOutgoingHistoryMode {
  if (value === undefined || value === 'recoverable') return 'recoverable';
  if (value === 'minimized') return 'minimized';
  throw new Error('Private outgoing-history policy is invalid.');
}
