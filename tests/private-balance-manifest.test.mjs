import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Networks } from '@stellar/stellar-sdk';
import {
  PRIVATE_ADDRESS_PAYLOAD_BYTES,
  PRIVATE_ADDRESS_TESTNET_ASCII_BYTES,
} from '@stellarkey/private-balance';
import { verifyProvingKey } from '../protocol/private-balance/circuits/scripts/verify-proving-key.mjs';
import * as manifestModule from '../src/lib/private-balance-manifest.ts';
import * as assetsModule from '../src/lib/private-balance-assets.ts';

const { validateManifest } = manifestModule;
const manifestPath = join(process.cwd(), 'public/protocol/private-balance/v1/manifest.json');
const cataloguePath = join(process.cwd(), 'public/protocol/private-balance/v1/catalogue.json');

test('manifest: proving-key verification succeeds only after the pinned verifier command succeeds', () => {
  const calls = [];
  const transcripts = [];

  const verified = verifyProvingKey({
    ensureTranscript(path) {
      transcripts.push(path);
    },
    execute(command, args, options) {
      calls.push({ command, args, options });
    },
    stdio: 'pipe',
  });

  assert.equal(verified, true);
  assert.equal(transcripts.length, 1);
  assert.match(transcripts[0], /build\/pot14_final\.ptau$/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'npx');
  assert.deepEqual(calls[0].args.slice(0, 4), [
    '--no-install',
    'snarkjs',
    'zkey',
    'verify',
  ]);
  assert.equal(calls[0].options.stdio, 'pipe');
  assert.match(calls[0].options.cwd, /protocol\/private-balance\/circuits$/);
  assert.match(calls[0].args[4], /build\/action\.r1cs$/);
  assert.match(calls[0].args[5], /build\/pot14_final\.ptau$/);
  assert.match(calls[0].args[6], /build\/action_dev\.zkey$/);
});

test('manifest: proving-key verification propagates verifier failures', () => {
  const verifierFailure = new Error('invalid proving key');

  assert.throws(
    () => verifyProvingKey({
      ensureTranscript() {},
      execute() {
        throw verifierFailure;
      },
      stdio: 'pipe',
    }),
    error => error === verifierFailure,
  );
});

test('manifest: validates real manifest.json successfully', () => {
  const raw = JSON.parse(readFileSync(manifestPath, 'utf8'));

  const manifest = validateManifest(raw);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.protocolVersion, 1);
  assert.equal(manifest.status, 'development');
  assert.equal(manifest.constants.treeDepth, 17);
  assert.equal(manifest.constants.treeArity, 3);
  assert.equal(manifest.constants.publicInputs, 11);
  assert.equal(manifest.constants.rootWindowLedgers, 1440);
  assert.equal(manifest.constants.addressPayloadBytes, PRIVATE_ADDRESS_PAYLOAD_BYTES);
  assert.equal(manifest.constants.addressAsciiBytes, PRIVATE_ADDRESS_TESTNET_ASCII_BYTES);
  assert.match(manifest.assetContractId, /^C[A-Z2-7]{55}$/);
  assert.match(manifest.stealthAnnouncerAddress, /^G[A-Z2-7]{55}$/);
  assert.equal(manifest.artifacts.zkeyTransport.encoding, 'points-compressed');
  assert.match(manifest.artifacts.zkeyTransport.sha256, /^[0-9a-f]{64}$/);
  assert.ok(manifest.artifacts.zkeyTransport.byteLength < manifest.artifacts.zkeyByteLength);
  assert.ok(manifest.artifacts.zkeyTransport.wireByteLength < manifest.artifacts.zkeyTransport.byteLength);
  assert.match(manifest.release.contractWasmSha256, /^[0-9a-f]{64}$/);
  assert.equal(
    manifest.release.powersOfTauSha256,
    '489be9e5ac65d524f7b1685baac8a183c6e77924fdb73d2b8105e335f277895d',
  );
  assert.equal(manifest.release.zkeyVerified, true);
  assert.equal(manifest.release.allowedEnvironment, 'testnet');
});

test('manifest: rejects private-payment deployments outside Stellar testnet', () => {
  const raw = JSON.parse(readFileSync(manifestPath, 'utf8'));

  assert.throws(
    () => validateManifest({ ...raw, networkPassphrase: Networks.PUBLIC }),
    /testnet only/i,
  );
});

test('manifest: rejects incomplete or oversized proving-key transport metadata', () => {
  const raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.throws(
    () => validateManifest({
      ...raw,
      artifacts: {
        ...raw.artifacts,
        zkeyTransport: { encoding: 'points-compressed', sha256: 'aa'.repeat(32) },
      },
    }),
    /zkeyTransport\.byteLength/i,
  );
  assert.throws(
    () => validateManifest({
      ...raw,
      artifacts: {
        ...raw.artifacts,
        zkeyTransport: {
          encoding: 'points-compressed',
          sha256: 'aa'.repeat(32),
          byteLength: raw.artifacts.zkeyByteLength + 1,
          wireByteLength: 1,
        },
      },
    }),
    /zkeyTransport.*smaller/i,
  );
});

test('manifest: rejects malformed manifest', () => {
  assert.throws(() => validateManifest(null), /Manifest must be a non-null object/);
  assert.throws(() => validateManifest({ schemaVersion: 2 }), /Unsupported schemaVersion/);
  assert.throws(() => validateManifest({ schemaVersion: 1, protocolVersion: 2 }), /Unsupported protocolVersion/);
  assert.throws(() => validateManifest({ schemaVersion: 1, protocolVersion: 1, status: 'invalid' }), /Invalid manifest status/);
});

test('manifest: requires one pinned asset contract', () => {
  const raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.throws(() => validateManifest({ ...raw, assetContractId: undefined }), /assetContractId/i);
  assert.throws(() => validateManifest({ ...raw, assetContractId: raw.guardianAddress }), /assetContractId/i);
});

test('manifest: requires a classic account as the stealth announcement sink', () => {
  const raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.throws(
    () => validateManifest({ ...raw, stealthAnnouncerAddress: undefined }),
    /stealthAnnouncerAddress is invalid/,
  );
  assert.throws(
    () => validateManifest({ ...raw, stealthAnnouncerAddress: raw.poolContractId }),
    /stealthAnnouncerAddress is invalid/,
  );
});

test('manifest: requires a clean independent witness URL and deployment checkpoint', () => {
  const raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const complete = {
    ...raw,
    witnessRpcUrl: 'https://soroban-rpc.testnet.stellar.gateway.fm/',
    deploymentCheckpoint: { ledger: 123, hash: 'ab'.repeat(32) },
    constants: {
      ...raw.constants,
      outgoingEnvelopeBytes: 157,
      outputPackageBytes: 370,
      addressPayloadBytes: 84,
      addressAsciiBytes: 128,
      addressContextTagBytes: 16,
      addressChecksumBytes: 4,
    },
  };

  const parsed = validateManifest(complete);
  assert.equal(parsed.witnessRpcUrl, 'https://soroban-rpc.testnet.stellar.gateway.fm');
  assert.deepEqual(parsed.deploymentCheckpoint, { ledger: 123, hash: 'ab'.repeat(32) });
  assert.throws(
    () => validateManifest({ ...complete, witnessRpcUrl: undefined }),
    /witnessRpcUrl is invalid/,
  );
  assert.throws(
    () => validateManifest({ ...complete, witnessRpcUrl: 'http://witness.example.test' }),
    /witnessRpcUrl requires HTTPS/,
  );
  assert.throws(
    () => validateManifest({ ...complete, witnessRpcUrl: 'https://witness.example.test/?account=1' }),
    /credentials, query, or fragment/,
  );
  assert.throws(
    () => validateManifest({ ...complete, deploymentCheckpoint: { ledger: -1, hash: 'ab'.repeat(32) } }),
    /deploymentCheckpoint\.ledger/,
  );
  assert.throws(
    () => validateManifest({ ...complete, deploymentCheckpoint: { ledger: 123, hash: 'AB'.repeat(32) } }),
    /lowercase hex/,
  );
});

test('manifest: rejects consensus constant drift', () => {
  const raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.throws(
    () => validateManifest({ ...raw, constants: { ...raw.constants, publicInputs: 13 } }),
    /publicInputs/,
  );
});

test('manifest: requires the Protocol 25 BN254 and Poseidon host baseline', () => {
  const raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.throws(
    () => validateManifest({ ...raw, minimumStellarProtocol: 24 }),
    /minimumStellarProtocol.*25/i,
  );
  assert.equal(
    validateManifest({ ...raw, minimumStellarProtocol: 25 }).minimumStellarProtocol,
    25,
  );
});

test('manifest: every non-development release requires verified proving and release evidence', () => {
  const raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const published = {
    ...raw,
    status: 'testnet-beta',
    poolContractId: 'CBBPOAHEJABZ56QJHFB3MJAEJUHPOSBD3DJBSUPXRZBC2KQVESQX7BFX',
    guardianAddress: 'GCWEMAKEF6WW6G44RRBGU43B5FB2T2EZVSBZFGLX4OTVROBPWVR574WA',
    deploymentCheckpoint: { ledger: 1, hash: '11'.repeat(32) },
    deploymentBindingHash: '22'.repeat(32),
  };
  assert.throws(
    () => validateManifest({ ...published, release: undefined }),
    /release provenance is required/i,
  );
  assert.throws(
    () => validateManifest(published),
    /release provenance is incomplete/i,
  );
  assert.throws(
    () => validateManifest({ ...published, status: 'testnet-preview' }),
    /release provenance is incomplete/i,
  );
});

test('manifest: quarantined development proving material is local-development only', () => {
  const raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const preview = validateManifest(raw);

  assert.equal(preview.release.ceremonyTranscriptRoot, '0'.repeat(64));
  assert.deepEqual(preview.release.auditReports, []);
  assert.deepEqual(
    manifestModule.privateBalanceAvailability(preview, 'testnet'),
    { ready: false, reason: 'Private Balance is still using development artifacts.' },
  );
  assert.deepEqual(
    manifestModule.privateBalanceAvailability(preview, 'testnet', {
      allowDevelopmentFixture: true,
    }),
    { ready: true },
  );
  assert.deepEqual(
    manifestModule.privateBalanceAvailability(preview, 'mainnet'),
    {
      ready: false,
      reason: 'Private Payments are available on Stellar testnet only.',
    },
  );
});

test('manifest: wallet build pins the exact shipped manifest SHA-256', () => {
  const bytes = readFileSync(manifestPath);
  const expected = createHash('sha256').update(bytes).digest('hex');

  assert.match(manifestModule.EXPECTED_PRIVATE_BALANCE_MANIFEST_SHA256, /^[0-9a-f]{64}$/);
  assert.equal(manifestModule.EXPECTED_PRIVATE_BALANCE_MANIFEST_SHA256, expected);
});

test('manifest: generator binds exact toolchains and defaults to an undeployed build', () => {
  const source = readFileSync(
    join(process.cwd(), 'protocol/private-balance/scripts/generate-manifest.mjs'),
    'utf8',
  );
  const buildSource = readFileSync(
    join(process.cwd(), 'protocol/private-balance/scripts/build-private-balance-artifacts.mjs'),
    'utf8',
  );

  assert.match(source, /protocol\/private-balance\/rust-toolchain\.toml/);
  assert.match(source, /protocol\/private-balance\/parameters\/generator\.lock/);
  assert.match(source, /protocol\/private-balance\/scripts\/build-private-balance-artifacts\.mjs/);
  assert.match(source, /soroban-rpc\.testnet\.stellar\.gateway\.fm/);
  assert.match(source, /deploymentCheckpoint/);
  assert.match(source, /const zkeyVerified = verifyProvingKey\(\)/);
  assert.doesNotMatch(source, /zkeyVerified:\s*true/);
  assert.match(source, /\['log', '-1', '--format=%H', '--'/);
  assert.doesNotMatch(source, /existing\.release\?\.contractSourceCommit/);
  assert.match(buildSource, /STELLAR_CLI_VERSION = '27\.0\.0'/);
  assert.match(buildSource, /'contract',\s*'build'/);
  assert.match(buildSource, /'--optimize=false'/);
  assert.doesNotMatch(source, /artifactVersion: '1\.0\.2-testnet-preview'/);
  assert.doesNotMatch(source, /status: 'testnet-preview'/);
  assert.match(source, /process\.argv\.includes\('--publish-deployment'\)/);
  assert.match(source, /existsSync\(fixtureDir\)/);
  assert.match(source, /ALLOW_PRIVATE_BALANCE_DEVELOPMENT_FIXTURE = false/);
  assert.match(source, /deployments: \[\]/);
});

test('manifest: deployment publication requires an explicit flag and matching evidence', () => {
  const source = readFileSync(
    join(process.cwd(), 'protocol/private-balance/scripts/generate-manifest.mjs'),
    'utf8',
  );
  const publishFlag = source.indexOf("process.argv.includes('--publish-deployment')");
  const publicationBranch = source.indexOf('if (publishDeployment)');
  const evidenceLoad = source.indexOf(
    'const deploymentEvidence = loadTestnetDeploymentEvidence(baseManifest);',
  );
  const publicManifestWrite = source.indexOf("writeFileSync(join(publicDir, 'manifest.json')");
  const expectedHashWrite = source.indexOf('expectedManifestModule,');

  assert.notEqual(publishFlag, -1, 'deployment publication must be explicit');
  assert.notEqual(publicationBranch, -1, 'the generator must branch for deployment publication');
  assert.ok(publicationBranch < evidenceLoad, 'evidence must load only during publication');
  assert.ok(evidenceLoad < publicManifestWrite, 'only verified evidence may publish the manifest');
  assert.ok(evidenceLoad < expectedHashWrite, 'only verified evidence may update the wallet hash pin');
  assert.match(source.slice(0, publicationBranch), /protocol\/private-balance\/manifests\/development\.json/);
});

test('manifest: generator pins an empty catalogue until replacement pools are deployed', () => {
  const catalogueBytes = readFileSync(cataloguePath);
  const catalogueHash = createHash('sha256').update(catalogueBytes).digest('hex');
  const catalogue = assetsModule.validatePrivateBalanceCatalogue(JSON.parse(catalogueBytes));
  const generator = readFileSync(
    join(process.cwd(), 'protocol/private-balance/scripts/generate-manifest.mjs'),
    'utf8',
  );

  assert.equal(catalogueHash, assetsModule.EXPECTED_PRIVATE_BALANCE_CATALOGUE_SHA256);
  assert.deepEqual(catalogue.deployments, []);
  assert.match(generator, /catalogue\.json/);
  assert.match(generator, /private-balance-expected-catalogue\.ts/);
});

test('manifest: loader authenticates exact bytes before schema validation', async () => {
  const bytes = readFileSync(manifestPath);
  const load = manifestModule.loadExpectedPrivateBalanceManifest;
  assert.equal(typeof load, 'function');

  const loaded = await load({
    fetchImpl: async () => new Response(bytes, {
      status: 200,
      headers: { 'content-length': String(bytes.byteLength) },
    }),
  });
  assert.equal(loaded.manifest.status, 'development');
  assert.equal(loaded.manifestHash, manifestModule.EXPECTED_PRIVATE_BALANCE_MANIFEST_SHA256);

  const modified = Buffer.concat([bytes.subarray(0, -1), Buffer.from(' \n')]);
  await assert.rejects(
    () => load({ fetchImpl: async () => new Response(modified, { status: 200 }) }),
    /manifest hash mismatch/i,
  );
});

test('manifest: loader rejects oversized bodies before reading them', async () => {
  let bodyRead = false;
  const load = manifestModule.loadExpectedPrivateBalanceManifest;
  assert.equal(typeof load, 'function');

  await assert.rejects(
    () => load({
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-length': '65537' }),
        body: {
          getReader() {
            bodyRead = true;
            throw new Error('body should not be read');
          },
        },
      }),
    }),
    /manifest size exceeds/i,
  );
  assert.equal(bodyRead, false);
});

test('manifest: optional mirror base URL requires a clean HTTPS or loopback origin', () => {
  const raw = JSON.parse(readFileSync(manifestPath, 'utf8'));

  assert.equal(validateManifest(raw).mirrorBaseUrl, undefined);
  assert.equal(
    validateManifest({ ...raw, mirrorBaseUrl: 'https://mirror.example.test/archive/' }).mirrorBaseUrl,
    'https://mirror.example.test/archive/',
  );
  assert.equal(
    validateManifest({ ...raw, mirrorBaseUrl: 'http://localhost:8787/' }).mirrorBaseUrl,
    'http://localhost:8787/',
  );
  assert.throws(
    () => validateManifest({ ...raw, mirrorBaseUrl: 'http://mirror.example.test/' }),
    /HTTPS or a loopback/,
  );
  assert.throws(
    () => validateManifest({ ...raw, mirrorBaseUrl: 'https://mirror.example.test/?next=1' }),
    /credentials, query, or fragment/,
  );
  assert.throws(() => validateManifest({ ...raw, mirrorBaseUrl: 'not a url' }), /mirrorBaseUrl is invalid/);
});
