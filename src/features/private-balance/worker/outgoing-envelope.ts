import { OUTGOING_ENVELOPE_BYTES, randomBytes32, sealOutgoingEnvelope } from '@stellarkey/private-balance';
import { privateOutgoingHistoryMode, type PrivateOutgoingHistoryMode } from '../runtime/outgoing-history';

/**
 * Writing policy only. Incoming encryption and old outgoing keys are unchanged.
 * Opaque replacements must enter the action BEFORE its hash/proof is produced.
 */
export async function createPrivateOutgoingEnvelope(input: {
  mode?: PrivateOutgoingHistoryMode;
  outgoingViewingKey: Uint8Array;
  ephemeralPublicKey: Uint8Array;
  aad: Uint8Array;
  plaintext(): Uint8Array;
}): Promise<Uint8Array> {
  const mode = privateOutgoingHistoryMode(input.mode);
  if (mode === 'minimized') {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const envelope = globalThis.crypto.getRandomValues(new Uint8Array(OUTGOING_ENVELOPE_BYTES));
      if (envelope.some(byte => byte !== 0)) return envelope;
    }
    throw new Error('Private outgoing-envelope randomness is unavailable.');
  }
  const plaintext = input.plaintext();
  let entropy: Uint8Array | undefined;
  try {
    entropy = randomBytes32();
    return await sealOutgoingEnvelope(input.outgoingViewingKey, input.ephemeralPublicKey,
      plaintext, input.aad, entropy.slice(0, 12));
  } finally {
    plaintext.fill(0);
    entropy?.fill(0);
  }
}
