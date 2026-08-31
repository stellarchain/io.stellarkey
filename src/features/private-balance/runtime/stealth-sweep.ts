import {
  FeeBumpTransaction,
  StrKey,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import {
  deriveStealthMetaKeys,
  deriveStealthRecipientKey,
  type StealthNetwork,
  type X25519Implementation,
} from '@stellarkey/private-balance';
import { signStealthTransaction } from './stealth-signing';

const HEX_32 = /^[0-9a-f]{64}$/u;

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function bytes32(value: string, name: string): Uint8Array {
  if (!HEX_32.test(value)) throw new Error(`${name} is invalid`);
  return Uint8Array.from(value.match(/../gu) ?? [], byte => Number.parseInt(byte, 16));
}

export async function signStealthSweepEnvelope(input: {
  rootKey: Uint8Array;
  payment: {
    destinationPublicKey: string;
    ephemeralPublicKey: string;
  };
  network: StealthNetwork;
  networkPassphrase: string;
  envelopeXdr: string;
  expectedTransactionHash: string;
  implementation?: X25519Implementation;
}): Promise<string> {
  if (!(input.rootKey instanceof Uint8Array) || input.rootKey.length !== 32) {
    throw new Error('Stealth sweep root key is invalid');
  }
  if (!StrKey.isValidEd25519PublicKey(input.payment.destinationPublicKey)) {
    throw new Error('Stealth sweep destination is invalid');
  }
  if (!HEX_32.test(input.expectedTransactionHash)) {
    throw new Error('Stealth sweep review hash is invalid');
  }
  const transaction = TransactionBuilder.fromXdr(input.envelopeXdr, input.networkPassphrase);
  if (
    transaction instanceof FeeBumpTransaction ||
    !(transaction instanceof Transaction) ||
    transaction.signatures.length !== 0 ||
    transaction.source !== input.payment.destinationPublicKey ||
    hex(transaction.hash()) !== input.expectedTransactionHash
  ) {
    throw new Error('Stealth sweep envelope does not match the reviewed destination or source');
  }

  const ephemeralPublicKey = bytes32(
    input.payment.ephemeralPublicKey,
    'Stealth sweep announcement key',
  );
  const metaKeys = deriveStealthMetaKeys(input.rootKey, input.network);
  let recipient: Awaited<ReturnType<typeof deriveStealthRecipientKey>> | null = null;
  try {
    recipient = await deriveStealthRecipientKey(
      metaKeys,
      ephemeralPublicKey,
      input.network,
      input.implementation,
    );
    const recoveredPublicKey = StrKey.encodeEd25519PublicKey(recipient.publicKey);
    if (recoveredPublicKey !== input.payment.destinationPublicKey) {
      throw new Error('Stealth sweep destination does not belong to this wallet');
    }
    return signStealthTransaction(transaction, recipient).toXdr();
  } finally {
    ephemeralPublicKey.fill(0);
    metaKeys.scanPrivateKey.fill(0);
    metaKeys.scanPublicKey.fill(0);
    metaKeys.spendPublicKey.fill(0);
    metaKeys.nonceKey.fill(0);
    recipient?.publicKey.fill(0);
    recipient?.nonceKey.fill(0);
  }
}
