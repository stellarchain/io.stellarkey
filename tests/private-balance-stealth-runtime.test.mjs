import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deriveStealthMetaKeys,
  deriveStealthRecipient,
} from '@stellarkey/private-balance';
import {
  deriveStealthRuntimeIdentity,
  syncStealthRuntime,
} from '../src/features/private-balance/runtime/stealth-runtime.ts';

class MemoryDriver {
  records = new Map();
  async read(key) { return this.records.get(key) ?? null; }
  async compareAndSet(key, expectedRevision, value) {
    const current = this.records.get(key) ?? null;
    const revision = current === null ? null : JSON.parse(current).revision;
    if (revision !== expectedRevision) return { ok: false, current };
    this.records.set(key, value);
    return { ok: true, current: value };
  }
  async removePrefix(prefix) {
    for (const key of this.records.keys()) if (key.startsWith(prefix)) this.records.delete(key);
  }
}

const bytes = value => new Uint8Array(32).fill(value);
const context = {
  networkId: '01'.repeat(32),
  realmId: '02'.repeat(32),
  poolId: '03'.repeat(32),
  accountId: 'account-1',
  deploymentBindingHash: '04'.repeat(32),
};

test('stealth runtime publishes its reusable identity before incremental discovery finishes', async () => {
  const rootKey = bytes(11);
  const storageKey = bytes(12);
  const recipient = await deriveStealthRecipient(
    deriveStealthMetaKeys(rootKey, 'testnet'),
    bytes(13),
    'testnet',
    'portable',
  );
  const order = [];
  let releasePage;
  const pageReady = new Promise(resolve => { releasePage = resolve; });
  let markReadStarted;
  const readStarted = new Promise(resolve => { markReadStarted = resolve; });
  let discoveryInput = null;
  const run = syncStealthRuntime({
    rootKey,
    storageKey,
    context,
    network: 'testnet',
    announcerPublicKey: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    storageDriver: new MemoryDriver(),
    implementation: 'portable',
    walletCreatedAt: 1,
    createReader: () => ({
      async readPage(input) {
        discoveryInput = input;
        order.push('read');
        markReadStarted();
        await pageReady;
        return {
          announcements: [{
            pagingToken: '4294967297',
            transactionHash: '05'.repeat(32),
            ephemeralPublicKey: recipient.ephemeralPublicKey,
            destinationPublicKey: recipient.publicKey,
            amountStroops: '25000000',
            ledger: 1,
            createdAt: 1,
          }],
          nextCursor: '4294967297',
          latestLedger: 1,
          hasMore: false,
        };
      },
    }),
    now: () => 2,
    onIdentity(address) {
      order.push('identity');
      assert.match(address, /^tsm1/u);
    },
  });
  await readStarted;
  assert.deepEqual(order, ['identity', 'read']);
  releasePage();
  const result = await run;
  assert.equal(discoveryInput.lowerBoundCreatedAt, 1);
  assert.equal(result.cache.payments.length, 1);
  assert.equal(result.cache.payments[0].amountStroops, '25000000');
  assert.equal(result.metaAddress, deriveStealthRuntimeIdentity(rootKey, 'testnet').metaAddress);
});

test('stealth runtime rejects mismatched meta-key networks', () => {
  assert.match(deriveStealthRuntimeIdentity(bytes(21), 'mainnet').metaAddress, /^ssm1/u);
});
