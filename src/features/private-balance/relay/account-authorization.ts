import { Buffer } from 'buffer';
import { Keypair } from '@stellar/stellar-sdk';
import {
  decodePrivateRelayMessage,
  encodePrivateRelayMessage,
  type PrivateRelayQuote,
  type PrivateRelayRequest,
  type PrivateRelayUnsignedQuote,
} from './protocol';

const ACCOUNT_QUOTE_DOMAIN = 'stellarkey/private-relay/account-key-quote';

/**
 * Fixed-order, domain-separated UTF-8 JSON array, signing every request and quote
 * term. Only bounded canonical protocol values enter this account-possession
 * statement. It is neither a transaction hash nor a ledger authorization.
 */
function accountQuoteStatement(
  request: PrivateRelayRequest,
  quote: PrivateRelayUnsignedQuote,
  nowSeconds: number,
): Buffer {
  const canonicalRequest = decodePrivateRelayMessage(encodePrivateRelayMessage(request, nowSeconds), nowSeconds);
  const canonicalQuote = decodePrivateRelayMessage(encodePrivateRelayMessage({
    ...quote,
    accountSignature: '00'.repeat(64),
  }, nowSeconds), nowSeconds);
  if (
    canonicalRequest.type !== 'request' || canonicalQuote.type !== 'quote' ||
    canonicalRequest.requestId !== canonicalQuote.requestId ||
    canonicalRequest.expiresAt <= nowSeconds || canonicalQuote.expiresAt <= nowSeconds ||
    canonicalQuote.expiresAt > canonicalRequest.expiresAt
  ) throw new Error('Private relay account authentication context is invalid or expired');

  return Buffer.from(JSON.stringify([
    ACCOUNT_QUOTE_DOMAIN,
    canonicalRequest.version,
    canonicalRequest.networkId,
    canonicalRequest.poolContractId,
    canonicalRequest.actionKind,
    canonicalRequest.requestId,
    canonicalRequest.replyPubkey,
    canonicalRequest.nonce,
    canonicalRequest.expiresAt,
    canonicalQuote.quoteId,
    canonicalQuote.peerPubkey,
    canonicalQuote.peerAccount,
    canonicalQuote.feeAtomic,
    canonicalQuote.nonce,
    canonicalQuote.expiresAt,
  ]), 'utf8');
}

export function signPrivateRelayQuoteAuthorization(
  request: PrivateRelayRequest,
  quote: PrivateRelayUnsignedQuote,
  signer: Keypair,
  nowSeconds = Math.floor(Date.now() / 1_000),
): string {
  if (!signer.canSign() || signer.publicKey() !== quote.peerAccount) {
    throw new Error('Private relay account authentication key does not match the quoted account');
  }
  return Buffer.from(signer.sign(accountQuoteStatement(request, quote, nowSeconds))).toString('hex');
}

export function verifyPrivateRelayQuoteAuthorization(
  request: PrivateRelayRequest,
  quote: PrivateRelayQuote,
  nowSeconds = Math.floor(Date.now() / 1_000),
): boolean {
  try {
    const canonical = decodePrivateRelayMessage(encodePrivateRelayMessage(quote, nowSeconds), nowSeconds);
    if (canonical.type !== 'quote') return false;
    return Keypair.fromPublicKey(canonical.peerAccount).verify(
      accountQuoteStatement(request, canonical, nowSeconds),
      Buffer.from(canonical.accountSignature, 'hex'),
    );
  } catch {
    return false;
  }
}
