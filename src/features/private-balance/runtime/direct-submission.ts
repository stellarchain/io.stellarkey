/** Reject stale callers instead of silently changing the source of a payment. */
export function assertDirectPrivateSubmission(value: object): void {
  const input = value as {
    submissionMode?: unknown;
    relay?: unknown;
    relayPreparation?: unknown;
    relayChainStep?: unknown;
    peerFee?: unknown;
    privateFeeAtomic?: unknown;
  };
  if (
    (input.submissionMode !== undefined && input.submissionMode !== 'direct') ||
    input.relay != null || input.relayPreparation != null ||
    input.relayChainStep != null || input.peerFee != null ||
    (input.privateFeeAtomic !== undefined && input.privateFeeAtomic !== '0')
  ) {
    throw new Error('Peer relaying has been removed. Create a new direct payment review.');
  }
}
