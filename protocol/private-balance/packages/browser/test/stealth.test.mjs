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
  const keys = deriveStealthMetaKeys(bytes(7), 'testnet');
  const encoded = encodeStealthMetaAddress({
    scanPublicKey: keys.scanPublicKey,
    spendPublicKey: keys.spendPublicKey,
  }, 'testnet');

  assert.match(encoded, /^tsm1[023456789acdefghjklmnpqrstuvwxyz]+$/u);
  assert.deepEqual(await decodeStealthMetaAddress(encoded, 'testnet'), {
    scanPublicKey: keys.scanPublicKey,
    spendPublicKey: keys.spendPublicKey,
  });
  await assert.rejects(decodeStealthMetaAddress(encoded, 'mainnet'), /network|prefix/i);
  await assert.rejects(decodeStealthMetaAddress(encoded.toUpperCase(), 'testnet'), /spelling/i);

  const altered = `${encoded.slice(0, -1)}${encoded.endsWith('q') ? 'p' : 'q'}`;
  await assert.rejects(decodeStealthMetaAddress(altered, 'testnet'), /checksum/i);
});

test('sender and recipient derive the same unlinkable one-time account', async () => {
  const recipient = deriveStealthMetaKeys(bytes(11), 'testnet');
  const first = await deriveStealthRecipient({
    scanPublicKey: recipient.scanPublicKey,
    spendPublicKey: recipient.spendPublicKey,
  }, bytes(21), 'testnet', 'portable');
  const second = await deriveStealthRecipient({
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
  const recipient = deriveStealthMetaKeys(bytes(31), 'testnet');
  const wrongRecipient = deriveStealthMetaKeys(bytes(32), 'testnet');
  const payment = await deriveStealthRecipient({
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
  const recipient = deriveStealthMetaKeys(bytes(41), 'testnet');
  const payment = await deriveStealthRecipient({
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
    'tsm19lhfqg9p5lguav93fhje98qdlvyqxmkpsdem7qjxe6jn27z35s0hwxtv6fpuv2he72gkunwmt4sksmclajdtjale009l6efktxedqnqqhwvuj',
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
    '7d5b50a382a80dee2eb95fc2bca4b2205f3caf7b225e19c148a5fed224702244',
  );
  assert.equal(
    hex(signature),
    'ef43a7573d808b0ffa71201d93a78149ed01a73df54d3c85c888fb8c991cc683b92a54591f1f81c063000b2be38352be043ef269146f91b75c7404e46109b30e',
  );

  assert.equal(ed25519.verify(signature, message, payment.publicKey, { zip215: false }), true);

  const changedMessage = message.slice();
  changedMessage[0] ^= 1;
  assert.equal(ed25519.verify(signature, changedMessage, payment.publicKey, { zip215: false }), false);

  const changedSignature = signature.slice();
  changedSignature[63] ^= 1;
  assert.equal(ed25519.verify(changedSignature, message, payment.publicKey, { zip215: false }), false);
});
