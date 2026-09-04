import { performance } from 'node:perf_hooks';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { v2 as nip44 } from 'nostr-tools/nip44';

const RUNS = 120;
const MAX_EVENT_BYTES = 64 * 1024;
const CRYPTO_P95_BUDGET_MS = 50;
const encoder = new TextEncoder();

function percentile(values, value) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * value))];
}

const senderSecret = generateSecretKey();
const peerSecret = generateSecretKey();
const senderPublic = getPublicKey(senderSecret);
const peerPublic = getPublicKey(peerSecret);
const senderKey = nip44.utils.getConversationKey(senderSecret, peerPublic);
const peerKey = nip44.utils.getConversationKey(peerSecret, senderPublic);
const payload = JSON.stringify({
  version: 1,
  type: 'sign-job',
  requestId: '11'.repeat(32),
  quoteId: '22'.repeat(32),
  transactionHash: '33'.repeat(32),
  unsignedEnvelopeXdr: Buffer.alloc(12 * 1024, 0x5a).toString('base64'),
  nonce: '44'.repeat(32),
  expiresAt: 1_800_000_120,
});

const encryptMs = [];
const decryptMs = [];
let encrypted = '';
for (let index = 0; index < RUNS; index += 1) {
  let start = performance.now();
  encrypted = nip44.encrypt(payload, senderKey);
  encryptMs.push(performance.now() - start);
  start = performance.now();
  const decoded = nip44.decrypt(encrypted, peerKey);
  decryptMs.push(performance.now() - start);
  if (decoded !== payload) throw new Error('Private relay benchmark round trip changed the job');
}

const eventBytes = encoder.encode(JSON.stringify({
  id: '55'.repeat(32),
  pubkey: senderPublic,
  created_at: 1_800_000_000,
  kind: 24_333,
  tags: [
    ['t', 'stellarkey-private-relay-v1'],
    ['p', peerPublic],
    ['expiration', '1800000120'],
  ],
  content: encrypted,
  sig: '66'.repeat(64),
})).byteLength;

const result = {
  runs: RUNS,
  plaintextBytes: encoder.encode(payload).byteLength,
  encryptedBytes: encoder.encode(encrypted).byteLength,
  eventBytes,
  encryptP50Ms: Number(percentile(encryptMs, 0.50).toFixed(3)),
  encryptP95Ms: Number(percentile(encryptMs, 0.95).toFixed(3)),
  decryptP50Ms: Number(percentile(decryptMs, 0.50).toFixed(3)),
  decryptP95Ms: Number(percentile(decryptMs, 0.95).toFixed(3)),
  maximumEventBytes: MAX_EVENT_BYTES,
  cryptoP95BudgetMs: CRYPTO_P95_BUDGET_MS,
};

senderSecret.fill(0);
peerSecret.fill(0);
senderKey.fill(0);
peerKey.fill(0);

if (eventBytes > MAX_EVENT_BYTES) {
  throw new Error(`Private relay event is ${eventBytes} bytes, above ${MAX_EVENT_BYTES}`);
}
if (result.encryptP95Ms > CRYPTO_P95_BUDGET_MS || result.decryptP95Ms > CRYPTO_P95_BUDGET_MS) {
  throw new Error(`Private relay crypto p95 exceeds ${CRYPTO_P95_BUDGET_MS} ms`);
}

console.log(JSON.stringify(result, null, 2));
