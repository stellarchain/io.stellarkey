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
  computeActionField,
  computeAssetField,
  computeContextField,
  computeContextHash,
  computeDummyNullifier,
  computeCommitment,
} = await import(browserPackagePath);
const fromHex = (value) => Uint8Array.from(value.match(/../g), (byte) => Number.parseInt(byte, 16));
const fieldDecimal = (value) => BigInt(`0x${Buffer.from(value).toString('hex')}`).toString();
const fieldBytes = (value) => fromHex(BigInt(value).toString(16).padStart(64, '0'));
const positionsFor = (leafIndex) => {
  let value = BigInt(leafIndex);
  return Array.from({ length: 64 }, () => {
    const position = value % 3n;
    value /= 3n;
    return position.toString();
  });
};
const emptySiblings = () => Array.from({ length: 64 }, () => ['0', '0']);

const helperWasm = readFileSync(helperWasmPath);
const wcModule = await import(join(circuitsDir, 'node_modules/circom_runtime/js/witness_calculator.js'));
const helper = await wcModule.default(helperWasm);

async function evalGadgets({ contextField, assetField, ask = '0', nk = '0', diversifier = '0', rho = '0', value = '0', leafIndex = '0', siblings = emptySiblings() }) {
  const wtns = await helper.calculateWitness({
    contextField: contextField.toString(),
    assetField: assetField.toString(),
    ask: ask.toString(),
    nk: nk.toString(),
    diversifier: diversifier.toString(),
    rho: rho.toString(),
    value: value.toString(),
    leafIndex: leafIndex.toString(),
    siblings: siblings.map(level => level.map(String)),
    positions: positionsFor(leafIndex),
  });
  return {
    ownerCommitment: wtns[1].toString(),
    noteCommitment: wtns[2].toString(),
    nullifier: wtns[3].toString(),
    merkleRoot: wtns[4].toString(),
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
  const outputPackage = (cm, recipientFill, outgoingFill) => ({
    cm: fieldBytes(cm),
    recipientEnvelope: new Uint8Array(181).fill(recipientFill),
    outgoingEnvelope: new Uint8Array(157).fill(outgoingFill),
  });
  const actionFieldDecimal = (action) => fieldDecimal(
    computeActionField(action, networkId, realmId, poolId),
  );

  // 1. Deposit Vector
  const contextField = fieldDecimal(
    computeContextField(
      computeContextHash(
        2,
        networkId,
        realmId,
        poolId,
      ),
    ),
  );
  const dummyNullifier = secret => fieldDecimal(computeDummyNullifier(
    fieldBytes(contextField),
    fieldBytes(secret),
  ));
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
  const depDummyOutput = await evalGadgets({
    contextField,
    assetField,
    ask: '333',
    nk: '444',
    rho: '88888',
    value: '0',
  });
  const depSecondDummyOutput = await evalGadgets({
    contextField,
    assetField,
    ask: '335',
    nk: '446',
    rho: '88889',
    value: '0',
  });
  const depDummyNullifiers = [dummyNullifier('901'), dummyNullifier('902')];
  const depAction = {
    protocolVersion: 2,
    kind: ActionKind.Deposit,
    assetIndex: 0,
    asset,
    actionNonce: new Uint8Array(32).fill(0x11),
    anchorRoot: zero32,
    nullifiers: depDummyNullifiers.map(fieldBytes),
    outputs: [
      outputPackage(depGadgets.noteCommitment, 0xaa, 0xab),
      outputPackage(depDummyOutput.noteCommitment, 0xac, 0xad),
      outputPackage(depSecondDummyOutput.noteCommitment, 0xae, 0xaf),
    ],
    publicValue: 5_000_000n,
    depositSource: { kind: 0, payload: new Uint8Array(32).fill(4) },
  };
  const depActionField = actionFieldDecimal(depAction);

  const depInputs = {
    contextField,
    assetField,
    actionAssetField: assetField,
    actionKindField: depActionKindField,
    anchorRoot: depAnchorRoot,
    publicValueField: depPublicValueField,
    actionField: depActionField,
    nullifier: depDummyNullifiers,
    outputCommitment: [
      depGadgets.noteCommitment,
      depDummyOutput.noteCommitment,
      depSecondDummyOutput.noteCommitment,
    ],

    ask: '0',
    nk: '0',
    inputReal: ['0', '0'],
    inputDummySecret: ['901', '902'],
    inputOwnerCommitment: ['0', '0'],
    inputDiversifier: ['0', '0'],
    inputValue: ['0', '0'],
    inputRho: ['0', '0'],
    inputLeafIndex: ['0', '0'],
    inputSiblings: [emptySiblings(), emptySiblings()],
    inputPositions: [positionsFor(0), positionsFor(0)],

    outputOwnerCommitment: [
      depGadgets.ownerCommitment,
      depDummyOutput.ownerCommitment,
      depSecondDummyOutput.ownerCommitment,
    ],
    outputValue: ['5000000', '0', '0'],
    outputRho: ['77777', '88888', '88889'],
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
    siblings: emptySiblings(),
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
  const trFeeOutput = await evalGadgets({
    contextField,
    assetField,
    ask: '12121',
    nk: '23232',
    rho: '56565',
    value: '1000',
  });
  const trDummyNullifier = dummyNullifier('903');
  const trAction = {
    protocolVersion: 2,
    kind: ActionKind.PrivateTransfer,
    actionNonce: new Uint8Array(32).fill(0x22),
    anchorRoot: fromHex(BigInt(in0Res.merkleRoot).toString(16).padStart(64, '0')),
    nullifiers: [
      fieldBytes(in0Res.nullifier),
      fieldBytes(trDummyNullifier),
    ],
    outputs: [
      outputPackage(out0Res.noteCommitment, 0xbb, 0xbc),
      outputPackage(out1Res.noteCommitment, 0xcc, 0xcd),
      outputPackage(trFeeOutput.noteCommitment, 0xce, 0xcf),
    ],
    publicValue: 0n,
  };
  const trActionField = actionFieldDecimal(trAction);

  const trInputs = {
    contextField,
    assetField: '0',
    actionAssetField: assetField,
    actionKindField: trActionKindField,
    anchorRoot: in0Res.merkleRoot,
    publicValueField: trPublicValueField,
    actionField: trActionField,
    nullifier: [in0Res.nullifier, trDummyNullifier],
    outputCommitment: [out0Res.noteCommitment, out1Res.noteCommitment, trFeeOutput.noteCommitment],

    ask: '11111',
    nk: '22222',
    inputReal: ['1', '0'],
    inputDummySecret: ['0', '903'],
    inputOwnerCommitment: [in0Res.ownerCommitment, '0'],
    inputDiversifier: ['7', '0'],
    inputValue: ['10000000', '0'],
    inputRho: ['33333', '0'],
    inputLeafIndex: ['0', '0'],
    inputSiblings: [emptySiblings(), emptySiblings()],
    inputPositions: [positionsFor(0), positionsFor(0)],

    outputOwnerCommitment: [out0Res.ownerCommitment, out1Res.ownerCommitment, trFeeOutput.ownerCommitment],
    outputValue: ['6000000', '3999000', '1000'],
    outputRho: ['44444', '55555', '56565'],
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
    siblings: emptySiblings(),
  });

  const wdOut0Res = await evalGadgets({
    contextField,
    assetField,
    ask: '11111',
    nk: '22222',
    rho: '66666',
    value: '2998000',
  });
  const wdDummyOutput = await evalGadgets({
    contextField,
    assetField,
    ask: '777',
    nk: '888',
    rho: '99999',
    value: '0',
  });
  const wdFeeOutput = await evalGadgets({
    contextField,
    assetField,
    ask: '889',
    nk: '990',
    rho: '99998',
    value: '2000',
  });
  const wdDummyNullifier = dummyNullifier('904');
  const wdAction = {
    protocolVersion: 2,
    kind: ActionKind.Withdraw,
    assetIndex: 0,
    asset,
    actionNonce: new Uint8Array(32).fill(0x33),
    anchorRoot: fromHex(BigInt(wdIn0Res.merkleRoot).toString(16).padStart(64, '0')),
    nullifiers: [
      fieldBytes(wdIn0Res.nullifier),
      fieldBytes(wdDummyNullifier),
    ],
    outputs: [
      outputPackage(wdOut0Res.noteCommitment, 0xdd, 0xde),
      outputPackage(wdDummyOutput.noteCommitment, 0xdf, 0xe0),
      outputPackage(wdFeeOutput.noteCommitment, 0xe1, 0xe2),
    ],
    publicValue: 7_000_000n,
    publicRecipient: { kind: 0, payload: new Uint8Array(32).fill(5) },
  };
  const wdActionField = actionFieldDecimal(wdAction);

  const wdInputs = {
    contextField,
    assetField,
    actionAssetField: assetField,
    actionKindField: wdActionKindField,
    anchorRoot: wdIn0Res.merkleRoot,
    publicValueField: wdPublicValueField,
    actionField: wdActionField,
    nullifier: [wdIn0Res.nullifier, wdDummyNullifier],
    outputCommitment: [wdOut0Res.noteCommitment, wdDummyOutput.noteCommitment, wdFeeOutput.noteCommitment],

    ask: '11111',
    nk: '22222',
    inputReal: ['1', '0'],
    inputDummySecret: ['0', '904'],
    inputOwnerCommitment: [wdIn0Res.ownerCommitment, '0'],
    inputDiversifier: ['11', '0'],
    inputValue: ['10000000', '0'],
    inputRho: ['33333', '0'],
    inputLeafIndex: ['0', '0'],
    inputSiblings: [emptySiblings(), emptySiblings()],
    inputPositions: [positionsFor(0), positionsFor(0)],

    outputOwnerCommitment: [wdOut0Res.ownerCommitment, wdDummyOutput.ownerCommitment, wdFeeOutput.ownerCommitment],
    outputValue: ['2998000', '0', '2000'],
    outputRho: ['66666', '99999', '99998'],
  };

  const withdrawRes = await snarkjs.groth16.fullProve(wdInputs, wasmPath, zkeyPath);

  // Same selected note/nullifier as the normal withdrawal: modes must share
  // replay protection. All exit outputs are provably zero-valued dummies.
  const exitCommitments = wdInputs.outputOwnerCommitment.map((owner, index) =>
    computeCommitment(fieldBytes(contextField), fieldBytes(assetField), fieldBytes(owner), 0n, fieldBytes(wdInputs.outputRho[index])));
  const exitAction = {
    ...wdAction,
    kind: ActionKind.FullInputExit,
    actionNonce: new Uint8Array(32).fill(0x44),
    publicValue: 10_000_000n,
    outputs: wdAction.outputs.map((output, index) => ({ ...output, cm: exitCommitments[index] })),
  };
  const exitInputs = {
    ...wdInputs,
    actionKindField: '4',
    publicValueField: '10000000',
    actionField: actionFieldDecimal(exitAction),
    outputValue: ['0', '0', '0'],
    outputCommitment: exitCommitments.map(fieldDecimal),
  };
  const exitRes = await snarkjs.groth16.fullProve(exitInputs, wasmPath, zkeyPath);

  const vectors = {
    schemaVersion: 1,
    protocolVersion: 2,
    proofs: [
      // Synthetic public test vectors; no wallet session is involved.
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
      {
        name: 'full_input_exit_10m_without_append',
        actionKind: 'FullInputExit',
        publicSignals: exitRes.publicSignals,
        proof: exitRes.proof,
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
