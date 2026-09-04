import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('outgoing recovery is an explicit two-stage local preference, not an automatic privacy default', () => {
  const source = read('src/features/private-balance/components/PrivateOutgoingHistorySettings.tsx');
  assert.match(source, /checked=\{mode === 'recoverable'\}/);
  assert.match(source, /setConfirming\(true\)/);
  assert.match(source, /acknowledgeRecoveryLoss: next === 'minimized'/);
  assert.match(source, /Omit future outgoing details/);
  assert.match(source, /Keep recovery enabled/);
  assert.match(source, /Balances, spent notes, and incoming payments still recover/);
  assert.match(source, /does not erase older records or backups/);
  assert.match(source, /seed-only restore resets this local setting/);
  assert.match(source, /HumanizedErrorNotice/);
  assert.doesNotMatch(source, /<Modal|console\.|localStorage|sessionStorage|transition: all/);
});

test('preference errors and stale completions stay local to their account context', () => {
  const source = read('src/features/private-balance/components/PrivateOutgoingHistorySettings.tsx');
  assert.match(source, /requestRef\.current !== request/);
  assert.match(source, /key=\{props\.scope\}/);
  assert.match(source, /disabled=\{disabled \|\| saving\}/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /label="Recover outgoing payment details"/);
});

test('advanced privacy mounts the account and deployment scoped preference inside its existing shell', () => {
  const source = read('src/features/private-balance/components/PrivateProtocolSettings.tsx');
  assert.match(source, /<PrivateOutgoingHistorySettings/);
  assert.match(source, /scope=\{JSON\.stringify\(\[publicAddress, deployment\.networkId, deployment\.poolContractId, deployment\.manifestHash\]\)\}/);
  assert.match(source, /mode=\{outgoingHistoryMode\}/);
  assert.match(source, /onChange=\{setOutgoingHistoryMode\}/);
  assert.match(source, /disabled=\{working !== null \|\| phase !== 'current' \|\| !isLeader \|\| pendingActions\.length > 0\}/);
  assert.equal((source.match(/<Modal /g) ?? []).length, 1);
  assert.doesNotMatch(source, /<Modal[^>]*key=/);
});
