#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Keypair, StrKey } from '@stellar/stellar-sdk';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const FIXTURE_ROOT = path.join(PROJECT_ROOT, 'protocol/private-balance/results/fixtures');
const RESULT_PATH = path.join(PROJECT_ROOT, 'protocol/private-balance/results/mvp-e2e.json');
const PUBLIC_MANIFEST_PATH = path.join(
  PROJECT_ROOT,
  'public/protocol/private-balance/v1/manifest.json',
);
const EXPECTED_MANIFEST_PATH = path.join(
  PROJECT_ROOT,
  'src/lib/private-balance-expected-manifest.ts',
);

export function buildFixtureManifestBytes(evidence) {
  if (!evidence?.fixtureOnly) throw new Error('E2E requires fixture-only deployment evidence.');
  if (!evidence.manifest || evidence.manifest.status !== 'development') {
    throw new Error('E2E fixture manifest must retain development status.');
  }
  if (
    evidence.manifest.poolContractId !== evidence.poolContractId ||
    !StrKey.isValidContract(evidence.poolContractId)
  ) {
    throw new Error('E2E fixture pool identity is inconsistent.');
  }
  const bytes = Buffer.from(`${JSON.stringify(evidence.manifest, null, 2)}\n`, 'utf8');
  return { bytes, hash: createHash('sha256').update(bytes).digest('hex') };
}

export function buildExpectedManifestModule(hash) {
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('Expected manifest hash is invalid.');
  return `/** Generated for an isolated Private Balance E2E build. Never commit this value. */\n` +
    `export const EXPECTED_PRIVATE_BALANCE_MANIFEST_SHA256 =\n` +
    `  '${hash}';\n` +
    `export const ALLOW_PRIVATE_BALANCE_DEVELOPMENT_FIXTURE = true;\n`;
}

export function sanitizeMvpEvidence(value) {
  const forbidden = /secret|seed|mnemonic|private.?key/i;
  if (Array.isArray(value)) return value.map(sanitizeMvpEvidence);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !forbidden.test(key))
      .map(([key, child]) => [key, sanitizeMvpEvidence(child)]),
  );
}

function fixtureEvidencePath(argv) {
  const index = argv.indexOf('--fixture');
  if (index >= 0) {
    const requested = argv[index + 1];
    if (!requested || requested.startsWith('--')) throw new Error('--fixture requires a path.');
    const resolved = path.resolve(PROJECT_ROOT, requested);
    const relative = path.relative(FIXTURE_ROOT, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Fixture evidence must be below protocol/private-balance/results/fixtures/.');
    }
    return resolved;
  }
  const candidates = readdirSync(FIXTURE_ROOT)
    .filter(name => /^testnet-fixture-C[A-Z2-7]{55}\.json$/.test(name))
    .sort();
  if (candidates.length !== 1) {
    throw new Error(`Expected exactly one committed testnet fixture, found ${candidates.length}.`);
  }
  return path.join(FIXTURE_ROOT, candidates[0]);
}

function run(command, args, environment = process.env) {
  const result = spawnSync(command, args, {
    cwd: PROJECT_ROOT,
    env: environment,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with status ${result.status}.`);
  }
}

async function fundTestnetAccount(publicKey) {
  const url = new URL('https://friendbot.stellar.org');
  url.searchParams.set('addr', publicKey);
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 512);
    throw new Error(`Friendbot failed with HTTP ${response.status}: ${detail}`);
  }
}

function gitHead() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error('Unable to resolve the E2E source commit.');
  return result.stdout.trim();
}

export async function runTestnetE2e(argv = process.argv.slice(2)) {
  const fixturePath = fixtureEvidencePath(argv);
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
  const { bytes: manifestBytes, hash: manifestHash } = buildFixtureManifestBytes(fixture);
  const releaseManifest = readFileSync(PUBLIC_MANIFEST_PATH);
  const expectedManifestModule = readFileSync(EXPECTED_MANIFEST_PATH);
  let restored = false;
  const restoreReleaseFiles = () => {
    if (restored) return;
    writeFileSync(PUBLIC_MANIFEST_PATH, releaseManifest);
    writeFileSync(EXPECTED_MANIFEST_PATH, expectedManifestModule);
    restored = true;
  };
  const restoreAndExit = signal => {
    restoreReleaseFiles();
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };
  process.once('SIGINT', restoreAndExit);
  process.once('SIGTERM', restoreAndExit);

  try {
    writeFileSync(PUBLIC_MANIFEST_PATH, manifestBytes);
    writeFileSync(EXPECTED_MANIFEST_PATH, buildExpectedManifestModule(manifestHash));
    run('npm', ['run', 'build'], {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: '1',
    });
  } finally {
    restoreReleaseFiles();
    process.removeListener('SIGINT', restoreAndExit);
    process.removeListener('SIGTERM', restoreAndExit);
  }

  if (
    !readFileSync(PUBLIC_MANIFEST_PATH).equals(releaseManifest) ||
    !readFileSync(EXPECTED_MANIFEST_PATH).equals(expectedManifestModule)
  ) {
    throw new Error('E2E build did not restore the tracked release manifest files exactly.');
  }

  const sender = Keypair.random();
  const recipient = Keypair.random();
  await Promise.all([
    fundTestnetAccount(sender.publicKey()),
    fundTestnetAccount(recipient.publicKey()),
  ]);

  const e2eEnvironment = {
    ...process.env,
    PRIVATE_BALANCE_E2E_SENDER_SECRET: sender.secret(),
    PRIVATE_BALANCE_E2E_RECIPIENT_SECRET: recipient.secret(),
    PRIVATE_BALANCE_E2E_POOL_ID: fixture.poolContractId,
    PRIVATE_BALANCE_E2E_MANIFEST_SHA256: manifestHash,
  };
  run(
    'npx',
    [
      'playwright',
      'test',
      'e2e/private-balance',
      '--project=desktop-chromium',
      '--reporter=line',
    ],
    e2eEnvironment,
  );
  run(
    'npx',
    [
      'playwright',
      'test',
      'e2e/private-balance/browser-smoke.spec.ts',
      '--project=desktop-firefox-private',
      '--project=desktop-webkit-private',
      '--project=iphone-webkit',
      '--project=ipad-webkit',
      '--reporter=line',
    ],
    e2eEnvironment,
  );

  const evidence = sanitizeMvpEvidence({
    schemaVersion: 1,
    scope: 'minimal-mvp',
    passed: true,
    completedAt: new Date().toISOString(),
    sourceCommit: gitHead(),
    fixtureEvidence: path.relative(PROJECT_ROOT, fixturePath),
    fixturePoolContractId: fixture.poolContractId,
    fixtureWasmSha256: fixture.wasmSha256,
    fixtureManifestSha256: manifestHash,
    senderAccount: sender.publicKey(),
    recipientAccount: recipient.publicKey(),
    browsers: [
      'desktop-chromium',
      'desktop-firefox',
      'desktop-webkit',
      'iphone-webkit-emulation',
      'ipad-webkit-emulation',
    ],
    coverage: [
      'setup and verified initial sync',
      'two isolated browser profiles',
      'two deposit submissions and canonical reconciliation',
      'two-note consolidation',
      'private send with recipient output and sender change',
      'recipient canonical sync and exact received balance',
      'ambiguous RPC timeout with reserved inputs persisted across lock and unlock',
      'withdrawal to the public Stellar balance',
      'wallet lock, unlock, and encrypted-state persistence',
      'encrypted V2 wallet-backup restore with exact private balance',
      'local Private Balance data removal',
      'seed-only recovery with exact recovered balance',
      'selected RPC endpoint switch and canonical resync',
      'private receive address validation',
      'manifest tamper fail-closed',
      'critical modal accessibility',
      'production CSP browser smoke matrix with QR, overflow, accessibility, and camera policy checks',
    ],
    limitations: [
      'This is minimal MVP evidence, not beta approval.',
      'Archive expiry, paid restoration, physical iOS/Android devices, and real Android Chrome remain unverified.',
      'Ceremony and independent audit evidence remain absent.',
    ],
  });
  mkdirSync(path.dirname(RESULT_PATH), { recursive: true });
  writeFileSync(RESULT_PATH, `${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  await runTestnetE2e();
}
