import assert from 'node:assert/strict';
import test from 'node:test';
import { Keypair } from '@stellar/stellar-sdk';
import { fetchActivity } from '../src/lib/api.ts';
import { generateActivityCsv } from '../src/lib/format.ts';

for (const limit of ['0', '0.0000000', '1.0000000', '922337203685.4775807', undefined]) {
  test(`trustline activity preserves ${limit === '0' || limit === '0.0000000' ? 'removal' : 'addition'} semantics (${limit ?? 'absent limit'})`, async t => {
    const publicKey = Keypair.random().publicKey();
    t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ _embedded: { records: [{
      id: 'synthetic-operation', type: 'change_trust', limit, transaction_successful: true,
      transaction_hash: 'synthetic', created_at: '2026-11-06T00:00:00Z', asset_code: 'TEST', asset_issuer: publicKey,
    }] } }), { status: 200 }));
    const { items } = await fetchActivity(publicKey, 'testnet');
    const title = limit === '0' || limit === '0.0000000' ? 'Trustline Removed' : 'Trustline Added';
    assert.equal(items[0].title, title);
    // CSV already uses the neutral operation label, so both cases stay accurate.
    assert.ok(generateActivityCsv(items, 'testnet').includes('"Trustline","neutral"'));
  });
}
