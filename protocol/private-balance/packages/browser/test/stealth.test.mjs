import test from 'node:test';
import assert from 'node:assert/strict';
import { ed25519 } from '@noble/curves/ed25519.js';
import {
  decodeStealthMetaAddress,
  deriveStealthMetaKeys,
  deriveStealthRecipient,
  deriveStealthRecipientKey,
  encodeStealthMetaAddress,
  signWithEd25519Scalar,
} from '../dist/index.js';
import * as privateBalance from '../dist/index.js';

const bytes = value => new Uint8Array(32).fill(value);
const hex = value => Buffer.from(value).toString('hex');

test('stealth roots are domain-separated 32-byte children of the private session root', () => {
  const deriveStealthRootKey = privateBalance.deriveStealthRootKey;
  assert.equal(typeof deriveStealthRootKey, 'function');
  const sessionRoot = new Uint8Array(64).fill(5);
  const changedSessionRoot = sessionRoot.slice();
  changedSessionRoot[63] ^= 1;

  const first = deriveStealthRootKey(sessionRoot);
  const second = deriveStealthRootKey(sessionRoot);
  const changed = deriveStealthRootKey(changedSessionRoot);

  assert.equal(first.length, 32);
  assert.equal(hex(first), '9e1123dce0b8d6e5d35fd231d6476b346904e56a0d94acf3345b276551f951d2');
  assert.deepEqual(first, second);
  assert.notDeepEqual(first, changed);
  assert.throws(() => deriveStealthRootKey(new Uint8Array(32)), /64 bytes/i);
});

test('stealth meta-addresses are strict, checksummed, and network-bound', async () => {
  const deploymentBindingHash = bytes(6);
  const keys = deriveStealthMetaKeys(bytes(7), 'testnet', deploymentBindingHash);
  const encoded = encodeStealthMetaAddress({
    deploymentBindingHash,
    scanPublicKey: keys.scanPublicKey,
    spendPublicKey: keys.spendPublicKey,
  }, 'testnet');

  assert.match(encoded, /^tsm1[023456789acdefghjklmnpqrstuvwxyz]+$/u);
  assert.deepEqual(await decodeStealthMetaAddress(encoded, 'testnet'), {
    deploymentBindingHash,
    scanPublicKey: keys.scanPublicKey,
    spendPublicKey: keys.spendPublicKey,
  });
  await assert.rejects(decodeStealthMetaAddress(encoded, 'mainnet'), /network|prefix/i);
  await assert.rejects(
    decodeStealthMetaAddress(encoded, 'testnet', bytes(8)),
    /deployment/i,
  );
  await assert.rejects(decodeStealthMetaAddress(encoded.toUpperCase(), 'testnet'), /spelling/i);

  const altered = `${encoded.slice(0, -1)}${encoded.endsWith('q') ? 'p' : 'q'}`;
  await assert.rejects(decodeStealthMetaAddress(altered, 'testnet'), /checksum/i);
});

test('sender and recipient derive the same unlinkable one-time account', async () => {
  const recipient = deriveStealthMetaKeys(bytes(11), 'testnet', bytes(10));
  const first = await deriveStealthRecipient({
    deploymentBindingHash: recipient.deploymentBindingHash,
    scanPublicKey: recipient.scanPublicKey,
    spendPublicKey: recipient.spendPublicKey,
  }, bytes(21), 'testnet', 'portable');
  const second = await deriveStealthRecipient({
    deploymentBindingHash: recipient.deploymentBindingHash,
    scanPublicKey: recipient.scanPublicKey,
    spendPublicKey: recipient.spendPublicKey,
  }, bytes(22), 'testnet', 'portable');

  const recovered = await deriveStealthRecipientKey(
    recipient,
    first.ephemeralPublicKey,
    'testnet',
    'portable',
  );

  assert.deepEqual(recovered.publicKey, first.publicKey);
  assert.notDeepEqual(second.publicKey, first.publicKey);
  assert.notDeepEqual(second.ephemeralPublicKey, first.ephemeralPublicKey);
  assert.equal(first.publicKey.length, 32);
  assert.equal(first.ephemeralPublicKey.length, 32);
});

test('a different scan key cannot recover the one-time account', async () => {
  const recipient = deriveStealthMetaKeys(bytes(31), 'testnet', bytes(30));
  const wrongRecipient = deriveStealthMetaKeys(bytes(32), 'testnet', bytes(30));
  const payment = await deriveStealthRecipient({
    deploymentBindingHash: recipient.deploymentBindingHash,
    scanPublicKey: recipient.scanPublicKey,
    spendPublicKey: recipient.spendPublicKey,
  }, bytes(33), 'testnet', 'portable');

  const wrong = await deriveStealthRecipientKey(
    wrongRecipient,
    payment.ephemeralPublicKey,
    'testnet',
    'portable',
  );
  assert.notDeepEqual(wrong.publicKey, payment.publicKey);
});

test('raw-scalar signatures verify strictly and reject mutations', async () => {
  const recipient = deriveStealthMetaKeys(bytes(41), 'testnet', bytes(40));
  const payment = await deriveStealthRecipient({
    deploymentBindingHash: recipient.deploymentBindingHash,
    scanPublicKey: recipient.scanPublicKey,
    spendPublicKey: recipient.spendPublicKey,
  }, bytes(42), 'testnet', 'portable');
  const recovered = await deriveStealthRecipientKey(
    recipient,
    payment.ephemeralPublicKey,
    'testnet',
    'portable',
  );
  const message = new TextEncoder().encode('Stellar transaction hash');
  const signature = signWithEd25519Scalar(
    recovered.spendScalar,
    recovered.nonceKey,
    message,
  );

  assert.equal(
    encodeStealthMetaAddress(recipient, 'testnet'),
    'tsm19q5zs2pg9q5zs2pg9q5zs2pg9q5zs2pg9q5zs2pg9q5zs2pg9q5zlm5syzs605wwkzc5mevjnsxlkzqrdmqcxualqfrvaff40pg6g8mhr9kdys7x9tul9ytwfhd46ctgdu07ex4ewluhhjlav5m9nvksfs35rek8',
  );
  assert.equal(
    hex(recipient.scanPublicKey),
    '2fee9020a1a7d1ceb0b14de5929c0dfb08036ec18373bf0246cea5357851a41f',
  );
  assert.equal(
    hex(recipient.spendPublicKey),
    '77196cd243c62af9f2916e4ddb5d61686f1fec9ab977f97bcbfd653659b2d04c',
  );
  assert.equal(
    hex(payment.ephemeralPublicKey),
    '07aaff3e9fc167275544f4c3a6a17cd837f2ec6e78cd8a57b1e3dfb3cc035a76',
  );
  assert.equal(
    hex(payment.publicKey),
    '4155f2f0c6f6ba8f1364cde1251b1d50199a151c495413390171e4720f645b63',
  );
  assert.equal(
    hex(signature),
    'ce70ae0ffcec06caa669dd4fb90b7a60302715ce495b9af7dea76b3a5001389b4fe06dd4c1e9bc0b1e83a34cdb86e53e06591855c9b147a1be20946f699c170c',
  );

  assert.equal(ed25519.verify(signature, message, payment.publicKey, { zip215: false }), true);

  const changedMessage = message.slice();
  changedMessage[0] ^= 1;
  assert.equal(ed25519.verify(signature, changedMessage, payment.publicKey, { zip215: false }), false);

  const changedSignature = signature.slice();
  changedSignature[63] ^= 1;
  assert.equal(ed25519.verify(changedSignature, message, payment.publicKey, { zip215: false }), false);
});
