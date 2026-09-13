import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');

test('release-history cleanup preserves CI and Cloudflare deployment workflows', () => {
  const directory = new URL('.github/workflows/', root);
  assert.deepEqual(readdirSync(directory).sort(), ['ci.yml', 'private-gate-b.yml', 'release.yml']);
  assert.equal(existsSync(new URL('.github/actions/setup-stellar-cli/action.yml', root)), true);
  assert.equal(existsSync(new URL('.github/dependabot.yml', root)), true);
});

test('manual release verification retains independent private security gates', () => {
  const { scripts } = JSON.parse(read('package.json'));
  assert.equal(scripts['verify:private-rust'], 'cd protocol/private-balance && cargo +1.97.1 test --workspace --locked && cargo +1.97.1 deny check');
  assert.equal(scripts['verify:private-circuits'], 'npm --prefix protocol/private-balance/circuits audit --audit-level=high && npm run private:gate-a');
  assert.equal(scripts['verify:private-artifacts'], 'npm run private:check-reproducible');
  assert.match(scripts['verify:private-model'], /cargo \+1\.97\.1 test --release --locked.*one_hundred_thousand_seeded_actions_recover_exactly_and_detect_corruption -- --ignored --exact/);
  assert.match(scripts['release:verify'], /^node scripts\/assert-clean-release\.mjs && npm run verify:application$/);
  const gate = read('protocol/private-balance/circuits/scripts/run-underconstraint.mjs');
  assert.match(gate, /af7d4ed0325e6f7743d8a1ac0e415d0c69b8aae8/);
  assert.match(gate, /process\.env\.CIVER_SOURCE_COMMIT !== CIVER_COMMIT/);
  assert.match(read('protocol/private-balance/scripts/build-private-balance-artifacts.mjs'), /aarch64-apple-darwin/);
});
