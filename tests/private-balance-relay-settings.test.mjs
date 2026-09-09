import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('home keeps its compact gift row while the redesign stays inside Earn', () => {
  const entry = read('src/features/private-balance/components/PrivateRelayEntry.tsx');
  const body = read('src/features/private-balance/components/PrivateRelayEntryBody.tsx');
  const trigger = entry.slice(entry.indexOf('<button'), entry.indexOf('</button>') + '</button>'.length);
  assert.match(trigger, /<IconGift size=\{17\}/);
  assert.match(trigger, /mt-2 flex min-h-14/);
  assert.match(trigger, /rounded-2xl px-2\.5 py-2/);
  assert.match(trigger, /text-\[13\.5px\]/);
  assert.match(trigger, /\{helperDescription\}/);
  assert.match(trigger, /aria-live="polite"/);
  assert.doesNotMatch(trigger, /RelayMark|bg-panel|border-white|sm:inline/);
  const modal = entry.slice(entry.indexOf('<Modal '));
  assert.match(modal, /open=\{open\} onClose=\{close\} wide/);
  // The status, settings and peer content is the lazily loaded body, mounted
  // only while open so peer information leaves with the dialog.
  assert.match(modal, /\{open \? \(\s*<PrivateRelayEntryBody/);
  assert.doesNotMatch(body, /<Modal\b|<ModalHeader\b/);
  assert.match(body, /Your relay status/);
  assert.match(body, /<PrivateRelaySettings helperOnly/);
  assert.match(body, /Explore other peers/);
});

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
  assert.match(settings, /automatically signs encrypted account-possession offers/i);
  assert.match(settings, /every exact transaction still requires your approval/i);
  assert.doesNotMatch(settings, /Helping never signs\s+automatically/);
});

test('home exposes a focused earn-by-relaying entry with live helper status', () => {
  const dashboard = read('src/components/Dashboard.tsx');
  const settings = read('src/features/private-balance/components/PrivateRelaySettings.tsx');

  assert.match(dashboard, /PrivateRelayEntry/);
  const entry = read('src/features/private-balance/components/PrivateRelayEntry.tsx');
  const body = read('src/features/private-balance/components/PrivateRelayEntryBody.tsx');
  const helperStatus = read('src/features/private-balance/relay/helper-status.ts');
  assert.match(entry, /Earn by Relaying/);
  assert.match(entry, /PRIVATE_RELAY_PREFERENCES_EVENT/);
  assert.match(entry, /preferences\.helpRelay/);
  assert.match(entry, /useSyncExternalStore/);
  assert.match(entry, /Connected/);
  assert.match(entry, /Reconnecting/);
  assert.match(entry, /aria-haspopup="dialog"/);
  assert.match(entry, /<Modal/);
  assert.match(body, /<PrivateRelaySettings helperOnly/);
  // Saving/starting is local feedback now, not an implicit close. The Earn
  // browser suite verifies shell/backdrop identity and focus across changes.
  assert.doesNotMatch(entry, /onSaved=\{\(\) => setOpen\(false\)\}/);
  assert.doesNotMatch(body, /onSaved=|setOpen\(/);
  assert.match(entry, /<Modal open=\{open\}/);
  assert.match(settings, /Start relaying/);
  assert.match(settings, /Stop Relaying/);
  assert.match(settings, /helperOnly/);
  assert.match(settings, /onSaved/);
  assert.doesNotMatch(settings, /Relay settings saved on this device/);
  assert.match(settings, /StellarKey is open and unlocked/);
  assert.doesNotMatch(helperStatus, /localStorage|sessionStorage|indexedDB/);
});

test('relay modal checks live peer availability only after explicit intent', () => {
  const entry = read('src/features/private-balance/components/PrivateRelayEntry.tsx');
  const body = read('src/features/private-balance/components/PrivateRelayEntryBody.tsx');
  const availability = read('src/features/private-balance/components/PrivateRelayAvailability.tsx');

  // The peer check lives in the body, which the shell mounts only while open.
  assert.doesNotMatch(entry, /PrivateRelayAvailability/);
  assert.match(body, /PrivateRelayAvailability/);
  assert.match(availability, /Check available peers/);
  assert.match(availability, /onClick=\{\(\) => void check\(\)\}/);
  assert.match(availability, /checkPrivateRelayAvailability/);
  assert.match(availability, /onQuotes:/);
  assert.match(availability, /Finding peers…/);
  assert.match(availability, /Comparing fees…/);
  assert.match(availability, /First offer received/);
  assert.match(availability, /catch \(cause: unknown\)[\s\S]{0,180}setResult\(null\)/);
  assert.match(availability, /excludePeerAccounts.*publicAddress/s);
  assert.match(availability, /AbortController/);
  assert.match(availability, /aria-live="polite"/);
  assert.match(availability, /available when checked/);
  assert.match(availability, /No peers answered/);
  assert.match(availability, /same Stellar account/);
  assert.match(availability, /different Testnet account/);
  assert.match(availability, /Lowest fee/);
  assert.match(availability, /quote\.peerAccount/);
  assert.match(availability, /quote\.feeAtomic/);
  assert.match(availability, /formatPrivateBalanceAmount/);
  assert.match(availability, /\{fee\} \{code\}/);
  assert.match(body, /code=\{asset\?\.code/);
  assert.match(body, /decimals=\{asset\?\.decimals/);
  assert.doesNotMatch(availability, /savePrivateRelayPreferences|localStorage/);
  assert.doesNotMatch(availability, /transition-all/);
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
  assert.match(manager, /Approve and sign/);
  assert.match(manager, /Reject/);
  assert.match(manager, /<Modal/);
  // The request is an interrupt: a centred alert whose content exists only
  // while a request is pending, and which stays put while signing.
  assert.match(manager, /presentation="alert"/);
  assert.match(manager, /open=\{pending !== null\}/);
  assert.match(manager, /busy=\{working\}/);
  assert.match(manager, /never signs transactions automatically/i);
  assert.doesNotMatch(manager, /signPrivateRelayJob\([^)]*\)[\s\S]{0,120}offerQuote/);
  assert.match(manager, /requestExpiryTimers/);
  assert.match(manager, /waitUntilConnected/);
  assert.match(manager, /retryPrivateRelayHelperReadiness/);
  assert.match(manager, /publishPrivateRelayHelperStatus/);
  assert.match(manager, /requestIds\.delete\(request\.requestId\)/);
  assert.match(manager, /clearTimeout/);
  assert.match(session, /quoteExpiryTimers/);
  assert.match(session, /forgetQuote/);
});
