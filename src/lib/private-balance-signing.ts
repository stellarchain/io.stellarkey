import {
  FeeBumpTransaction,
  Keypair,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk';

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export interface ExactPrivateBalanceSigningRequest {
  envelopeXdr: string;
  expectedTransactionHash: string;
  expectedSource: string;
  networkPassphrase: string;
  secretKey: string;
}

export function signExactPrivateBalanceEnvelope(
  request: ExactPrivateBalanceSigningRequest,
): string {
  if (!/^[0-9a-f]{64}$/.test(request.expectedTransactionHash)) {
    throw new Error('Private Balance reviewed hash is invalid.');
  }
  const parsed = TransactionBuilder.fromXdr(request.envelopeXdr, request.networkPassphrase);
  if (parsed instanceof FeeBumpTransaction || !(parsed instanceof Transaction)) {
    throw new Error('Private Balance reviewed envelope type is unsupported.');
  }
  if (parsed.source !== request.expectedSource) {
    throw new Error('Private Balance reviewed envelope is not for the active account.');
  }
  if (parsed.signatures.length !== 0) {
    throw new Error('Private Balance reviewed envelope must be unsigned.');
  }
  if (hex(parsed.hash()) !== request.expectedTransactionHash) {
    throw new Error('Private Balance envelope does not match the reviewed hash.');
  }
  const signer = Keypair.fromSecret(request.secretKey);
  if (signer.publicKey() !== request.expectedSource) {
    throw new Error('Private Balance signing key does not match the active account.');
  }
  parsed.sign(signer);
  return parsed.toXdr();
}
