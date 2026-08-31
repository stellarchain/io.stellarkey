import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the activity check speaks plainly, is named honestly, and reports concrete progress', () => {
  const recovery = read('src/features/private-balance/components/PrivateRecovery.tsx');

  assert.match(recovery, /refreshSync/);
  // refreshSync is an incremental, checkpoint-forward pass — the button name
  // says so; the from-scratch verification lives under Advanced privacy.
  assert.match(recovery, /Check for New Activity/);
  assert.doesNotMatch(recovery, /Run Full Check/);
  assert.match(recovery, /Picks up where your last check left off/);
  assert.match(recovery, /Advanced privacy → Verify private history/);
  assert.match(recovery, /syncProgress/);
  assert.match(recovery, /Checking \$\{/);
  assert.match(recovery, /balance stays unavailable/i);
  assert.match(recovery, /recovery phrase stays inside your vault/i);
  assert.match(recovery, /HumanizedErrorNotice/);
  // Vocabulary bans hold: identifiers only behind Technical details. (The
  // `checkpoint` runtime field may appear as code, never as displayed copy.)
  assert.doesNotMatch(recovery, /archive|Merkle|canonical|Selected RPC|Last verified page/);
});
