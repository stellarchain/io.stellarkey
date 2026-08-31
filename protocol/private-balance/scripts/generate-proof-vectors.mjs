#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const protocolDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const circuitsDir = join(protocolDir, 'circuits');
const snarkjs = require(join(circuitsDir, 'node_modules/snarkjs/build/main.cjs'));
const buildDir = join(circuitsDir, 'build');
const wasmPath = join(buildDir, 'action_js/action.wasm');
const zkeyPath = join(buildDir, 'action_dev.zkey');
const helperWasmPath = join(buildDir, 'gadgets_helper_js/gadgets_helper.wasm');
const browserPackagePath = join(protocolDir, 'packages/browser/dist/index.js');
const {
  ActionKind,
  computeActionBinding,
  computeActionField,
  computeAssetField,
  computeContextField,
  computeContextHash,
  computeRelayerField,
} = await import(browserPackagePath);
const fromHex = (value) => Uint8Array.from(value.match(/../g), (byte) => Number.parseInt(byte, 16));
const fieldDecimal = (value) => BigInt(`0x${Buffer.from(value).toString('hex')}`).toString();
const directionBitsFor = (leafIndex) => {
  const value = BigInt(leafIndex);
  return Array.from({ length: 32 }, (_, index) => ((value >> BigInt(index)) & 1n).toString());
};

const helperWasm = readFileSync(helperWasmPath);
const wcModule = await import(join(circuitsDir, 'node_modules/circom_runtime/js/witness_calculator.js'));
const helper = await wcModule.default(helperWasm);

async function evalGadgets({ contextField, assetField, ask = '0', nk = '0', diversifier = '0', rho = '0', value = '0', leafIndex = '0', siblings = new Array(32).fill('0'), actionField = '0' }) {
  const wtns = await helper.calculateWitness({
    contextField: contextField.toString(),
    assetField: assetField.toString(),
    ask: ask.toString(),
    nk: nk.toString(),
    diversifier: diversifier.toString(),
    rho: rho.toString(),
    value: value.toString(),
    leafIndex: leafIndex.toString(),
    siblings: siblings.map(s => s.toString()),
    directionBits: directionBitsFor(leafIndex),
    actionField: actionField.toString(),
  });
  return {
    ownerCommitment: wtns[1].toString(),
    noteCommitment: wtns[2].toString(),
    nullifier: wtns[3].toString(),
    actionBinding: wtns[4].toString(),
    merkleRoot: wtns[5].toString(),
  };
}

async function generateVectors() {
  console.log('Generating proofs-v1.json...');

  const networkId = fromHex('cee0302d59844d32bdca915c8203dd44b33fbb7edc19051ea37abedf28ecd472');
  const realmId = new Uint8Array(32).fill(2);
  const poolId = new Uint8Array(32).fill(3);
  const assetId = fromHex('d7928b72c2703ccfeaf7eb9ff4ef4d504a55a8b979fc9b450ea2c842b4d1ce61');
  const asset = { kind: 1, payload: assetId };
  const assetField = fieldDecimal(computeAssetField(asset));
  const zero32 = new Uint8Array(32);
  const dummyOutput = { cm: zero32, recipientEnvelope: new Uint8Array(181) };
  const actionFieldDecimal = (action) => fieldDecimal(
    computeActionField(action, networkId, realmId, poolId),
  );
  const actionBindingDecimal = async (actionField) => fieldDecimal(
    await computeActionBinding(fromHex(BigInt(contextField).toString(16).padStart(64, '0')), fromHex(BigInt(actionField).toString(16).padStart(64, '0'))),
  );

  // 1. Deposit Vector
  const contextField = fieldDecimal(
    computeContextField(
      computeContextHash(
        1,
        networkId,
        realmId,
        poolId,
      ),
    ),
  );
  const depActionKindField = '1';
  const depAnchorRoot = '0';
  const depPublicValueField = '5000000';

  const depGadgets = await evalGadgets({
    contextField,
    assetField,
    ask: '111',
    nk: '222',
    rho: '77777',
    value: '5000000',
  });
  const depAction = {
    protocolVersion: 1,
    kind: ActionKind.Deposit,
    asset,
    actionNonce: new Uint8Array(32).fill(0x11),
    anchorRoot: zero32,
    nullifiers: [zero32, zero32],
    outputs: [
      {
        cm: fromHex(BigInt(depGadgets.noteCommitment).toString(16).padStart(64, '0')),
        recipientEnvelope: new Uint8Array(181).fill(0xaa),
      },
      dummyOutput,
    ],
    publicValue: 5_000_000n,
    relayerFee: 0n,
    depositSource: { kind: 0, payload: new Uint8Array(32).fill(4) },
  };
  const depActionField = actionFieldDecimal(depAction);
  const depActionBinding = await actionBindingDecimal(depActionField);

  const depInputs = {
    contextField,
    assetField,
    actionKindField: depActionKindField,
    anchorRoot: depAnchorRoot,
    publicValueField: depPublicValueField,
    relayerFeeField: '0',
    relayerField: '0',
    actionField: depActionField,
    actionBinding: depActionBinding,
    nullifier: ['0', '0'],
    outputCommitment: [depGadgets.noteCommitment, '0'],

    ask: '0',
    nk: '0',
    inputEnabled: ['0', '0'],
    inputOwnerCommitment: ['0', '0'],
    inputDiversifier: ['0', '0'],
    inputValue: ['0', '0'],
    inputRho: ['0', '0'],
    inputLeafIndex: ['0', '0'],
    inputSiblings: [new Array(32).fill('0'), new Array(32).fill('0')],
    inputDirectionBits: [directionBitsFor(0), directionBitsFor(0)],

    outputEnabled: ['1', '0'],
    outputOwnerCommitment: [depGadgets.ownerCommitment, '0'],
    outputValue: ['5000000', '0'],
    outputRho: ['77777', '0'],
  };

  const depositRes = await snarkjs.groth16.fullProve(depInputs, wasmPath, zkeyPath);

  // 2. Transfer Vector
  const trActionKindField = '2';
  const trPublicValueField = '0';
  const in0Res = await evalGadgets({
    contextField,
    assetField,
    ask: '11111',
    nk: '22222',
    diversifier: '7',
    rho: '33333',
    value: '10000000',
    leafIndex: '0',
    siblings: new Array(32).fill('0'),
  });

  const out0Res = await evalGadgets({
    contextField,
    assetField,
    ask: '88888',
    nk: '99999',
    rho: '44444',
    value: '6000000',
  });

  const out1Res = await evalGadgets({
    contextField,
    assetField,
    ask: '11111',
    nk: '22222',
    rho: '55555',
    value: '3999000',
  });
  const trAction = {
    protocolVersion: 1,
    kind: ActionKind.PrivateTransfer,
    asset,
    actionNonce: new Uint8Array(32).fill(0x22),
    anchorRoot: fromHex(BigInt(in0Res.merkleRoot).toString(16).padStart(64, '0')),
    nullifiers: [
      fromHex(BigInt(in0Res.nullifier).toString(16).padStart(64, '0')),
      zero32,
    ],
    outputs: [
      {
        cm: fromHex(BigInt(out0Res.noteCommitment).toString(16).padStart(64, '0')),
        recipientEnvelope: new Uint8Array(181).fill(0xbb),
      },
      {
        cm: fromHex(BigInt(out1Res.noteCommitment).toString(16).padStart(64, '0')),
        recipientEnvelope: new Uint8Array(181).fill(0xcc),
      },
    ],
    publicValue: 0n,
    relayerFee: 1_000n,
    relayer: { kind: 0, payload: new Uint8Array(32).fill(6) },
  };
  const trActionField = actionFieldDecimal(trAction);
  const trActionBinding = await actionBindingDecimal(trActionField);

  const trInputs = {
    contextField,
    assetField,
    actionKindField: trActionKindField,
    anchorRoot: in0Res.merkleRoot,
    publicValueField: trPublicValueField,
    relayerFeeField: '1000',
    relayerField: fieldDecimal(computeRelayerField(trAction)),
    actionField: trActionField,
    actionBinding: trActionBinding,
    nullifier: [in0Res.nullifier, '0'],
    outputCommitment: [out0Res.noteCommitment, out1Res.noteCommitment],

    ask: '11111',
    nk: '22222',
    inputEnabled: ['1', '0'],
    inputOwnerCommitment: [in0Res.ownerCommitment, '0'],
    inputDiversifier: ['7', '0'],
    inputValue: ['10000000', '0'],
    inputRho: ['33333', '0'],
    inputLeafIndex: ['0', '0'],
    inputSiblings: [new Array(32).fill('0'), new Array(32).fill('0')],
    inputDirectionBits: [directionBitsFor(0), directionBitsFor(0)],

    outputEnabled: ['1', '1'],
    outputOwnerCommitment: [out0Res.ownerCommitment, out1Res.ownerCommitment],
    outputValue: ['6000000', '3999000'],
    outputRho: ['44444', '55555'],
  };

  const transferRes = await snarkjs.groth16.fullProve(trInputs, wasmPath, zkeyPath);

  // 3. Withdraw Vector
  const wdActionKindField = '3';
  const wdPublicValueField = '7000000';
  const wdIn0Res = await evalGadgets({
    contextField,
    assetField,
    ask: '11111',
    nk: '22222',
    diversifier: '11',
    rho: '33333',
    value: '10000000',
    leafIndex: '0',
    siblings: new Array(32).fill('0'),
  });

  const wdOut0Res = await evalGadgets({
    contextField,
    assetField,
    ask: '11111',
    nk: '22222',
    rho: '66666',
    value: '2998000',
  });
  const wdAction = {
    protocolVersion: 1,
    kind: ActionKind.Withdraw,
    asset,
    actionNonce: new Uint8Array(32).fill(0x33),
    anchorRoot: fromHex(BigInt(wdIn0Res.merkleRoot).toString(16).padStart(64, '0')),
    nullifiers: [
      fromHex(BigInt(wdIn0Res.nullifier).toString(16).padStart(64, '0')),
      zero32,
    ],
    outputs: [
      {
        cm: fromHex(BigInt(wdOut0Res.noteCommitment).toString(16).padStart(64, '0')),
        recipientEnvelope: new Uint8Array(181).fill(0xdd),
      },
      dummyOutput,
    ],
    publicValue: 7_000_000n,
    publicRecipient: { kind: 0, payload: new Uint8Array(32).fill(5) },
    relayerFee: 2_000n,
    relayer: { kind: 0, payload: new Uint8Array(32).fill(6) },
  };
  const wdActionField = actionFieldDecimal(wdAction);
  const wdActionBinding = await actionBindingDecimal(wdActionField);

  const wdInputs = {
    contextField,
    assetField,
    actionKindField: wdActionKindField,
    anchorRoot: wdIn0Res.merkleRoot,
    publicValueField: wdPublicValueField,
    relayerFeeField: '2000',
    relayerField: fieldDecimal(computeRelayerField(wdAction)),
    actionField: wdActionField,
    actionBinding: wdActionBinding,
    nullifier: [wdIn0Res.nullifier, '0'],
    outputCommitment: [wdOut0Res.noteCommitment, '0'],

    ask: '11111',
    nk: '22222',
    inputEnabled: ['1', '0'],
    inputOwnerCommitment: [wdIn0Res.ownerCommitment, '0'],
    inputDiversifier: ['11', '0'],
    inputValue: ['10000000', '0'],
    inputRho: ['33333', '0'],
    inputLeafIndex: ['0', '0'],
    inputSiblings: [new Array(32).fill('0'), new Array(32).fill('0')],
    inputDirectionBits: [directionBitsFor(0), directionBitsFor(0)],

    outputEnabled: ['1', '0'],
    outputOwnerCommitment: [wdOut0Res.ownerCommitment, '0'],
    outputValue: ['2998000', '0'],
    outputRho: ['66666', '0'],
  };

  const withdrawRes = await snarkjs.groth16.fullProve(wdInputs, wasmPath, zkeyPath);

  const vectors = {
    schemaVersion: 1,
    protocolVersion: 1,
    proofs: [
      {
        name: 'deposit_5000000',
        actionKind: 'Deposit',
        publicSignals: depositRes.publicSignals,
        proof: depositRes.proof,
      },
      {
        name: 'transfer_10m_to_6m_plus_3999000_change_and_1000_fee',
        actionKind: 'PrivateTransfer',
        publicSignals: transferRes.publicSignals,
        proof: transferRes.proof,
      },
      {
        name: 'withdraw_7000000_plus_2000_fee_from_10m_note',
        actionKind: 'Withdraw',
        publicSignals: withdrawRes.publicSignals,
        proof: withdrawRes.proof,
      },
    ],
  };

  const vectorsDir = join(protocolDir, 'vectors');
  mkdirSync(vectorsDir, { recursive: true });
  writeFileSync(join(vectorsDir, 'proofs-v1.json'), JSON.stringify(vectors, null, 2));
  console.log('✓ proofs-v1.json with deposit, transfer, and withdraw generated successfully.');
}

generateVectors().then(
  () => process.exit(0),
  (error) => {
    console.error('Vector generation failed:', error);
    process.exit(1);
  },
);
