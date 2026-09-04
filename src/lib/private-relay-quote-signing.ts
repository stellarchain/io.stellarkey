import { Buffer } from 'buffer';
import { sha256 } from '@noble/hashes/sha2.js';
import { signPrivateRelayQuoteAuthorization } from '@/features/private-balance/relay/account-authorization';
import { loadPrivateRelayPreferences } from '@/features/private-balance/relay/preferences';
import type { PrivateRelayRequest, PrivateRelayUnsignedQuote } from '@/features/private-balance/relay/protocol';
import { NETWORKS } from './stellar';
import { loadNetworkPref, loadVault, withSigningKeypair } from './vault';

/** The help-relay opt-in authorizes account-possession quotes, never transactions. */
export async function signOptedInPrivateRelayQuote(input: {
  request: PrivateRelayRequest;
  quote: PrivateRelayUnsignedQuote;
  expectedAccount: string;
  expectedNetworkId: string;
  expectedPoolContractId: string;
  signal: AbortSignal;
}): Promise<string> {
  const request = { ...input.request };
  const quote = { ...input.quote };
  const assertAuthorized = () => {
    if (input.signal.aborted) throw new DOMException('Private relay cancelled.', 'AbortError');
    const preferences = loadPrivateRelayPreferences();
    if (!preferences.helpRelay || preferences.feeAtomic !== quote.feeAtomic) {
      throw new Error('Private relay account authentication requires current helper consent');
    }
    const networkId = Buffer.from(sha256(new TextEncoder().encode(
      NETWORKS[loadNetworkPref()].networkPassphrase,
    ))).toString('hex');
    if (
      request.networkId !== networkId || request.networkId !== input.expectedNetworkId ||
      request.poolContractId !== input.expectedPoolContractId
    ) throw new Error('Private relay account authentication deployment changed');
    const vault = loadVault();
    const account = vault?.accounts.find(account => account.id === vault.activeAccountId);
    if (
      !account || account.watchOnly || account.hardware ||
      account.publicKey !== input.expectedAccount || account.publicKey !== quote.peerAccount
    ) throw new Error('Private relay account authentication requires the active software account');
    return account.id;
  };
  const accountId = assertAuthorized();
  return withSigningKeypair(accountId, signer => {
    // Decryption is asynchronous: recheck opt-in, active account, deployment and
    // cancellation immediately before the revocable signer is used.
    if (assertAuthorized() !== accountId) {
      throw new Error('Private relay account authentication account changed');
    }
    return signPrivateRelayQuoteAuthorization(request, quote, signer);
  });
}
