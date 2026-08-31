import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  deriveStealthMetaKeys,
  encodePrivateAddress,
  encodeStealthMetaAddress,
} from '@stellarkey/private-balance';
import {
  privateAddressFingerprint,
  privateReceivePayload,
  stealthAddressFingerprint,
  stealthReceivePayload,
} from '../src/features/private-balance/runtime/receive.ts';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('receive payload contains only the canonical private address', () => {
  const address = encodePrivateAddress({
    diversifier: Uint8Array.of(1, 2, 3, 4),
    ownerCommitment: Uint8Array.from([1, ...new Uint8Array(31)]),
    hpkePublicKey: new Uint8Array(32).fill(2),
  }, 'tks');
  assert.equal(privateReceivePayload(address), address);
  assert.match(privateAddressFingerprint(address), /^[A-F0-9]{4} [A-F0-9]{4}$/);
  assert.throws(() => privateReceivePayload(` ${address}`), /canonical/);
  assert.throws(() => privateReceivePayload(`sks1${address.slice(4)}`), /network/);
});

test('reusable receive payload validates the canonical network-bound meta address', () => {
  const address = encodeStealthMetaAddress(
    deriveStealthMetaKeys(new Uint8Array(32).fill(7), 'testnet'),
    'testnet',
  );
  assert.equal(stealthReceivePayload(address, 'tsm'), address);
  assert.match(stealthAddressFingerprint(address), /^[A-F0-9]{4} [A-F0-9]{4}$/);
  assert.throws(() => stealthReceivePayload(` ${address}`, 'tsm'), /canonical/);
  assert.throws(() => stealthReceivePayload(`ssm1${address.slice(4)}`, 'tsm'), /network/);
});

test('private receive uses a compact scan-first layout with a calm verification code', () => {
  const receive = read('src/features/private-balance/components/ReceivePrivate.tsx');

  assert.match(receive, /Receive Privately/);
  assert.match(receive, /privateReceivePayload\(address/);
  assert.match(receive, /privateAddressFingerprint/);
  assert.match(receive, /Verification code/);
  assert.doesNotMatch(receive, /Fingerprint —/);
  assert.match(receive, /max-w-\[180px\]/);
  assert.match(receive, /payload\.slice\(0, 14\)/);
  assert.match(receive, /payload\.slice\(-12\)/);
  assert.match(receive, /Private address/);
  assert.match(receive, /Copy Address/);
  assert.match(receive, /navigator\.share/);
  assert.match(receive, /Share/);
  assert.match(receive, /Save QR/);
  assert.match(receive, /download="stellarkey-private-receive-qr\.png"/);
  assert.doesNotMatch(receive, /requestedAmount|contactName|analyticsId/);
});

test('native private receive offers reusable and shielded addresses in the same surface', () => {
  const receive = read('src/features/private-balance/components/ReceivePrivate.tsx');

  assert.match(
    receive,
    /useState<'reusable' \| 'shielded'>\('shielded'\)/,
    'the immediately available shielded address must be the default after setup',
  );
  assert.match(receive, /stealthMetaAddress/);
  assert.match(receive, /Reusable/);
  assert.match(receive, /Shielded/);
  assert.match(receive, /asset\?\.kind === 'native'/);
  assert.match(receive, /Fresh one-time account per payment/);
  assert.match(receive, /Sender, amount, and timing stay public/);
  assert.match(receive, /Amount and counterparty are encrypted/);
  assert.match(receive, /stealthReceivePayload/);
  assert.match(receive, /stealthAddressFingerprint/);
});

test('protocol facts and the reuse caveat live in a collapsed disclosure', () => {
  const receive = read('src/features/private-balance/components/ReceivePrivate.tsx');

  assert.match(receive, /aria-expanded=\{aboutOpen\}/);
  assert.match(receive, /About this address/);
  assert.match(receive, /Protocol V1/);
  assert.match(receive, /Network/);
  assert.match(receive, /asset\?\.code/);
  assert.match(receive, /people you share it with can\s+recognize the same address/i);
});

test('receive rotates to a fresh address in place while old addresses stay valid', () => {
  const receive = read('src/features/private-balance/components/ReceivePrivate.tsx');

  assert.match(receive, /rotatePrivateAddress/);
  assert.match(receive, />New address</);
  assert.match(receive, /Creating address/);
  assert.match(receive, /Previous addresses remain valid/);
  assert.doesNotMatch(receive, /window\.location|onClose\(\).*rotatePrivateAddress/s);
});

test('a configured account with a transiently missing address never sees setup copy', () => {
  const receive = read('src/features/private-balance/components/ReceivePrivate.tsx');

  // Follower tab / leader not yet published: calm loading guidance.
  assert.match(receive, /configured/);
  assert.match(receive, /Your address is loading — one moment/);
  assert.match(receive, /active in another tab/i);
  // Setup copy stays reserved for genuinely unconfigured accounts.
  assert.match(receive, /if \(configured\) \{[\s\S]*?\}[\s\S]*?Set up Private Payments to receive privately/);
});

test('receive is embeddable and available whenever the durable address exists', () => {
  const receive = read('src/features/private-balance/components/ReceivePrivate.tsx');
  const card = read('src/features/private-balance/components/PrivateBalanceCard.tsx');

  // Named body export for embedding without the Modal wrapper.
  assert.match(receive, /export function PrivateReceiveContent\(\)/);
  assert.match(receive, /export function ReceivePrivate\(/);
  assert.match(receive, /<PrivateReceiveContent \/>/);
  // The card gates Receive only on the durable private address — no sync and
  // no current phase required.
  assert.match(card, /label="Receive" disabled=\{privateAddress === null\}/);
  assert.match(card, /ReceivePrivate/);
});
