import { FeeBumpTransaction, Keypair, Transaction, TransactionBuilder } from '@stellar/stellar-sdk';
import { isPrivateFeePayer, MAX_PRIVATE_ACTION_RESOURCE_FEE_STROOPS, type PrivateFeePayer } from '../features/private-balance/runtime/fee-policy';

const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');

export interface PrivateFeeBumpLimits {
  feePayer?: PrivateFeePayer;
  maximumClassicFeeStroops?: bigint;
  maximumResourceFeeStroops?: bigint;
}

/** Validate the fee-only addition; the inner hash still binds all reviewed intent. */
export function privateFeeBumpAmounts(inner: Transaction, limits: PrivateFeeBumpLimits) {
  const envelope = inner.toEnvelope();
  if (!isPrivateFeePayer(limits.feePayer) || limits.feePayer.publicKey === inner.source ||
    envelope.type !== 'envelopeTypeTx' || envelope.value.tx.ext.type !== 'sorobanData' ||
    inner.operations.length !== 1) throw new Error('Private fee sponsorship requires the reviewed Soroban transaction and an alternate fee payer.');
  const resource = BigInt(envelope.value.tx.ext.value.resourceFee.toString());
  const base = BigInt(inner.fee) - resource;
  const classic = base * 2n;
  if (typeof limits.maximumClassicFeeStroops !== 'bigint' || typeof limits.maximumResourceFeeStroops !== 'bigint' ||
    base < 100n || base > 0xffff_ffffn || classic > limits.maximumClassicFeeStroops ||
    resource < 0n || resource > limits.maximumResourceFeeStroops ||
    limits.maximumResourceFeeStroops > MAX_PRIVATE_ACTION_RESOURCE_FEE_STROOPS) {
    throw new Error('Private fee sponsorship exceeds the reviewed fee cap.');
  }
  return { base, classic, resource, total: classic + resource };
}

function assertSingleSignature(transaction: Transaction | FeeBumpTransaction, publicKey: string) {
  const signer = Keypair.fromPublicKey(publicKey);
  const signature = transaction.signatures[0];
  const hint = signer.signatureHint();
  const actualHint = signature?.hint.toBytes();
  if (transaction.signatures.length !== 1 || !signature ||
    !actualHint || actualHint.length !== hint.length || actualHint.some((byte, index) => byte !== hint[index]) ||
    !signer.verify(transaction.hash(), signature.signature)) {
    throw new Error('Private fee sponsorship has an invalid account signature.');
  }
}

export function validatePrivateFeeBump(transaction: FeeBumpTransaction, input: PrivateFeeBumpLimits & {
  expectedInnerTransactionHash?: string;
}): void {
  if (!/^[0-9a-f]{64}$/.test(input.expectedInnerTransactionHash ?? '') ||
    hex(transaction.innerTransaction.hash()) !== input.expectedInnerTransactionHash ||
    transaction.feeSource !== input.feePayer?.publicKey) {
    throw new Error('Private fee sponsorship does not match the reviewed inner transaction or fee payer.');
  }
  const amounts = privateFeeBumpAmounts(transaction.innerTransaction, input);
  if (BigInt(transaction.fee) !== amounts.total) throw new Error('Private fee sponsorship changed the reviewed fee.');
  // Reconstruct to reject every outer field except the selected payer and exact
  // fee. The inner signature is part of the final outer transaction hash.
  const expected = TransactionBuilder.buildFeeBumpTransaction(
    input.feePayer!.publicKey, amounts.base.toString(), transaction.innerTransaction, transaction.networkPassphrase,
  );
  if (hex(expected.hash()) !== hex(transaction.hash())) throw new Error('Private fee sponsorship envelope changed.');
  assertSingleSignature(transaction.innerTransaction, transaction.innerTransaction.source);
  assertSingleSignature(transaction, input.feePayer!.publicKey);
}
