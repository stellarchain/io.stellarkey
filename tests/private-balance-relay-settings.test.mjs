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

test('home exposes a focused earn-by-relaying entry with live helper status', () => {
  const dashboard = read('src/components/Dashboard.tsx');
  const settings = read('src/features/private-balance/components/PrivateRelaySettings.tsx');

  assert.match(dashboard, /PrivateRelayEntry/);
  const entry = read('src/features/private-balance/components/PrivateRelayEntry.tsx');
  assert.match(entry, /Earn by relaying/);
  assert.match(entry, /PRIVATE_RELAY_PREFERENCES_EVENT/);
  assert.match(entry, /preferences\.helpRelay/);
  assert.match(entry, /aria-haspopup="dialog"/);
  assert.match(entry, /<Modal/);
  assert.match(entry, /<PrivateRelaySettings helperOnly/);
  assert.match(entry, /onSaved=\{\(\) => setOpen\(false\)\}/);
  assert.match(settings, /helperOnly/);
  assert.match(settings, /onSaved/);
  assert.doesNotMatch(settings, /Relay settings saved on this device/);
  assert.match(settings, /StellarKey is open and unlocked/);
});

test('relay modal checks live peer availability only after explicit intent', () => {
  const entry = read('src/features/private-balance/components/PrivateRelayEntry.tsx');
  const availability = read('src/features/private-balance/components/PrivateRelayAvailability.tsx');

  assert.match(entry, /PrivateRelayAvailability/);
  assert.match(availability, /Check available peers/);
  assert.match(availability, /onClick=\{\(\) => void check\(\)\}/);
  assert.match(availability, /checkPrivateRelayAvailability/);
  assert.match(availability, /excludePeerAccounts.*publicAddress/s);
  assert.match(availability, /AbortController/);
  assert.match(availability, /aria-live="polite"/);
  assert.match(availability, /available when checked/);
  assert.match(availability, /No peers answered/);
  assert.match(availability, /Lowest fee/);
  assert.match(availability, /quote\.peerAccount/);
  assert.match(availability, /quote\.feeAtomic/);
  assert.match(availability, /formatPrivateBalanceAmount/);
  assert.match(availability, /\{fee\} \{code\}/);
  assert.match(entry, /code=\{asset\?\.code/);
  assert.match(entry, /decimals=\{asset\?\.decimals/);
  assert.doesNotMatch(availability, /savePrivateRelayPreferences|localStorage/);
});

test('relay fees use normal seven-decimal asset units instead of atomic units', () => {
  const settings = read('src/features/private-balance/components/PrivateRelaySettings.tsx');

  assert.match(settings, /formatPrivateBalanceXlm/);
  assert.match(settings, /parsePrivateAmount/);
  assert.doesNotMatch(settings, /atomic units/i);
  assert.match(settings, /inputMode="decimal"/);
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
  const session = read('src/features/private-balance/relay/session.ts');
  const boundary = read('src/components/PrivateBalanceRuntimeBoundary.tsx');

  assert.match(boundary, /PrivateRelayHelperManager/);
  assert.match(manager, /reviewPrivateRelayJob/);
  assert.match(manager, /Approve &amp; sign/);
  assert.match(manager, /Reject/);
  assert.match(manager, /<Modal/);
  assert.match(manager, /never signs automatically/i);
  assert.doesNotMatch(manager, /signPrivateRelayJob\([^)]*\)[\s\S]{0,120}offerQuote/);
  assert.match(manager, /requestExpiryTimers/);
  assert.match(manager, /requestIds\.delete\(request\.requestId\)/);
  assert.match(manager, /clearTimeout/);
  assert.match(session, /quoteExpiryTimers/);
  assert.match(session, /forgetQuote/);
});
