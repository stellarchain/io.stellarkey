import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('advanced privacy keeps relay use and peer assistance as independent explicit opt-ins', () => {
  const settings = read('src/features/private-balance/components/PrivateRelaySettings.tsx');
  const protocolSettings = read('src/features/private-balance/components/PrivateProtocolSettings.tsx');

  assert.match(protocolSettings, /PrivateRelaySettings/);
  assert.match(settings, /Prefer privacy relay/);
  assert.match(settings, /Help relay private payments/);
  assert.match(settings, /useRelay/);
  assert.match(settings, /helpRelay/);
  assert.match(settings, /Save relay settings/);
  assert.match(settings, /No StellarKey backend/);
});

test('relay preferences persist only non-secret policy and validate two secure origins', () => {
  const preferences = read('src/features/private-balance/relay/preferences.ts');

  assert.match(preferences, /validatePrivateRelayUrls/);
  assert.match(preferences, /relayUrls/);
  assert.match(preferences, /feeAtomic/);
  assert.doesNotMatch(preferences, /secretKey|privateKey|envelopeXdr|transactionHash/);
});

test('helper mode presents a manual approval only after strict local review', () => {
  const manager = read('src/features/private-balance/components/PrivateRelayHelperManager.tsx');
  const boundary = read('src/components/PrivateBalanceRuntimeBoundary.tsx');

  assert.match(boundary, /PrivateRelayHelperManager/);
  assert.match(manager, /reviewPrivateRelayJob/);
  assert.match(manager, /Approve &amp; sign/);
  assert.match(manager, /Reject/);
  assert.match(manager, /<Modal/);
  assert.match(manager, /never signs automatically/i);
  assert.doesNotMatch(manager, /signPrivateRelayJob\([^)]*\)[\s\S]{0,120}offerQuote/);
});
