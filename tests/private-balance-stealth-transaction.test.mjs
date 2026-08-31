import assert from 'node:assert/strict';
import test from 'node:test';
import { Account, Keypair, Networks } from '@stellar/stellar-sdk';
import {
  deriveStealthMetaKeys,
  encodeStealthMetaAddress,
} from '@stellarkey/private-balance';
import { buildStealthPaymentTransaction } from '../src/features/private-balance/runtime/stealth-transaction.ts';

const bytes = value => new Uint8Array(32).fill(value);
const source = Keypair.fromRawEd25519Seed(bytes(51)).publicKey();
const announcer = Keypair.fromRawEd25519Seed(bytes(52)).publicKey();
const recipient = deriveStealthMetaKeys(bytes(53), 'testnet');
const address = encodeStealthMetaAddress(recipient, 'testnet');
const mainnetRecipient = deriveStealthMetaKeys(bytes(58), 'mainnet');
const mainnetAddress = encodeStealthMetaAddress(mainnetRecipient, 'mainnet');

test('stealth payment builder emits the exact reserve, value, and announcement operations', async () => {
  const built = await buildStealthPaymentTransaction({
    sourceAccount: new Account(source, '123'),
    metaAddress: address,
    network: 'testnet',
    networkPassphrase: Networks.TESTNET,
    announcerPublicKey: announcer,
    amount: '2.5',
    baseReserveStroops: '5000000',
    baseFeeStroops: '100',
    ephemeralPrivateKey: bytes(54),
  });

  assert.equal(built.transaction.operations.length, 3);
  assert.deepEqual(built.transaction.operations.map(operation => operation.type), [
    'createAccount',
    'payment',
    'payment',
  ]);
  assert.deepEqual(built.transaction.operations[0], {
    type: 'createAccount',
    destination: built.destinationPublicKey,
    startingBalance: '1.1000000',
  });
  assert.equal(built.transaction.operations[1].destination, built.destinationPublicKey);
  assert.equal(built.transaction.operations[1].amount, '2.5000000');
  assert.equal(built.transaction.operations[1].asset.isNative(), true);
  assert.equal(built.transaction.operations[2].destination, announcer);
  assert.equal(built.transaction.operations[2].amount, '0.0000001');
  assert.equal(built.transaction.operations[2].asset.isNative(), true);
  assert.equal(built.transaction.memo.type, 'hash');
  assert.deepEqual(new Uint8Array(built.transaction.memo.value), built.ephemeralPublicKey);
  assert.equal(built.reserveStroops, '10000000');
  assert.equal(built.sweepFeeBufferStroops, '1000000');
  assert.equal(built.amountStroops, '25000000');
  assert.equal(built.announcementStroops, '1');
  assert.equal(built.networkFeeStroops, '300');
  assert.equal(built.totalDebitStroops, '36000301');
});

test('stealth payment builder creates a fresh account for fresh sender randomness', async () => {
  const common = {
    sourceAccount: new Account(source, '123'),
    metaAddress: address,
    network: 'testnet',
    networkPassphrase: Networks.TESTNET,
    announcerPublicKey: announcer,
    amount: '1',
    baseReserveStroops: '5000000',
    baseFeeStroops: '100',
  };
  const first = await buildStealthPaymentTransaction({ ...common, ephemeralPrivateKey: bytes(55) });
  const second = await buildStealthPaymentTransaction({ ...common, ephemeralPrivateKey: bytes(56) });
  assert.notEqual(first.destinationPublicKey, second.destinationPublicKey);
  assert.notDeepEqual(first.ephemeralPublicKey, second.ephemeralPublicKey);
});

test('stealth payment builder rejects wrong-network handles and invalid amounts', async () => {
  const common = {
    sourceAccount: new Account(source, '123'),
    network: 'mainnet',
    networkPassphrase: Networks.PUBLIC,
    announcerPublicKey: announcer,
    amount: '1',
    baseReserveStroops: '5000000',
    baseFeeStroops: '100',
    ephemeralPrivateKey: bytes(57),
  };
  await assert.rejects(
    buildStealthPaymentTransaction({ ...common, metaAddress: address }),
    /network|prefix|testnet only/i,
  );
  await assert.rejects(
    buildStealthPaymentTransaction({ ...common, network: 'testnet', networkPassphrase: Networks.TESTNET, metaAddress: address, amount: '0' }),
    /positive/i,
  );
});

test('stealth payment builder rejects mainnet before constructing a transaction', async () => {
  await assert.rejects(
    buildStealthPaymentTransaction({
      sourceAccount: new Account(source, '123'),
      metaAddress: mainnetAddress,
      network: 'mainnet',
      networkPassphrase: Networks.PUBLIC,
      announcerPublicKey: announcer,
      amount: '1',
      baseReserveStroops: '5000000',
      baseFeeStroops: '100',
      ephemeralPrivateKey: bytes(59),
    }),
    /testnet only/i,
  );
});
