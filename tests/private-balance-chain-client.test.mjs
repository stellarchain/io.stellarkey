import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PrivateBalanceChainClient } from '../src/features/private-balance/runtime/chain-client.ts';

const manifest = {
  poolContractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAITA4',
};

test('nullifier reads are fail-closed and validate canonical hex', async () => {
  const unavailable = new PrivateBalanceChainClient('https://rpc.example', manifest, {
    getLatestLedger: async () => ({ sequence: 1 }),
    getLedgerEntries: async () => {
      throw new Error('RPC unavailable');
    },
  });
  await assert.rejects(() => unavailable.isNullifierSpent('11'.repeat(32)), /RPC unavailable/);
  await assert.rejects(() => unavailable.isNullifierSpent('not-hex'), /64 hexadecimal/);

  const spent = new PrivateBalanceChainClient('https://rpc.example', manifest, {
    getLatestLedger: async () => ({ sequence: 2 }),
    getLedgerEntries: async () => ({ entries: [{}] }),
  });
  assert.equal(await spent.isNullifierSpent('22'.repeat(32)), true);

  const unspent = new PrivateBalanceChainClient('https://rpc.example', manifest, {
    getLatestLedger: async () => ({ sequence: 3 }),
    getLedgerEntries: async () => ({ entries: [] }),
  });
  assert.equal(await unspent.isNullifierSpent('33'.repeat(32)), false);
});

test('private chain client remains browser-native', () => {
  const source = readFileSync(
    new URL('../src/features/private-balance/runtime/chain-client.ts', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(source, /\bBuffer\b|node:/);
});
