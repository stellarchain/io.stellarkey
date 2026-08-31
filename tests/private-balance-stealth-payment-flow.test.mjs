import assert from 'node:assert/strict';
import test from 'node:test';
import { Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk';
import {
  deriveStealthMetaKeys,
  encodeStealthMetaAddress,
} from '@stellarkey/private-balance';
import {
  prepareStealthPayment,
  validatePreparedStealthPayment,
} from '../src/features/private-balance/runtime/stealth-payment.ts';

const bytes = value => new Uint8Array(32).fill(value);
const sender = Keypair.fromRawEd25519Seed(bytes(71));
const announcer = Keypair.fromRawEd25519Seed(bytes(72)).publicKey();
const recipient = encodeStealthMetaAddress(
  deriveStealthMetaKeys(bytes(73), 'testnet'),
  'testnet',
);
const mainnetRecipient = encodeStealthMetaAddress(
  deriveStealthMetaKeys(bytes(76), 'mainnet'),
  'mainnet',
);

test('stealth payment review binds the one-time destination and complete public debit', async () => {
  const review = await prepareStealthPayment({
    sourcePublicKey: sender.publicKey(),
    metaAddress: recipient,
    network: 'testnet',
    announcerPublicKey: announcer,
    amount: '2.5',
    baseFeeStroops: 100,
    loadSourceSequence: async () => '123',
    loadBaseReserveStroops: async () => '5000000',
    ephemeralPrivateKey: bytes(74),
    nowSeconds: 1_000,
  });

  assert.equal(review.amountStroops, '25000000');
  assert.equal(review.reserveStroops, '10000000');
  assert.equal(review.sweepFeeBufferStroops, '1000000');
  assert.equal(review.announcementStroops, '1');
  assert.equal(review.networkFeeStroops, '300');
  assert.equal(review.totalDebitStroops, '36000301');
  assert.equal(review.expiresAt, 1_180);
  assert.equal(validatePreparedStealthPayment(review, sender.publicKey(), 'testnet', 1_001).source, sender.publicKey());
  const transaction = TransactionBuilder.fromXdr(review.envelopeXdr, Networks.TESTNET);
  assert.equal(transaction.operations[0].destination, review.destinationPublicKey);
});

test('stealth payment review rejects tampering, expiry, account changes, and network changes', async () => {
  const review = await prepareStealthPayment({
    sourcePublicKey: sender.publicKey(),
    metaAddress: recipient,
    network: 'testnet',
    announcerPublicKey: announcer,
    amount: '1',
    baseFeeStroops: 100,
    loadSourceSequence: async () => '123',
    loadBaseReserveStroops: async () => '5000000',
    ephemeralPrivateKey: bytes(75),
    nowSeconds: 1_000,
  });
  assert.throws(
    () => validatePreparedStealthPayment({ ...review, transactionHash: '00'.repeat(32) }, sender.publicKey(), 'testnet', 1_001),
    /hash|changed/i,
  );
  assert.throws(
    () => validatePreparedStealthPayment(review, Keypair.random().publicKey(), 'testnet', 1_001),
    /account changed/i,
  );
  assert.throws(
    () => validatePreparedStealthPayment(review, sender.publicKey(), 'mainnet', 1_001),
    /testnet only/i,
  );
  assert.throws(
    () => validatePreparedStealthPayment(review, sender.publicKey(), 'testnet', 1_180),
    /expired/i,
  );
});

test('stealth payment preparation rejects mainnet before reading network state', async () => {
  let networkReads = 0;
  await assert.rejects(
    prepareStealthPayment({
      sourcePublicKey: sender.publicKey(),
      metaAddress: mainnetRecipient,
      network: 'mainnet',
      announcerPublicKey: announcer,
      amount: '1',
      baseFeeStroops: 100,
      loadSourceSequence: async () => {
        networkReads += 1;
        return '123';
      },
      loadBaseReserveStroops: async () => {
        networkReads += 1;
        return '5000000';
      },
      ephemeralPrivateKey: bytes(77),
      nowSeconds: 1_000,
    }),
    /testnet only/i,
  );
  assert.equal(networkReads, 0);
});
