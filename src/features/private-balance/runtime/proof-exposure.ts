import type { PrivatePendingAction } from './types';

export class PrivateProofExposedError extends Error {
  constructor(cause?: unknown) {
    super('Payment status is unknown after proof sharing. Inputs remain reserved until canonical reconciliation.', { cause });
    this.name = 'PrivateProofExposedError';
  }
}

/** A spend proof authorizes its outputs independently of an envelope or signer.
 * Missing exposure metadata on legacy spends is conservatively treated as shared.
 * Only canonical inclusion or a conflicting canonical spend clears these notes;
 * envelope expiry, rejection and local cancellation do not revoke the proof. */
export function hasExposedPrivateSpend(action: {
  kind?: PrivatePendingAction['kind']; proofExposure?: 'local' | 'shared';
}): boolean {
  return (action.kind === 'transfer' || action.kind === 'withdraw') && action.proofExposure !== 'local';
}
