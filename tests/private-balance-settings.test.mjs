import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('advanced privacy keeps unique diagnostics concise and protects local removal', () => {
  const settings = read('src/features/private-balance/components/PrivateProtocolSettings.tsx');
  const provider = read('src/features/private-balance/runtime/provider.tsx');
  const runtime = read('src/hooks/usePrivateBalanceRuntime.tsx');

  for (const label of ['Protocol version', 'Artifact version', 'Realm', 'Asset contract', 'Manifest hash', 'Circuit hash', 'Primary RPC', 'Witness RPC', 'Last checkpoint', 'Encrypted local data', 'Unspent notes']) {
    assert.match(settings, new RegExp(label, 'i'));
  }
  for (const duplicate of ['label="Network"', 'label="Pool"', 'Independent audit', 'Ceremony evidence', 'Measured seed recovery', 'Optional mirror']) {
    assert.doesNotMatch(settings, new RegExp(duplicate, 'i'));
  }
  assert.match(settings, /Advanced privacy/);
  assert.match(settings, /Check private history/);
  assert.match(settings, /Technical details/);
  assert.match(settings, /aria-expanded/);
  assert.match(settings, /aria-live="polite"/);
  assert.match(settings, /Private history checked against two independent network providers/);
  assert.match(settings, /Use witness during routine checks/);
  assert.match(settings, /public network access timing and pattern/);
  assert.match(settings, /never signs, and never submits transactions/);
  assert.match(settings, /Seed recovery and a full history check always require the witness/);
  assert.match(settings, /<Toggle/);
  assert.match(runtime, /rpcWitnessEnabled/);
  assert.match(provider, /corroboratePrivateRpcCheckpoint/);
  // Errors route through the humanizer (title + body, raw message behind the
  // collapsed Technical details) — never a raw runtime string on screen.
  assert.match(settings, /HumanizedErrorNotice/);
  assert.doesNotMatch(settings, /ErrorText/);
  assert.doesNotMatch(settings, /cause\.message/);
  assert.doesNotMatch(`${settings}\n${provider}\n${runtime}`, /resetPublicCache/);
  assert.match(settings, /runFullVerification/);
  assert.match(settings, /REMOVE PRIVATE BALANCE/);
  assert.match(settings, /does not withdraw.*does not delete.*on-chain/is);
  assert.match(provider, /clearPrivateBalancePublicCache/);
  assert.match(provider, /clearShieldedState/);
});
