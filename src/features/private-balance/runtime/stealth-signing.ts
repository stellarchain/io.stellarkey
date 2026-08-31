import { StrKey, type Transaction } from '@stellar/stellar-sdk';
import {
  signWithEd25519Scalar,
  type StealthRecipientKey,
} from '@stellarkey/private-balance';

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function signStealthTransaction(
  transaction: Transaction,
  key: StealthRecipientKey,
): Transaction {
  if (transaction.signatures.length !== 0) {
    throw new Error('Stealth transaction must be unsigned before scalar signing');
  }
  if (!(key.publicKey instanceof Uint8Array) || key.publicKey.length !== 32) {
    throw new Error('Stealth signing public key is invalid');
  }
  const publicKey = StrKey.encodeEd25519PublicKey(key.publicKey);
  if (transaction.source !== publicKey) {
    throw new Error('Stealth signing public key does not match the transaction source');
  }
  const signature = signWithEd25519Scalar(
    key.spendScalar,
    key.nonceKey,
    transaction.hash(),
  );
  transaction.addSignature(publicKey, base64(signature));
  return transaction;
}
