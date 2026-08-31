import {
  Asset,
  Memo,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  type Account,
  type Transaction,
} from '@stellar/stellar-sdk';
import {
  decodeStealthMetaAddress,
  deriveStealthRecipient,
  randomBytes32,
  type StealthNetwork,
} from '@stellarkey/private-balance';
import {
  amountToStroops,
  normalizeStellarAmount,
  stroopsToAmount,
} from '../../../lib/stellar-domain';

const ANNOUNCEMENT_STROOPS = 1n;
export const STEALTH_SWEEP_FEE_BUFFER_STROOPS = 1_000_000n;
const OPERATION_COUNT = 3n;
const MAX_INT64 = 9_223_372_036_854_775_807n;

export interface BuildStealthPaymentTransactionInput {
  sourceAccount: Account;
  metaAddress: string;
  network: StealthNetwork;
  networkPassphrase: string;
  announcerPublicKey: string;
  amount: string;
  baseReserveStroops: string;
  baseFeeStroops: string;
  ephemeralPrivateKey?: Uint8Array;
  timeoutSeconds?: number;
  nowSeconds?: number;
}

export interface BuiltStealthPaymentTransaction {
  transaction: Transaction;
  destinationPublicKey: string;
  ephemeralPublicKey: Uint8Array;
  reserveStroops: string;
  sweepFeeBufferStroops: string;
  amountStroops: string;
  announcementStroops: '1';
  networkFeeStroops: string;
  totalDebitStroops: string;
}

function positiveStroops(value: string, label: string): bigint {
  if (!/^[1-9][0-9]*$/u.test(value)) throw new Error(`${label} must be positive stroops`);
  const parsed = BigInt(value);
  if (parsed > MAX_INT64) throw new Error(`${label} exceeds Stellar's amount range`);
  return parsed;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function buildStealthPaymentTransaction(
  input: BuildStealthPaymentTransactionInput,
): Promise<BuiltStealthPaymentTransaction> {
  if (input.network !== 'testnet') {
    throw new Error('Private Payments are available on Stellar testnet only.');
  }
  if (input.networkPassphrase !== Networks.TESTNET) {
    throw new Error('Stealth payment network passphrase does not match the selected network');
  }
  if (!StrKey.isValidEd25519PublicKey(input.announcerPublicKey)) {
    throw new Error('Stealth payment announcer account is invalid');
  }
  const amountStroops = amountToStroops(input.amount);
  if (amountStroops <= 0n) throw new Error('Stealth payment amount must be positive');
  const baseReserveStroops = positiveStroops(
    input.baseReserveStroops,
    'Stealth payment base reserve',
  );
  const baseFeeStroops = positiveStroops(input.baseFeeStroops, 'Stealth payment base fee');
  const reserveStroops = baseReserveStroops * 2n;
  const networkFeeStroops = baseFeeStroops * OPERATION_COUNT;
  const oneTimeAccountStroops = reserveStroops + STEALTH_SWEEP_FEE_BUFFER_STROOPS;
  const totalDebitStroops = amountStroops + oneTimeAccountStroops + ANNOUNCEMENT_STROOPS + networkFeeStroops;
  if (totalDebitStroops > MAX_INT64) throw new Error('Stealth payment total exceeds Stellar\'s amount range');

  const timeoutSeconds = input.timeoutSeconds ?? 180;
  if (!Number.isSafeInteger(timeoutSeconds) || timeoutSeconds <= 0 || timeoutSeconds > 3_600) {
    throw new Error('Stealth payment timeout is invalid');
  }
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1_000);
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) {
    throw new Error('Stealth payment clock is invalid');
  }
  const metaAddress = await decodeStealthMetaAddress(input.metaAddress, input.network);
  const ephemeralPrivateKey = Uint8Array.from(input.ephemeralPrivateKey ?? randomBytes32());
  if (ephemeralPrivateKey.length !== 32) throw new Error('Stealth ephemeral private key must be 32 bytes');

  try {
    const recipient = await deriveStealthRecipient(
      metaAddress,
      ephemeralPrivateKey,
      input.network,
    );
    const destinationPublicKey = StrKey.encodeEd25519PublicKey(recipient.publicKey);
    const transaction = new TransactionBuilder(input.sourceAccount, {
      fee: baseFeeStroops.toString(),
      networkPassphrase: input.networkPassphrase,
    })
      .addOperation(Operation.createAccount({
        destination: destinationPublicKey,
        startingBalance: stroopsToAmount(oneTimeAccountStroops),
      }))
      .addOperation(Operation.payment({
        destination: destinationPublicKey,
        asset: Asset.native(),
        amount: normalizeStellarAmount(input.amount),
      }))
      .addOperation(Operation.payment({
        destination: input.announcerPublicKey,
        asset: Asset.native(),
        amount: stroopsToAmount(ANNOUNCEMENT_STROOPS),
      }))
      .addMemo(Memo.hash(hex(recipient.ephemeralPublicKey)))
      .setTimebounds(0, nowSeconds + timeoutSeconds)
      .build();
    return {
      transaction,
      destinationPublicKey,
      ephemeralPublicKey: recipient.ephemeralPublicKey.slice(),
      reserveStroops: reserveStroops.toString(),
      sweepFeeBufferStroops: STEALTH_SWEEP_FEE_BUFFER_STROOPS.toString(),
      amountStroops: amountStroops.toString(),
      announcementStroops: '1',
      networkFeeStroops: networkFeeStroops.toString(),
      totalDebitStroops: totalDebitStroops.toString(),
    };
  } finally {
    ephemeralPrivateKey.fill(0);
  }
}
