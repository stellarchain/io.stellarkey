import {
  Account,
  FeeBumpTransaction,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import type { NetworkKey } from '../../../lib/stellar';
import { NETWORKS } from '../../../lib/stellar';
import type { HardwareSigner } from '../../../lib/hardware';
import {
  resolveSource,
  signAndSubmit,
} from '../../../lib/api';
import type {
  SubmissionPreparedCallback,
  SubmissionResult,
} from '../../../lib/submission';
import { buildStealthPaymentTransaction } from './stealth-transaction';
import {
  loadExpectedPrivateBalanceCatalogue,
  loadPrivateBalanceDeployments,
} from '../../../lib/private-balance-assets';
import { privateBalanceAvailability } from '../../../lib/private-balance-manifest';
import { ALLOW_PRIVATE_BALANCE_DEVELOPMENT_FIXTURE } from '../../../lib/private-balance-expected-manifest';

const HASH_HEX = /^[0-9a-f]{64}$/u;

function assertPrivatePaymentsTestnet(network: NetworkKey): void {
  if (network !== 'testnet') {
    throw new Error('Private Payments are available on Stellar testnet only.');
  }
}

export interface PrepareStealthPaymentInput {
  sourcePublicKey: string;
  metaAddress: string;
  network: NetworkKey;
  announcerPublicKey: string;
  amount: string;
  baseFeeStroops: number;
  loadSourceSequence(sourcePublicKey: string, network: NetworkKey): Promise<string>;
  loadBaseReserveStroops(network: NetworkKey): Promise<string>;
  ephemeralPrivateKey?: Uint8Array;
  nowSeconds?: number;
}

export interface PreparedStealthPayment {
  envelopeXdr: string;
  transactionHash: string;
  sourcePublicKey: string;
  destinationPublicKey: string;
  metaAddress: string;
  network: NetworkKey;
  amountStroops: string;
  reserveStroops: string;
  sweepFeeBufferStroops: string;
  announcementStroops: '1';
  networkFeeStroops: string;
  totalDebitStroops: string;
  expiresAt: number;
}

function transactionHash(transaction: Transaction): string {
  return Array.from(transaction.hash(), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function loadStealthPaymentAnnouncer(network: NetworkKey): Promise<string> {
  assertPrivatePaymentsTestnet(network);
  const { catalogue } = await loadExpectedPrivateBalanceCatalogue();
  const deployments = await loadPrivateBalanceDeployments({ catalogue, network });
  const native = deployments.find(deployment => deployment.asset.kind === 'native');
  if (!native) throw new Error('No verified native private-payment deployment is available.');
  const availability = privateBalanceAvailability(native.manifest, network, {
    allowDevelopmentFixture: ALLOW_PRIVATE_BALANCE_DEVELOPMENT_FIXTURE,
  });
  if (!availability.ready) {
    throw new Error(availability.reason ?? 'Private payments are unavailable on this network.');
  }
  return native.manifest.stealthAnnouncerAddress;
}

export async function prepareStealthPayment(
  input: PrepareStealthPaymentInput,
): Promise<PreparedStealthPayment> {
  assertPrivatePaymentsTestnet(input.network);
  if (!Number.isSafeInteger(input.baseFeeStroops) || input.baseFeeStroops <= 0) {
    throw new Error('Stealth payment base fee is invalid');
  }
  const [sequence, baseReserveStroops] = await Promise.all([
    input.loadSourceSequence(input.sourcePublicKey, input.network),
    input.loadBaseReserveStroops(input.network),
  ]);
  if (!/^(?:0|[1-9][0-9]*)$/u.test(sequence)) {
    throw new Error('Horizon returned an invalid source sequence for the stealth payment');
  }
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1_000);
  const built = await buildStealthPaymentTransaction({
    sourceAccount: new Account(input.sourcePublicKey, sequence),
    metaAddress: input.metaAddress,
    network: input.network,
    networkPassphrase: NETWORKS[input.network].networkPassphrase,
    announcerPublicKey: input.announcerPublicKey,
    amount: input.amount,
    baseReserveStroops,
    baseFeeStroops: String(input.baseFeeStroops),
    ephemeralPrivateKey: input.ephemeralPrivateKey,
    nowSeconds,
  });
  const expiresAt = Number(built.transaction.timeBounds?.maxTime);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= nowSeconds) {
    throw new Error('Stealth payment review expiry is invalid');
  }
  return {
    envelopeXdr: built.transaction.toXdr(),
    transactionHash: transactionHash(built.transaction),
    sourcePublicKey: input.sourcePublicKey,
    destinationPublicKey: built.destinationPublicKey,
    metaAddress: input.metaAddress,
    network: input.network,
    amountStroops: built.amountStroops,
    reserveStroops: built.reserveStroops,
    sweepFeeBufferStroops: built.sweepFeeBufferStroops,
    announcementStroops: built.announcementStroops,
    networkFeeStroops: built.networkFeeStroops,
    totalDebitStroops: built.totalDebitStroops,
    expiresAt,
  };
}

export function validatePreparedStealthPayment(
  review: PreparedStealthPayment,
  expectedSourcePublicKey: string,
  expectedNetwork: NetworkKey,
  nowSeconds = Math.floor(Date.now() / 1_000),
): Transaction {
  assertPrivatePaymentsTestnet(expectedNetwork);
  if (review.network !== expectedNetwork) {
    throw new Error('Stealth payment network changed. Review the payment again.');
  }
  if (review.sourcePublicKey !== expectedSourcePublicKey) {
    throw new Error('Stealth payment account changed. Review the payment again.');
  }
  if (!HASH_HEX.test(review.transactionHash)) {
    throw new Error('Stealth payment review hash is invalid');
  }
  const parsed = TransactionBuilder.fromXdr(
    review.envelopeXdr,
    NETWORKS[expectedNetwork].networkPassphrase,
  );
  if (
    parsed instanceof FeeBumpTransaction ||
    !(parsed instanceof Transaction) ||
    parsed.signatures.length !== 0 ||
    parsed.source !== expectedSourcePublicKey ||
    transactionHash(parsed) !== review.transactionHash
  ) {
    throw new Error('Stealth payment review changed after approval.');
  }
  const maxTime = Number(parsed.timeBounds?.maxTime);
  if (
    !Number.isSafeInteger(nowSeconds) ||
    nowSeconds < 0 ||
    !Number.isSafeInteger(maxTime) ||
    maxTime !== review.expiresAt ||
    nowSeconds >= maxTime
  ) {
    throw new Error('Stealth payment review expired. Prepare it again.');
  }
  return parsed;
}

export async function submitPreparedStealthPayment(input: {
  review: PreparedStealthPayment;
  sourcePublicKey: string;
  network: NetworkKey;
  secretKey?: string;
  hardwareSigner?: HardwareSigner;
  onPrepared?: SubmissionPreparedCallback;
}): Promise<SubmissionResult> {
  const transaction = validatePreparedStealthPayment(
    input.review,
    input.sourcePublicKey,
    input.network,
  );
  const { kp, publicKey } = resolveSource(input.secretKey, input.hardwareSigner);
  if (publicKey !== input.sourcePublicKey) {
    throw new Error('Stealth payment signer changed. Review the payment again.');
  }
  return signAndSubmit(
    transaction,
    input.network,
    kp,
    input.hardwareSigner,
    input.onPrepared,
  );
}
