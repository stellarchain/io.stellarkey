import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { Keypair, StrKey } from '@stellar/stellar-sdk';

import {
  TESTNET_USDC_ISSUER,
  TESTNET_USDC_SAC_ID,
  DEFAULT_TESTNET_FIXTURE_ASSETS,
  TESTNET_NETWORK_ID,
  TESTNET_PASSPHRASE,
  buildConstructorArguments,
  computeDeploymentBindingHash,
  createFixtureEntropy,
  fixtureAssetDescriptor,
  loadDeploymentWasm,
  parseFixtureArguments,
  sanitizeFixtureEvidence,
} from '../protocol/private-balance/scripts/testnet-fixture.mjs';

const source = readFileSync(
  new URL('../protocol/private-balance/scripts/testnet-fixture.mjs', import.meta.url),
  'utf8',
);

test('the replacement protocol publishes one current Testnet pool with XLM and USDC', () => {
  const fixtureDirectory = new URL(
    '../protocol/private-balance/results/fixtures/',
    import.meta.url,
  );
  const fixtureNames = existsSync(fixtureDirectory)
    ? readdirSync(fixtureDirectory)
      .filter(name => /^testnet-fixture-C[A-Z2-7]{55}\.json$/.test(name))
    : [];
  assert.equal(fixtureNames.length, 1);

  const catalogue = JSON.parse(readFileSync(
    new URL('../public/protocol/private-balance/v1/catalogue.json', import.meta.url),
    'utf8',
  ));
  assert.equal(catalogue.deployments.length, 1);
  const manifest = JSON.parse(readFileSync(
    new URL('../public/protocol/private-balance/v1/manifest.json', import.meta.url),
    'utf8',
  ));
  assert.equal(manifest.status, 'development');
  assert.deepEqual(manifest.assets.map(asset => asset.code), ['XLM', 'USDC']);
  assert.equal(
    manifest.witnessRpcUrl,
    'https://soroban-rpc.testnet.stellar.gateway.fm',
    'the browser witness must accept cross-origin Stellar SDK requests',
  );
  assert.ok(manifest.deploymentCheckpoint.ledger > 0);
  assert.match(manifest.deploymentCheckpoint.hash, /^[0-9a-f]{64}$/);
});

test('testnet fixture defaults to a non-mutating plan and requires explicit live consent', () => {
  assert.deepEqual(parseFixtureArguments([]), {
    assets: DEFAULT_TESTNET_FIXTURE_ASSETS,
    deploy: false,
    ephemeral: false,
    output: null,
    source: null,
  });
  assert.throws(() => parseFixtureArguments(['--deploy']), /source/i);
  assert.throws(
    () => parseFixtureArguments(['--deploy', '--source', 'alice']),
    /PRIVATE_BALANCE_TESTNET_DEPLOY=1/,
  );
  assert.deepEqual(
    parseFixtureArguments(
      ['--deploy', '--ephemeral', '--asset', `USDC:${TESTNET_USDC_ISSUER}`],
      { PRIVATE_BALANCE_TESTNET_DEPLOY: '1' },
    ),
    {
      assets: [`USDC:${TESTNET_USDC_ISSUER}`],
      deploy: true,
      ephemeral: true,
      output: null,
      source: null,
    },
  );
  assert.throws(
    () => parseFixtureArguments(
      ['--deploy', '--ephemeral', '--source', 'alice'],
      { PRIVATE_BALANCE_TESTNET_DEPLOY: '1' },
    ),
    /either --ephemeral or --source/i,
  );
  assert.doesNotMatch(source, /Math\.random|writeFileSync\([^)]*public\//);
});

test('testnet fixture accepts only canonical Stellar asset identifiers', () => {
  assert.deepEqual(fixtureAssetDescriptor('native'), {
    cliAsset: 'native',
    kind: 'native',
    code: 'XLM',
    issuer: null,
    name: 'Stellar Lumens',
    decimals: 7,
    displayDecimals: 7,
  });
  assert.deepEqual(fixtureAssetDescriptor(`USDC:${TESTNET_USDC_ISSUER}`), {
    cliAsset: `USDC:${TESTNET_USDC_ISSUER}`,
    kind: 'stellar',
    code: 'USDC',
    issuer: TESTNET_USDC_ISSUER,
    name: 'USD Coin',
    decimals: 7,
    displayDecimals: 2,
  });
  assert.equal(TESTNET_USDC_SAC_ID, 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA');
  assert.throws(() => fixtureAssetDescriptor('usdc:' + TESTNET_USDC_ISSUER), /canonical/i);
  assert.throws(() => fixtureAssetDescriptor('USDC'), /CODE:ISSUER/i);
  assert.throws(() => fixtureAssetDescriptor('USDC:' + 'G' + 'A'.repeat(55)), /issuer/i);
  assert.deepEqual(
    parseFixtureArguments(['--asset', 'native', '--asset', `USDC:${TESTNET_USDC_ISSUER}`]).assets,
    DEFAULT_TESTNET_FIXTURE_ASSETS,
  );
  assert.throws(() => parseFixtureArguments(['--asset', 'native', '--asset', 'native']), /distinct/i);
});

test('testnet fixture entropy is exact, independent, and rejects malformed providers', () => {
  let calls = 0;
  const entropy = createFixtureEntropy(size => {
    calls += 1;
    return Buffer.alloc(size, calls);
  });
  assert.equal(calls, 2);
  assert.equal(entropy.realmId, '01'.repeat(32));
  assert.equal(entropy.salt, '02'.repeat(32));
  assert.throws(() => createFixtureEntropy(() => Buffer.alloc(31)), /32 bytes/i);
  assert.throws(() => createFixtureEntropy(() => Buffer.alloc(32)), /non-zero/i);
});

test('deployment binding matches the canonical V1 fixture vector', () => {
  const guardian = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 5));
  const poolContractId = StrKey.encodeContract(Buffer.alloc(32, 3));
  const binding = {
    protocolVersion: 1,
    networkId: '01'.repeat(32),
    realmId: '02'.repeat(32),
    poolContractId,
    assetAdminAddress: guardian,
    guardianAddress: guardian,
    poseidon2ParameterHash: '06'.repeat(32),
    circuitHash: '07'.repeat(32),
    verificationKeyHash: '08'.repeat(32),
    treeDepth: 17,
    rootWindowLedgers: 1_440,
  };
  assert.equal(
    computeDeploymentBindingHash(binding),
    '1a9133f26d4a002631b097040561e2423c525a10c705678f3d0e9645879ab173',
  );
});

test('constructor arguments bind the public testnet and exact deployment hash', () => {
  const guardianAddress = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 9)).publicKey();
  const poolContractId = StrKey.encodeContract(Buffer.alloc(32, 10));
  const argumentsList = buildConstructorArguments({
    realmId: '12'.repeat(32),
    poolContractId,
    guardianAddress,
    assetAdminAddress: guardianAddress,
  });
  assert.equal(TESTNET_NETWORK_ID, 'cee0302d59844d32bdca915c8203dd44b33fbb7edc19051ea37abedf28ecd472');
  assert.equal(TESTNET_PASSPHRASE, 'Test SDF Network ; September 2015');
  assert.deepEqual(argumentsList.slice(0, 4), [
    '--protocol_version',
    '1',
    '--network_id',
    TESTNET_NETWORK_ID,
  ]);
  assert.ok(argumentsList.includes('--deployment_binding_hash'));
  assert.equal(argumentsList[argumentsList.indexOf('--asset_admin') + 1], guardianAddress);
  assert.equal(argumentsList.includes('--asset'), false);
  const bindingIndex = argumentsList.indexOf('--deployment_binding_hash');
  assert.match(argumentsList[bindingIndex + 1], /^[0-9a-f]{64}$/);
  const development = JSON.parse(readFileSync(
    new URL('../protocol/private-balance/manifests/development.json', import.meta.url),
    'utf8',
  ));
  assert.equal(
    argumentsList[argumentsList.indexOf('--circuit_hash') + 1],
    development.artifacts.r1csSha256,
  );
  assert.equal(
    argumentsList[argumentsList.indexOf('--verification_key_hash') + 1],
    development.artifacts.vkBinSha256,
  );
  assert.doesNotMatch(source, /const CIRCUIT_HASH\s*=/);
  assert.doesNotMatch(source, /const VERIFICATION_KEY_HASH\s*=/);
});

test('testnet fixture deploys the exact manifest-pinned pool Wasm', () => {
  const deployment = loadDeploymentWasm();
  const development = JSON.parse(readFileSync(
    new URL('../protocol/private-balance/manifests/development.json', import.meta.url),
    'utf8',
  ));

  assert.equal(deployment.sha256, development.release.contractWasmSha256);
  assert.match(deployment.path, /public\/protocol\/private-balance\/v1\/pool\.wasm$/);
  assert.doesNotMatch(source, /stellar\(\['contract', 'build'/);
});

test('live fixture evidence pins the post-deployment ledger identity', () => {
  const deploy = source.indexOf("'contract', 'deploy'");
  const checkpoint = source.indexOf('await readTestnetDeploymentCheckpoint()');
  assert.notEqual(deploy, -1);
  assert.ok(checkpoint > deploy, 'the checkpoint must be captured after deployment and readback');
  assert.match(source, /method: 'getLatestLedger'/);
  assert.match(source, /signal: AbortSignal\.timeout\(8_000\)/);
  assert.match(
    source,
    /deploymentBindingHash,\s*\n\s*deploymentCheckpoint,\s*\n\s*registryCheckpoint,\s*\n\s*wasmSha256,/,
  );
  assert.match(
    source,
    /deploymentCheckpoint,\s*\n\s*registryCheckpoint,\s*\n\s*\}\);\s*\n\s*const evidence/,
  );
  assert.match(source, /schemaVersion: 2,/);
  assert.match(source, /registeredAssets,/);
});

test('fixture evidence never serializes a signer secret or local CLI path', () => {
  const evidence = sanitizeFixtureEvidence({
    schemaVersion: 1,
    networkPassphrase: TESTNET_PASSPHRASE,
    sourceAccount: 'G' + 'A'.repeat(55),
    sourceSecret: 'S' + 'A'.repeat(55),
    configDirectory: '/tmp/private-config',
    poolContractId: StrKey.encodeContract(Buffer.alloc(32, 4)),
  });
  assert.equal('sourceSecret' in evidence, false);
  assert.equal('configDirectory' in evidence, false);
  assert.equal(evidence.sourceAccount, 'G' + 'A'.repeat(55));
});
