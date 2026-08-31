import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import {
  deriveStealthMetaKeys,
  deriveStealthRecipient,
  deriveStealthRecipientKey,
} from '@stellarkey/private-balance';
import { signStealthTransaction } from '../src/features/private-balance/runtime/stealth-signing.ts';
import { signStealthSweepEnvelope } from '../src/features/private-balance/runtime/stealth-sweep.ts';

const bytes = value => new Uint8Array(32).fill(value);

async function fixture() {
  const metaKeys = deriveStealthMetaKeys(bytes(71), 'testnet');
  const recipient = await deriveStealthRecipient(metaKeys, bytes(72), 'testnet', 'portable');
  const recovered = await deriveStealthRecipientKey(
    metaKeys,
    recipient.ephemeralPublicKey,
    'testnet',
    'portable',
  );
  const source = StrKey.encodeEd25519PublicKey(recovered.publicKey);
  const destination = Keypair.fromRawEd25519Seed(bytes(73)).publicKey();
  const transaction = new TransactionBuilder(new Account(source, '10'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.payment({
      destination,
      asset: Asset.native(),
      amount: '1',
    }))
    .setTimeout(180)
    .build();
  return { transaction, recovered, source };
}

test('stealth scalar signer adds one valid decorated signature with the correct hint', async () => {
  const { transaction, recovered, source } = await fixture();
  const hash = transaction.hash();
  const signed = signStealthTransaction(transaction, recovered);

  assert.equal(signed, transaction);
  assert.equal(transaction.signatures.length, 1);
  assert.deepEqual(
    transaction.signatures[0].hint.toBytes(),
    StrKey.decodeEd25519PublicKey(source).slice(-4),
  );
  assert.equal(
    Keypair.fromPublicKey(source).verify(hash, transaction.signatures[0].signature.toBytes()),
    true,
  );
});

test('stealth scalar signer rejects a mismatched source or pre-signed transaction', async () => {
  const { transaction, recovered } = await fixture();
  const wrongKeys = deriveStealthMetaKeys(bytes(74), 'testnet');
  const wrongRecipient = await deriveStealthRecipient(wrongKeys, bytes(75), 'testnet', 'portable');
  const wrongRecovered = await deriveStealthRecipientKey(
    wrongKeys,
    wrongRecipient.ephemeralPublicKey,
    'testnet',
    'portable',
  );
  assert.throws(() => signStealthTransaction(transaction, wrongRecovered), /source|public key/i);
  assert.equal(transaction.signatures.length, 0);

  signStealthTransaction(transaction, recovered);
  assert.throws(() => signStealthTransaction(transaction, recovered), /unsigned/i);
  assert.equal(transaction.signatures.length, 1);
});

test('stealth sweep signer binds the encrypted root, announcement, source, network, and review hash', async () => {
  const rootKey = bytes(81);
  const metaKeys = deriveStealthMetaKeys(rootKey, 'testnet');
  const ephemeralPrivateKey = bytes(82);
  const recipient = await deriveStealthRecipient(
    metaKeys,
    ephemeralPrivateKey,
    'testnet',
    'portable',
  );
  const source = StrKey.encodeEd25519PublicKey(recipient.publicKey);
  const destination = Keypair.fromRawEd25519Seed(bytes(83)).publicKey();
  const transaction = new TransactionBuilder(new Account(source, '20'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.payment({ destination, asset: Asset.native(), amount: '1' }))
    .setTimeout(180)
    .build();
  const hash = Buffer.from(transaction.hash()).toString('hex');
  const payment = {
    destinationPublicKey: source,
    ephemeralPublicKey: Buffer.from(recipient.ephemeralPublicKey).toString('hex'),
  };

  const signedXdr = await signStealthSweepEnvelope({
    rootKey,
    payment,
    network: 'testnet',
    networkPassphrase: Networks.TESTNET,
    envelopeXdr: transaction.toXdr(),
    expectedTransactionHash: hash,
    implementation: 'portable',
  });
  const signed = TransactionBuilder.fromXdr(signedXdr, Networks.TESTNET);
  assert.equal(signed.signatures.length, 1);
  assert.equal(
    Keypair.fromPublicKey(source).verify(
      signed.hash(),
      signed.signatures[0].signature.toBytes(),
    ),
    true,
  );

  await assert.rejects(
    signStealthSweepEnvelope({
      rootKey,
      payment: { ...payment, destinationPublicKey: destination },
      network: 'testnet',
      networkPassphrase: Networks.TESTNET,
      envelopeXdr: transaction.toXdr(),
      expectedTransactionHash: hash,
      implementation: 'portable',
    }),
    /destination|source/i,
  );
});
