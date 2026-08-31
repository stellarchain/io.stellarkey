import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { StrKey } from '@stellar/stellar-sdk';

import {
  buildExpectedManifestModule,
  buildFixtureManifestBytes,
  sanitizeMvpEvidence,
} from '../protocol/private-balance/scripts/run-testnet-e2e.mjs';

const source = readFileSync(
  new URL('../protocol/private-balance/scripts/run-testnet-e2e.mjs', import.meta.url),
  'utf8',
);

test('testnet E2E build pins the exact fixture manifest bytes', () => {
  const poolContractId = StrKey.encodeContract(Buffer.alloc(32, 7));
  const evidence = {
    fixtureOnly: true,
    poolContractId,
    manifest: { schemaVersion: 1, status: 'development', poolContractId },
  };
  const { bytes, hash } = buildFixtureManifestBytes(evidence);
  assert.equal(bytes.toString('utf8'), `${JSON.stringify(evidence.manifest, null, 2)}\n`);
  assert.match(hash, /^[0-9a-f]{64}$/);
  const expectedModule = buildExpectedManifestModule(hash);
  assert.match(expectedModule, new RegExp(hash));
  assert.match(expectedModule, /ALLOW_PRIVATE_BALANCE_DEVELOPMENT_FIXTURE = true/);
  assert.throws(() => buildFixtureManifestBytes({ ...evidence, fixtureOnly: false }), /fixture-only/i);
});

test('testnet E2E runner restores release files and never records browser secrets', () => {
  assert.match(source, /finally\s*\{[\s\S]*restoreReleaseFiles/);
  assert.match(source, /Keypair\.random/);
  assert.match(source, /friendbot\.stellar\.org/);
  assert.doesNotMatch(source, /PRIVATE_BALANCE_E2E_(?:SENDER|RECIPIENT)_SECRET[^\n]*write/i);

  const sanitized = sanitizeMvpEvidence({
    passed: true,
    senderSecret: 'S' + 'A'.repeat(55),
    recipientSecret: 'S' + 'B'.repeat(55),
    senderAccount: 'G' + 'A'.repeat(55),
    nested: { mnemonic: 'never record this', count: 4 },
  });
  assert.deepEqual(sanitized, {
    passed: true,
    senderAccount: 'G' + 'A'.repeat(55),
    nested: { count: 4 },
  });
});

test('minimal testnet E2E suite keeps every required Task 26 surface', () => {
  for (const name of ['setup', 'payments', 'recovery', 'security', 'accessibility', 'browser-smoke']) {
    assert.equal(
      existsSync(new URL(`../e2e/private-balance/${name}.spec.ts`, import.meta.url)),
      true,
      `${name}.spec.ts must exist`,
    );
  }
});

test('testnet E2E follows the integrated private-assets UI', () => {
  const helpers = readFileSync(
    new URL('../e2e/private-balance/helpers.ts', import.meta.url),
    'utf8',
  );
  assert.match(helpers, /region.*Your Private Assets/s);
  assert.match(helpers, /Open private XLM/);
  assert.doesNotMatch(helpers, /Open Private Payments|· private balance/);
});
