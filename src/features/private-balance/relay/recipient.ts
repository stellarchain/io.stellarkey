import { decodePrivateAddress } from '@stellarkey/private-balance';

/** Relay payouts must use a fresh, non-default address. Never rotate a recipient on their behalf. */
export async function privateRelayRecipientDiversifier(address: string, prefix: 'skpay_' | 'tskpay_'): Promise<string> {
  const decoded = await decodePrivateAddress(address, prefix);
  try {
    if (decoded.diversifier.every(byte => byte === 0)) {
      throw new Error('Private relay requires a fresh recipient address.');
    }
    return Array.from(decoded.diversifier, byte => byte.toString(16).padStart(2, '0')).join('');
  } finally {
    decoded.diversifier.fill(0);
  }
}
