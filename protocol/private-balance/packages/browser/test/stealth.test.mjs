import test from 'node:test';
import assert from 'node:assert/strict';
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { sha512 } from '@noble/hashes/sha2.js';
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
const equal = (left, right) => left.length === right.length && left.every((byte, index) => byte === right[index]);

function viewingApi() {
  assert.equal(typeof privateBalance.deriveStealthViewingKeys, 'function');
  assert.equal(typeof privateBalance.deriveStealthRecipientPublicKey, 'function');
  return privateBalance;
}

test('viewing keys have only recognition authority and never derive a nonce key', t => {
  const { deriveStealthViewingKeys } = viewingApi();
  const root = bytes(51);
  const deployment = bytes(52);
  const full = deriveStealthMetaKeys(root, 'testnet', deployment);
  const borrowed = [root, deployment].map(value => [value, value.slice()]);
  const nonceDomain = new TextEncoder().encode('SK_STEALTH_NONCE_KEY_V1');
  const hash = sha512.create();
  const prototype = Object.getPrototypeOf(hash);
  const update = prototype.update;
  let nonceDerivations = 0;
  t.mock.method(prototype, 'update', function (input) {
    if (input instanceof Uint8Array && equal(input, nonceDomain)) nonceDerivations += 1;
    return update.call(this, input);
  });
  const view = deriveStealthViewingKeys(root, 'testnet', deployment);
  assert.deepEqual(Reflect.ownKeys(view).sort(), [
    'deploymentBindingHash', 'network', 'scanPrivateKey', 'scanPublicKey', 'spendPublicKey',
  ]);
  assert.equal(nonceDerivations, 0, 'view preparation never derives the spend nonce');
  const calibration = deriveStealthMetaKeys(root, 'testnet', deployment);
  assert.equal(nonceDerivations, 1, 'the same observer detects nonce derivation in the full API');
  calibration.scanPrivateKey.fill(0); calibration.nonceKey.fill(0);
  for (const field of ['deploymentBindingHash', 'scanPrivateKey', 'scanPublicKey', 'spendPublicKey']) {
    assert.ok(equal(view[field], full[field]), 'viewing field matches existing derivation');
    assert.equal(view[field].length, 32);
    assert.ok(view[field] !== root && view[field] !== deployment, 'returned fields do not alias borrowed roots');
  }
  assert.equal(view.network, 'testnet');
  for (const [value, before] of borrowed) assert.ok(equal(value, before), 'borrowed input is unchanged');
});

test('sender, full recipient and viewing recipient agree across both networks, deployments and native/portable paths', async () => {
  const { deriveStealthViewingKeys, deriveStealthRecipientPublicKey } = viewingApi();
  for (const network of ['testnet', 'mainnet']) {
    for (const seed of [61, 62, 63]) {
      for (const deployment of [bytes(64), bytes(65)]) {
        const root = bytes(seed);
        const full = deriveStealthMetaKeys(root, network, deployment);
        const view = deriveStealthViewingKeys(root, network, deployment);
        assert.equal(encodeStealthMetaAddress(view, network), encodeStealthMetaAddress(full, network));
        for (const ephemeral of [bytes(66), bytes(67)]) {
          const sent = await deriveStealthRecipient(full, ephemeral, network, 'portable');
          const recovered = await deriveStealthRecipientKey(full, sent.ephemeralPublicKey, network, 'portable');
          const borrowed = [...Object.values(view).filter(value => value instanceof Uint8Array), sent.ephemeralPublicKey]
            .map(value => [value, value.slice()]);
          for (const implementation of ['portable', 'native', 'auto']) {
            const recognized = await deriveStealthRecipientPublicKey(view, sent.ephemeralPublicKey, network, implementation);
            assert.ok(recognized instanceof Uint8Array && recognized.length === 32, 'recognition returns only a public point');
            assert.ok(equal(recognized, sent.publicKey) && equal(recognized, recovered.publicKey), 'existing transcript agrees');
          }
          for (const [value, before] of borrowed) assert.ok(equal(value, before), 'recognition preserves borrowed inputs');
          recovered.nonceKey.fill(0);
        }
        view.scanPrivateKey.fill(0); full.scanPrivateKey.fill(0); full.nonceKey.fill(0);
      }
    }
  }
});

test('viewing recognition remains network/deployment-bound and cannot recognize another scan root', async () => {
  const { deriveStealthViewingKeys, deriveStealthRecipientPublicKey } = viewingApi();
  const view = deriveStealthViewingKeys(bytes(71), 'testnet', bytes(72));
  const sent = await deriveStealthRecipient(view, bytes(73), 'testnet', 'portable');
  for (const alternative of [
    deriveStealthViewingKeys(bytes(71), 'testnet', bytes(74)),
    deriveStealthViewingKeys(bytes(75), 'testnet', bytes(72)),
    deriveStealthViewingKeys(bytes(71), 'mainnet', bytes(72)),
  ]) {
    const actual = await deriveStealthRecipientPublicKey(alternative, sent.ephemeralPublicKey, alternative.network, 'portable');
    assert.ok(!equal(actual, sent.publicKey), 'different context does not recognize the original destination');
  }
  await assert.rejects(deriveStealthRecipientPublicKey(view, sent.ephemeralPublicKey, 'mainnet'), /network/i);
  for (const [root, network, deployment] of [[bytes(1).subarray(1), 'testnet', bytes(2)],
    [bytes(1), 'unsupported', bytes(2)], [bytes(1), 'testnet', bytes(2).subarray(1)]]) {
    assert.throws(() => deriveStealthViewingKeys(root, network, deployment), /bytes|network/i);
  }
});

test('viewing recognition rejects malformed, low-order and non-prime-subgroup points', async () => {
  const { deriveStealthViewingKeys, deriveStealthRecipientPublicKey } = viewingApi();
  const view = deriveStealthViewingKeys(bytes(81), 'testnet', bytes(82));
  const ephemeral = x25519.getPublicKey(bytes(83));
  const torsion = ed25519.Point.fromBytes(new Uint8Array(32), false);
  const mixed = ed25519.Point.BASE.add(torsion).toBytes();
  assert.equal(torsion.isSmallOrder(), true);
  assert.equal(ed25519.Point.fromBytes(mixed, false).isTorsionFree(), false);
  for (const spendPublicKey of [new Uint8Array(31), bytes(255), ed25519.Point.ZERO.toBytes(), torsion.toBytes(), mixed]) {
    await assert.rejects(deriveStealthRecipientPublicKey({ ...view, spendPublicKey }, ephemeral, 'testnet', 'portable'), /spend.*key/i);
  }
  for (const implementation of ['portable', 'native']) {
    for (const invalid of [new Uint8Array(31), new Uint8Array(32), Uint8Array.from([1, ...new Uint8Array(31)])]) {
      await assert.rejects(deriveStealthRecipientPublicKey(view, invalid, 'testnet', implementation), /invalid|bytes/i);
    }
  }
  for (const [field, value] of [['scanPrivateKey', new Uint8Array(31)], ['scanPublicKey', new Uint8Array(32)],
    ['deploymentBindingHash', new Uint8Array(31)]]) {
    await assert.rejects(deriveStealthRecipientPublicKey({ ...view, [field]: value }, ephemeral, 'testnet', 'portable'), /invalid|bytes/i);
  }
});

test('viewing recognition preserves the one-time identity-point rejection', async t => {
  const { deriveStealthViewingKeys, deriveStealthRecipientPublicKey } = viewingApi();
  const view = deriveStealthViewingKeys(bytes(91), 'testnet', bytes(92));
  view.spendPublicKey = ed25519.Point.BASE.toBytes();
  const prototype = Object.getPrototypeOf(sha512.create());
  const update = prototype.update;
  const digest = prototype.digest;
  const tweakDomain = new TextEncoder().encode('SK_STEALTH_TWEAK_V1');
  const tweaks = new WeakSet();
  let exercised = false;
  t.mock.method(prototype, 'update', function (input) {
    if (input instanceof Uint8Array && equal(input, tweakDomain)) tweaks.add(this);
    return update.call(this, input);
  });
  t.mock.method(prototype, 'digest', function (...args) {
    const output = digest.apply(this, args);
    if (tweaks.has(this)) {
      exercised = true;
      // Test-only hash fault: BASE + (order - 1) * BASE is the identity.
      // Noble freezes Point methods; no production hook or point bypass is used.
      output.fill(0);
      let remaining = ed25519.Point.CURVE().n - 1n;
      for (let index = 0; remaining > 0n; index += 1) {
        output[index] = Number(remaining & 255n);
        remaining >>= 8n;
      }
    }
    return output;
  });
  await assert.rejects(deriveStealthRecipientPublicKey(view, x25519.getPublicKey(bytes(93)), 'testnet', 'portable'), /zero one-time account/i);
  assert.ok(exercised, 'forced the unreachable-in-normal-use identity sum through the real rejection guard');
});

test('viewing preparation wipes transient spend bytes on success and partial scan material on failure', t => {
  const { deriveStealthViewingKeys } = viewingApi();
  const root = bytes(101);
  const deployment = bytes(102);
  const set = Uint8Array.prototype.set;
  const slice = Uint8Array.prototype.slice;
  const scratch = new Set();
  const scanCopies = [];
  const error = new Error('synthetic viewing preparation failure');
  let fail = false;
  t.mock.method(Uint8Array.prototype, 'set', function (source, offset) {
    if (this.length === 64 && source.length === 64 && new Error().stack.includes('/hkdf.js:')) scratch.add(this);
    return set.call(this, source, offset);
  });
  t.mock.method(Uint8Array.prototype, 'slice', function (...args) {
    if (this === deployment && fail) throw error;
    const result = slice.apply(this, args);
    if (result.length === 32 && new Error().stack.includes('/hkdf.js:')) scanCopies.push(result);
    return result;
  });
  const view = deriveStealthViewingKeys(root, 'testnet', deployment);
  assert.equal(scanCopies.length, 1);
  assert.ok(scanCopies[0] === view.scanPrivateKey, 'successful scan material transfers to the caller');
  assert.ok(view.scanPrivateKey.some(byte => byte !== 0));
  assert.ok(scratch.size >= 2 && [...scratch].every(value => value.every(byte => byte === 0)), 'successful spend material is overwritten');
  scratch.clear(); scanCopies.length = 0;
  fail = true;
  assert.throws(() => deriveStealthViewingKeys(root, 'testnet', deployment), thrown => thrown === error);
  assert.equal(scanCopies.length, 1);
  assert.ok(scratch.size >= 2, 'observed HKDF scratch including owned spend material');
  assert.ok([...scratch, ...scanCopies].every(value => value.every(byte => byte === 0)), 'unreturned owned key buffers are overwritten');
  assert.ok(root.every(byte => byte === 101) && deployment.every(byte => byte === 102), 'borrowed roots remain intact');
});

test('viewing recognition clears owned native shared secrets on success and tweak failure', async t => {
  const { deriveStealthViewingKeys, deriveStealthRecipientPublicKey } = viewingApi();
  const view = deriveStealthViewingKeys(bytes(111), 'testnet', bytes(112));
  const shared = [];
  const deriveBits = crypto.subtle.deriveBits.bind(crypto.subtle);
  t.mock.method(crypto.subtle, 'deriveBits', async (...args) => {
    const result = await deriveBits(...args);
    shared.push(new Uint8Array(result));
    return result;
  });
  const ephemeral = x25519.getPublicKey(bytes(113));
  const publicKey = await deriveStealthRecipientPublicKey(view, ephemeral, 'testnet', 'native');
  assert.equal(publicKey.length, 32);
  assert.equal(shared.length, 1, 'observed the actual native shared-secret buffer');
  assert.ok(shared[0].every(byte => byte === 0));
  const error = new Error('synthetic tweak failure');
  const prototype = Object.getPrototypeOf(sha512.create());
  const update = prototype.update;
  const tweakDomain = new TextEncoder().encode('SK_STEALTH_TWEAK_V1');
  t.mock.method(prototype, 'update', function (input) {
    if (input instanceof Uint8Array && equal(input, tweakDomain)) throw error;
    return update.call(this, input);
  });
  await assert.rejects(deriveStealthRecipientPublicKey(view, ephemeral, 'testnet', 'native'), thrown => thrown === error);
  assert.equal(shared.length, 2);
  assert.ok(shared.every(value => value.every(byte => byte === 0)), 'shared secrets are overwritten after both outcomes');
  assert.ok(view.scanPrivateKey.some(byte => byte !== 0), 'borrowed viewing key remains usable');
});

for (const rejectZero of [false, true]) {
  test(`viewing recognition clears its owned tweak digest after ${rejectZero ? 'zero-scalar rejection' : 'success'}`, async t => {
    const { deriveStealthViewingKeys, deriveStealthRecipientPublicKey } = viewingApi();
    const view = deriveStealthViewingKeys(bytes(121), 'testnet', bytes(122));
    const prototype = Object.getPrototypeOf(sha512.create());
    const update = prototype.update;
    const digest = prototype.digest;
    const tweakDomain = new TextEncoder().encode('SK_STEALTH_TWEAK_V1');
    const tweaks = new WeakSet();
    const retained = [];
    t.mock.method(prototype, 'update', function (input) {
      if (input instanceof Uint8Array && equal(input, tweakDomain)) tweaks.add(this);
      return update.call(this, input);
    });
    t.mock.method(prototype, 'digest', function (...args) {
      const output = digest.apply(this, args);
      if (tweaks.has(this)) {
        if (rejectZero) {
          // Nonzero bytes reduce to zero modulo the order. This proves the
          // error path cleans a real buffer rather than observing existing zeroes.
          output.fill(0);
          let remaining = ed25519.Point.CURVE().n;
          for (let index = 0; remaining > 0n; index += 1) {
            output[index] = Number(remaining & 255n);
            remaining >>= 8n;
          }
        }
        assert.ok(output.some(byte => byte !== 0), 'the observed digest starts nonzero');
        retained.push(output);
      }
      return output;
    });
    const result = deriveStealthRecipientPublicKey(view, x25519.getPublicKey(bytes(123)), 'testnet', 'portable');
    if (rejectZero) await assert.rejects(result, /Derived an invalid zero scalar/i);
    else assert.equal((await result).length, 32);
    assert.equal(retained.length, 1, 'observed the actual tweak digest allocation');
    assert.ok(retained[0].every(byte => byte === 0), 'owned tweak digest is overwritten');
    assert.ok(view.scanPrivateKey.some(byte => byte !== 0), 'borrowed viewing key is not cleared');
  });
}

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
