export type PrivateOutgoingHistoryMode = 'recoverable' | 'minimized';

/** Missing legacy preferences preserve the existing recovery contract. */
export function privateOutgoingHistoryMode(value: unknown): PrivateOutgoingHistoryMode {
  if (value === undefined || value === 'recoverable') return 'recoverable';
  if (value === 'minimized') return 'minimized';
  throw new Error('Private outgoing-history policy is invalid.');
}
