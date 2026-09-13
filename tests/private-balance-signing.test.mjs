import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Account,
  Keypair,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { signExactPrivateBalanceEnvelope } from '../src/lib/private-balance-signing.ts';

const PASSPHRASE = 'Test SDF Network ; September 2015';

function unsigned(source) {
  return new TransactionBuilder(new Account(source, '1'), {
    fee: '100',
    networkPassphrase: PASSPHRASE,
    timebounds: { minTime: 1, maxTime: 9999999999 },
  })
    .addOperation(Operation.bumpSequence({ bumpTo: '2' }))
    .build();
}

test('private signer signs only the exact reviewed envelope for the active account', () => {
  const keypair = Keypair.random();
  const transaction = unsigned(keypair.publicKey());
  const expectedHash = Buffer.from(transaction.hash()).toString('hex');
  const signed = signExactPrivateBalanceEnvelope({
    envelopeXdr: transaction.toXdr(),
    expectedTransactionHash: expectedHash,
    expectedSource: keypair.publicKey(),
    networkPassphrase: PASSPHRASE,
    secretKey: keypair.secret(),
  });
  assert.equal(TransactionBuilder.fromXdr(signed, PASSPHRASE).signatures.length, 1);

  assert.throws(() => signExactPrivateBalanceEnvelope({
    envelopeXdr: transaction.toXdr(),
    expectedTransactionHash: '00'.repeat(32),
    expectedSource: keypair.publicKey(),
    networkPassphrase: PASSPHRASE,
    secretKey: keypair.secret(),
  }), /reviewed hash/i);
  assert.throws(() => signExactPrivateBalanceEnvelope({
    envelopeXdr: transaction.toXdr(),
    expectedTransactionHash: expectedHash,
    expectedSource: Keypair.random().publicKey(),
    networkPassphrase: PASSPHRASE,
    secretKey: keypair.secret(),
  }), /active account/i);
});
