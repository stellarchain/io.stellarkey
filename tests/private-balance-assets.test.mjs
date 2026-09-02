import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  loadExpectedPrivateBalanceCatalogue,
  loadPrivateBalanceDeployments,
  privateBalanceAssetKey,
  validatePrivateBalanceCatalogue,
} from '../src/lib/private-balance-assets.ts';
import { validateManifest } from '../src/lib/private-balance-manifest.ts';

const XLM_CONTRACT = 'CBUSYNQKASUYFWYC3M2GUEDMX4AIVWPALDBYJPNK6554BREHTGZ2IUNF';
const USDC_CONTRACT = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const HASH_A = '11'.repeat(32);

const xlm = () => ({
  kind: 'native', code: 'XLM', issuer: null, name: 'Stellar Lumens',
  decimals: 7, displayDecimals: 7, contractId: XLM_CONTRACT,
});
const usdc = () => ({
  kind: 'stellar', code: 'USDC', issuer: USDC_ISSUER, name: 'USD Coin',
  decimals: 7, displayDecimals: 2, contractId: USDC_CONTRACT,
});

function poolDeployment(overrides = {}) {
  return {
    id: 'testnet-private-xlm',
    network: 'testnet',
    asset: xlm(),
    manifestUrl: '/protocol/private-balance/v1/xlm/manifest.json',
    manifestSha256: HASH_A,
    ...overrides,
  };
}

function developmentManifest(assetContractId = XLM_CONTRACT) {
  return validateManifest({
    schemaVersion: 1,
    protocolVersion: 1,
    artifactVersion: 'test',
    status: 'development',
    minimumStellarProtocol: 25,
    networkPassphrase: 'Test SDF Network ; September 2015',
    networkId: 'cee0302d59844d32bdca915c8203dd44b33fbb7edc19051ea37abedf28ecd472',
    realmId: '02'.repeat(32),
    poolContractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAITA4',
    assetContractId,
    guardianAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    stealthAnnouncerAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    witnessRpcUrl: 'https://witness.example.test',
    deploymentCheckpoint: { ledger: 0, hash: '00'.repeat(32) },
    deploymentBindingHash: '33'.repeat(32),
    artifacts: {
      r1csSha256: '44'.repeat(32), r1csConstraints: 1,
      wasmSha256: '55'.repeat(32), wasmByteLength: 1,
      zkeySha256: '66'.repeat(32), zkeyByteLength: 1,
      vkJsonSha256: '77'.repeat(32), vkBinSha256: '88'.repeat(32),
    },
    constants: {
      treeDepth: 17, treeArity: 3, rootWindowLedgers: 1440,
      publicInputs: 11,
      notePlaintextBytes: 128, recipientEnvelopeBytes: 181,
      outgoingEnvelopeBytes: 157, outputPackageBytes: 370,
      addressPayloadBytes: 84, addressAsciiBytes: 128,
      addressContextTagBytes: 16, addressChecksumBytes: 4,
    },
    hpke: { kemId: '0x0020', kdfId: '0x0001', aeadId: '0x0001' },
  });
}

test('private asset catalogue validates exactly one asset per pool', () => {
  const catalogue = validatePrivateBalanceCatalogue({
    schemaVersion: 1,
    deployments: [
      poolDeployment(),
      poolDeployment({
        id: 'testnet-private-usdc',
        asset: usdc(),
        manifestUrl: '/protocol/private-balance/v1/usdc/manifest.json',
      }),
    ],
  });
  assert.equal(catalogue.deployments.length, 2);
  assert.equal(privateBalanceAssetKey(catalogue.deployments[0].asset), 'native');
  assert.equal(privateBalanceAssetKey(catalogue.deployments[1].asset), `USDC:${USDC_ISSUER}`);
  assert.throws(
    () => validatePrivateBalanceCatalogue({
      schemaVersion: 1,
      deployments: [{ ...poolDeployment(), asset: undefined, assets: [xlm(), usdc()] }],
    }),
    /asset/i,
  );
});

test('private asset catalogue rejects duplicate identities and unsafe metadata', () => {
  const validate = deployments => validatePrivateBalanceCatalogue({ schemaVersion: 1, deployments });
  assert.throws(
    () => validate([poolDeployment(), poolDeployment({ id: 'other-pool' })]),
    /duplicate asset/i,
  );
  assert.throws(
    () => validate([poolDeployment({ manifestUrl: 'https://evil.example/manifest.json' })]),
    /manifestUrl/i,
  );
  assert.throws(() => validate([poolDeployment({ asset: { ...usdc(), issuer: null } })]), /issuer/i);
  assert.throws(
    () => validate([poolDeployment({ asset: { ...usdc(), name: 'USD\nCoin' } })]),
    /name/i,
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
  assert.equal(loaded.catalogue.deployments[0].asset.code, 'XLM');
  await assert.rejects(
    () => loadExpectedPrivateBalanceCatalogue({
      expectedHash,
      fetchImpl: async () => new Response(Buffer.concat([bytes, Buffer.from(' ')]), { status: 200 }),
    }),
    /catalogue hash mismatch/i,
  );
});

test('authenticated pools expose only their manifest-pinned asset', async () => {
  const manifest = developmentManifest();
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
  const manifestHash = createHash('sha256').update(manifestBytes).digest('hex');
  const catalogue = {
    schemaVersion: 1,
    deployments: [poolDeployment({ manifestSha256: manifestHash })],
  };
  const deployments = await loadPrivateBalanceDeployments({
    catalogue,
    network: 'testnet',
    fetchImpl: async url => {
      assert.equal(url, poolDeployment().manifestUrl);
      return new Response(manifestBytes, { status: 200 });
    },
  });
  assert.equal(deployments.length, 1);
  assert.deepEqual(deployments.map(option => option.asset.code), ['XLM']);
  assert.equal(new Set(deployments.map(option => option.poolDeploymentId)).size, 1);
  assert.equal(deployments[0].manifestHash, manifestHash);
});

test('authenticated pool rejects a catalogue asset that differs from its manifest pin', async () => {
  const manifest = developmentManifest(XLM_CONTRACT);
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
  const manifestHash = createHash('sha256').update(manifestBytes).digest('hex');
  await assert.rejects(
    () => loadPrivateBalanceDeployments({
      catalogue: {
        schemaVersion: 1,
        deployments: [poolDeployment({ asset: usdc(), manifestSha256: manifestHash })],
      },
      network: 'testnet',
      fetchImpl: async () => new Response(manifestBytes, { status: 200 }),
    }),
    /asset does not match its manifest/i,
  );
});
