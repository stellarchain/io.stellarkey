import assert from 'node:assert/strict';
import test from 'node:test';
const hygiene = await import('../src/features/private-balance/worker/key-hygiene.ts').catch(() => ({}));

test('worker session cleanup overwrites outgoing viewing key alongside spend and HPKE key buffers', () => {
  assert.equal(typeof hygiene.wipePrivateBalanceSpendingKey, 'function');
  const key = Object.fromEntries(['ask', 'nk', 'baseOwnerCommitment', 'ownerCommitment', 'hpkePrivateKey', 'hpkePublicKey', 'outgoingViewingKey'].map(name => [name, new Uint8Array(32).fill(7)]));
  const retainedOutgoingBuffer = key.outgoingViewingKey;
  hygiene.wipePrivateBalanceSpendingKey(key);
  for (const buffer of Object.values(key)) assert.equal(buffer.every(byte => byte === 0), true);
  assert.deepEqual(retainedOutgoingBuffer, new Uint8Array(32));
});
