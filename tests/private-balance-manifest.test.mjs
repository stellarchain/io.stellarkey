import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Networks } from '@stellar/stellar-sdk';
import * as manifestModule from '../src/lib/private-balance-manifest.ts';
import * as assetsModule from '../src/lib/private-balance-assets.ts';

const { validateManifest } = manifestModule;
const manifestPath = join(process.cwd(), 'public/protocol/private-balance/v1/manifest.json');
const cataloguePath = join(process.cwd(), 'public/protocol/private-balance/v1/catalogue.json');

test('manifest: validates real manifest.json successfully', () => {
  const raw = JSON.parse(readFileSync(manifestPath, 'utf8'));

  const manifest = validateManifest(raw);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.protocolVersion, 1);
  assert.equal(manifest.status, 'development');
  assert.equal(manifest.constants.treeDepth, 32);
  assert.equal(manifest.constants.pageCapacity, 32);
  assert.equal(manifest.constants.publicInputs, 13);
  assert.equal(manifest.constants.rootWindowLedgers, 1440);
  assert.equal(manifest.constants.addressAsciiBytes, 119);
  assert.match(manifest.stealthAnnouncerAddress, /^G[A-Z2-7]{55}$/);
  assert.equal(manifest.artifacts.zkeyTransport.encoding, 'points-compressed');
  assert.match(manifest.artifacts.zkeyTransport.sha256, /^[0-9a-f]{64}$/);
  assert.ok(manifest.artifacts.zkeyTransport.byteLength < manifest.artifacts.zkeyByteLength);
  assert.ok(manifest.artifacts.zkeyTransport.wireByteLength < manifest.artifacts.zkeyTransport.byteLength);
  assert.match(manifest.release.contractWasmSha256, /^[0-9a-f]{64}$/);
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

test('manifest: rejects consensus constant drift', () => {
  const raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.throws(
    () => validateManifest({ ...raw, constants: { ...raw.constants, pageCapacity: 256 } }),
    /pageCapacity/,
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

test('manifest: beta and production releases require ceremony, audit, and deployment evidence', () => {
  const raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.throws(
    () => validateManifest({ ...raw, status: 'testnet-beta', release: undefined }),
    /release provenance is required/i,
  );
  assert.throws(
    () => validateManifest({ ...raw, status: 'testnet-beta' }),
    /release provenance is incomplete/i,
  );
});

test('manifest: wallet build pins the exact shipped manifest SHA-256', () => {
  const bytes = readFileSync(manifestPath);
  const expected = createHash('sha256').update(bytes).digest('hex');

  assert.match(manifestModule.EXPECTED_PRIVATE_BALANCE_MANIFEST_SHA256, /^[0-9a-f]{64}$/);
  assert.equal(manifestModule.EXPECTED_PRIVATE_BALANCE_MANIFEST_SHA256, expected);
});

test('manifest: generator binds exact toolchains and the latest contract source commit', () => {
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
  assert.match(source, /\['log', '-1', '--format=%H', '--'/);
  assert.doesNotMatch(source, /existing\.release\?\.contractSourceCommit/);
  assert.match(buildSource, /STELLAR_CLI_VERSION = '27\.0\.0'/);
  assert.match(buildSource, /'contract',\s*'build'/);
  assert.match(buildSource, /'--optimize=false'/);
});

test('manifest: deployment preparation stages artifacts without publishing unverified evidence', () => {
  const source = readFileSync(
    join(process.cwd(), 'protocol/private-balance/scripts/generate-manifest.mjs'),
    'utf8',
  );
  const prepareFlag = source.indexOf("process.argv.includes('--prepare-deployment')");
  const preparationBranch = source.indexOf('if (prepareDeployment)');
  const evidenceLoad = source.indexOf(
    'const deploymentEvidence = loadTestnetDeploymentEvidence(baseManifest);',
  );
  const publicManifestWrite = source.indexOf("writeFileSync(join(publicDir, 'manifest.json')");
  const expectedHashWrite = source.indexOf('expectedManifestModule,');

  assert.notEqual(prepareFlag, -1, 'the deployment preparation mode must be explicit');
  assert.notEqual(preparationBranch, -1, 'the generator must branch for deployment preparation');
  assert.ok(preparationBranch < evidenceLoad, 'preparation must finish before evidence is loaded');
  assert.ok(evidenceLoad < publicManifestWrite, 'only verified evidence may publish the manifest');
  assert.ok(evidenceLoad < expectedHashWrite, 'only verified evidence may update the wallet hash pin');
  assert.match(
    source.slice(preparationBranch, evidenceLoad),
    /protocol\/private-balance\/manifests\/development\.json/,
  );
});

test('manifest: generator pins a reproducible private-asset catalogue to the exact manifest', () => {
  const catalogueBytes = readFileSync(cataloguePath);
  const catalogueHash = createHash('sha256').update(catalogueBytes).digest('hex');
  const catalogue = assetsModule.validatePrivateBalanceCatalogue(JSON.parse(catalogueBytes));
  const generator = readFileSync(
    join(process.cwd(), 'protocol/private-balance/scripts/generate-manifest.mjs'),
    'utf8',
  );

  assert.equal(catalogueHash, assetsModule.EXPECTED_PRIVATE_BALANCE_CATALOGUE_SHA256);
  assert.ok(catalogue.deployments.length >= 1);
  const pool = catalogue.deployments.find(deployment => deployment.id === 'testnet-private-pool-v2');
  assert.ok(pool);
  const xlm = pool.assets.find(asset => asset.kind === 'native');
  assert.ok(xlm);
  assert.equal(xlm.code, 'XLM');
  assert.equal(pool.assets.some(asset => asset.code === 'USDC'), true);
  assert.equal(pool.manifestSha256, manifestModule.EXPECTED_PRIVATE_BALANCE_MANIFEST_SHA256);
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
