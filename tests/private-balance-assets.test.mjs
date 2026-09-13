import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  loadExpectedPrivateBalanceCatalogue,
  loadPrivateBalanceDeployments,
  privateBalanceAssetKey,
  reconcilePrivateBalanceRegistry,
  validatePrivateBalanceCatalogue,
} from '../src/lib/private-balance-assets.ts';
import { validateManifest } from '../src/lib/private-balance-manifest.ts';

const XLM_CONTRACT = 'CBUSYNQKASUYFWYC3M2GUEDMX4AIVWPALDBYJPNK6554BREHTGZ2IUNF';
const USDC_CONTRACT = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const HASH_A = '11'.repeat(32);

const assets = () => [
  {
    index: 0, kind: 'native', code: 'XLM', issuer: null, name: 'Stellar Lumens',
    decimals: 7, displayDecimals: 7, contractId: XLM_CONTRACT,
  },
  {
    index: 1, kind: 'stellar', code: 'USDC', issuer: USDC_ISSUER, name: 'USD Coin',
    decimals: 7, displayDecimals: 2, contractId: USDC_CONTRACT,
  },
];

function poolDeployment(overrides = {}) {
  return {
    id: 'testnet-private-pool',
    network: 'testnet',
    manifestUrl: '/protocol/private-balance/v1/manifest.json',
    manifestSha256: HASH_A,
    ...overrides,
  };
}

function developmentManifest(assetOverrides = assets()) {
  return validateManifest({
    schemaVersion: 1,
    protocolVersion: 2,
    artifactVersion: 'test',
    status: 'development',
    minimumStellarProtocol: 25,
    networkPassphrase: 'Test SDF Network ; September 2015',
    networkId: 'cee0302d59844d32bdca915c8203dd44b33fbb7edc19051ea37abedf28ecd472',
    realmId: '02'.repeat(32),
    poolContractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAITA4',
    guardianAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    assetAdminAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    assets: assetOverrides,
    stealthAnnouncerAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    witnessRpcUrl: 'https://witness.example.test',
    deploymentCheckpoint: { ledger: 0, hash: '00'.repeat(32) },
    registryCheckpoint: { ledger: 0, hash: '00'.repeat(32), assetCount: assetOverrides.length },
    deploymentBindingHash: '33'.repeat(32),
    artifacts: {
      r1csSha256: '44'.repeat(32), r1csConstraints: 1,
      wasmSha256: '55'.repeat(32), wasmByteLength: 1,
      zkeySha256: '66'.repeat(32), zkeyByteLength: 1,
      vkJsonSha256: '77'.repeat(32), vkBinSha256: '88'.repeat(32),
    },
    constants: {
      treeDepth: 64, treeArity: 3, rootWindowLedgers: 1440,
      publicInputs: 11,
      notePlaintextBytes: 128, recipientEnvelopeBytes: 181,
      outgoingEnvelopeBytes: 157, outputPackageBytes: 370, outputsPerAction: 3,
      addressPayloadBytes: 84, addressAsciiBytes: 128,
      addressContextTagBytes: 16, addressChecksumBytes: 4,
    },
    hpke: { kemId: '0x0020', kdfId: '0x0001', aeadId: '0x0001' },
  });
}

test('catalogue describes one shared pool and never claims asset admission authority', () => {
  const catalogue = validatePrivateBalanceCatalogue({
    schemaVersion: 1,
    deployments: [poolDeployment()],
  });
  assert.equal(catalogue.deployments.length, 1);
  assert.throws(
    () => validatePrivateBalanceCatalogue({
      schemaVersion: 1,
      deployments: [{ ...poolDeployment(), assets: assets() }],
    }),
    /admission authority/i,
  );
  assert.throws(
    () => validatePrivateBalanceCatalogue({
      schemaVersion: 1,
      deployments: [poolDeployment(), poolDeployment({ id: 'second-pool' })],
    }),
    /more than one testnet pool/i,
  );
});

test('manifest metadata uses contiguous immutable registry indices', () => {
  const manifest = developmentManifest();
  assert.deepEqual(manifest.assets.map(asset => asset.index), [0, 1]);
  assert.equal(privateBalanceAssetKey(manifest.assets[0]), 'native');
  assert.equal(privateBalanceAssetKey(manifest.assets[1]), `USDC:${USDC_ISSUER}`);
  assert.throws(
    () => developmentManifest([{ ...assets()[0], index: 1 }]),
    /contiguous and immutable/i,
  );
  assert.throws(
    () => developmentManifest([assets()[0], { ...assets()[1], contractId: XLM_CONTRACT }]),
    /duplicate contractId/i,
  );
});

test('private asset catalogue authenticates exact bounded bytes before parsing', async () => {
  const bytes = Buffer.from(`${JSON.stringify({
    schemaVersion: 1,
    deployments: [poolDeployment()],
  }, null, 2)}\n`);
  const expectedHash = createHash('sha256').update(bytes).digest('hex');
  const loaded = await loadExpectedPrivateBalanceCatalogue({
    expectedHash,
    fetchImpl: async () => new Response(bytes, {
      status: 200,
      headers: { 'content-length': String(bytes.byteLength) },
    }),
  });
  assert.equal(loaded.catalogueHash, expectedHash);
  assert.equal(loaded.catalogue.deployments[0].id, 'testnet-private-pool');
  await assert.rejects(
    () => loadExpectedPrivateBalanceCatalogue({
      expectedHash,
      fetchImpl: async () => new Response(Buffer.concat([bytes, Buffer.from(' ')]), { status: 200 }),
    }),
    /catalogue hash mismatch/i,
  );
});

test('one authenticated pool exposes all curated registry assets with one pool identity', async () => {
  const manifest = developmentManifest();
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
  const manifestHash = createHash('sha256').update(manifestBytes).digest('hex');
  const deployment = poolDeployment({ manifestSha256: manifestHash });
  const deployments = await loadPrivateBalanceDeployments({
    catalogue: { schemaVersion: 1, deployments: [deployment] },
    network: 'testnet',
    fetchImpl: async url => {
      assert.equal(url, deployment.manifestUrl);
      return new Response(manifestBytes, { status: 200 });
    },
  });
  assert.deepEqual(deployments.map(option => option.asset.code), ['XLM', 'USDC']);
  assert.equal(new Set(deployments.map(option => option.poolDeploymentId)).size, 1);
  assert.equal(deployments[0].manifestHash, manifestHash);
  assert.deepEqual(deployments.map(option => option.asset.status), ['active', 'active']);

  const addedContract = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAITA4';
  const reconciled = reconcilePrivateBalanceRegistry({
    deployments,
    registry: {
      adminAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      assets: [
        { index: 0, contractId: XLM_CONTRACT, assetField: new Uint8Array(32), status: 'active' },
        { index: 1, contractId: USDC_CONTRACT, assetField: new Uint8Array(32), status: 'exit-only' },
        { index: 2, contractId: addedContract, assetField: new Uint8Array(32), status: 'active' },
      ],
    },
    metadataByContract: new Map([[
      addedContract,
      { name: 'Example Token', symbol: 'EXT', decimals: 6 },
    ]]),
  });
  assert.deepEqual(reconciled.map(option => ({
    id: option.id,
    code: option.asset.code,
    status: option.asset.status,
  })), [
    { id: 'testnet-private-pool:0', code: 'XLM', status: 'active' },
    { id: 'testnet-private-pool:1', code: 'USDC', status: 'exit-only' },
    { id: 'testnet-private-pool:2', code: 'EXT', status: 'active' },
  ]);
  assert.equal(reconciled[2].asset.kind, 'contract');
  assert.throws(() => reconcilePrivateBalanceRegistry({
    deployments,
    registry: {
      adminAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      assets: [
        { index: 0, contractId: USDC_CONTRACT, assetField: new Uint8Array(32), status: 'active' },
        { index: 1, contractId: XLM_CONTRACT, assetField: new Uint8Array(32), status: 'active' },
      ],
    },
  }), /changed immutable index/i);
});
