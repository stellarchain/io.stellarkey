import assert from 'node:assert/strict';
import test from 'node:test';
import {
  claimPrivateBalanceLease,
  decodePrivateBalanceFollowerUpdate,
  privateBalanceLeaseKey,
  releasePrivateBalanceLease,
} from '../src/features/private-balance/runtime/coordination.ts';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

const scope = {
  networkId: '01'.repeat(32),
  realmId: '02'.repeat(32),
  poolId: '03'.repeat(32),
  accountId: 'account-1',
};

test('private runtime lease elects one scoped leader and transfers after expiry', () => {
  const storage = memoryStorage();
  const key = privateBalanceLeaseKey(scope);
  assert.match(key, /^stellarkey\.private\.runtime-lease\.v1:/);
  assert.equal(claimPrivateBalanceLease(storage, key, 'tab-a', 100, 50), true);
  assert.equal(claimPrivateBalanceLease(storage, key, 'tab-b', 120, 50), false);
  assert.equal(releasePrivateBalanceLease(storage, key, 'tab-b'), false);
  assert.equal(claimPrivateBalanceLease(storage, key, 'tab-b', 151, 50), true);
  assert.equal(releasePrivateBalanceLease(storage, key, 'tab-a'), false);
  assert.equal(releasePrivateBalanceLease(storage, key, 'tab-b'), true);
});

test('private follower updates accept only a redacted exact schema', () => {
  const update = {
    protocolVersion: 2,
    type: 'private-runtime-update',
    senderId: 'tab-a',
    nonce: 'nonce-a',
    phase: 'current',
    revision: 7,
    lastVerifiedActionIndex: 12,
  };
  assert.deepEqual(decodePrivateBalanceFollowerUpdate(JSON.stringify(update)), update);
  for (const extra of [
    { privateAddress: `tskpay_${'2'.repeat(121)}` },
    { notes: [] },
    { commitments: [] },
    { memo: 'secret' },
    { transaction: 'AAAA' },
    { verifiedBalanceStroops: '5000000' },
  ]) {
    assert.equal(
      decodePrivateBalanceFollowerUpdate(JSON.stringify({ ...update, ...extra })),
      null,
    );
  }
  assert.equal(
    decodePrivateBalanceFollowerUpdate(JSON.stringify({ ...update, phase: 'proving-secret' })),
    null,
  );
  assert.equal(
    decodePrivateBalanceFollowerUpdate(JSON.stringify({ ...update, phase: 'status-unknown' }))?.phase,
    'status-unknown',
  );
});

test('private runtime scope rejects malformed or ambiguous identifiers', () => {
  assert.throws(() => privateBalanceLeaseKey({ ...scope, networkId: 'ABC' }), /network/i);
  assert.throws(() => privateBalanceLeaseKey({ ...scope, accountId: 'account:other' }), /account/i);
});

test('a follower takeover force-claims the lease from a live leader', async () => {
  const { forceClaimPrivateBalanceLease } = await import(
    '../src/features/private-balance/runtime/coordination.ts'
  );
  const storage = memoryStorage();
  const key = privateBalanceLeaseKey(scope);
  assert.equal(claimPrivateBalanceLease(storage, key, 'tab-a', 100, 50), true);
  // A normal claim still loses against the unexpired leader...
  assert.equal(claimPrivateBalanceLease(storage, key, 'tab-b', 120, 50), false);
  // ...but the explicit "Use Here" takeover wins immediately.
  assert.equal(forceClaimPrivateBalanceLease(storage, key, 'tab-b', 120, 50), true);
  assert.equal(claimPrivateBalanceLease(storage, key, 'tab-b', 130, 50), true);
  // The displaced leader now observes the loss on its next renewal.
  assert.equal(claimPrivateBalanceLease(storage, key, 'tab-a', 140, 50), false);
  assert.equal(forceClaimPrivateBalanceLease(storage, key, 'tab a', 150, 50), false);
});
