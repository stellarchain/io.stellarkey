import test from 'node:test';
import assert from 'node:assert/strict';
import * as snarkjs from 'snarkjs';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { computeNullifier } from '@stellarkey/private-balance';

const buildDir = join(import.meta.dirname, '../build');
const wasmPath = process.env.PRIVATE_BALANCE_ACTION_WASM_PATH
  ?? join(buildDir, 'action_js/action.wasm');
const zkeyPath = join(buildDir, 'action_dev.zkey');
const vkPath = join(buildDir, 'verification_key.json');
const helperWasmPath = join(buildDir, 'gadgets_helper_js/gadgets_helper.wasm');

let wcHelper;
let actionCalculator;
const directionBitsFor = (leafIndex) => {
  const value = BigInt(leafIndex);
  return Array.from({ length: 32 }, (_, index) => ((value >> BigInt(index)) & 1n).toString());
};
const fieldBytes = value => Uint8Array.from(
  Buffer.from(BigInt(value).toString(16).padStart(64, '0'), 'hex'),
);
const fieldDecimal = value => BigInt(`0x${Buffer.from(value).toString('hex')}`).toString();

async function getHelper() {
  if (!wcHelper) {
    const wasm = readFileSync(helperWasmPath);
    const wcModule = await import('../node_modules/circom_runtime/js/witness_calculator.js');
    wcHelper = await wcModule.default(wasm);
  }
  return wcHelper;
}

async function getActionCalculator() {
  if (!actionCalculator) {
    const wasm = readFileSync(wasmPath);
    const wcModule = await import('../node_modules/circom_runtime/js/witness_calculator.js');
    actionCalculator = await wcModule.default(wasm);
  }
  return actionCalculator;
}

async function evalGadgets({ contextField, assetField = '84', ask = '0', nk = '0', diversifier = '0', rho = '0', value = '0', leafIndex = '0', siblings = new Array(32).fill('0'), actionField = '0' }) {
  const helper = await getHelper();
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

test('action circuit: deposit proof generation and verification', async () => {
  assert.ok(existsSync(wasmPath), 'WASM exists');
  assert.ok(existsSync(zkeyPath), 'ZKEY exists');
  const vk = JSON.parse(readFileSync(vkPath, 'utf8'));

  const contextField = '42';
  const actionKindField = '1'; // Deposit
  const anchorRoot = '0';
  const publicValueField = '5000000';
  const actionField = '123456';

  const helperRes = await evalGadgets({
    contextField,
    actionField,
    ask: '111',
    nk: '222',
    rho: '77777',
    value: '5000000',
  });

  const actionBinding = helperRes.actionBinding;
  const outOwner0 = helperRes.ownerCommitment;
  const outVal0 = '5000000';
  const outRho0 = '77777';
  const outCm0 = helperRes.noteCommitment;

  const circuitInputs = {
    contextField,
    assetField: '84',
    actionKindField,
    anchorRoot,
    publicValueField,
    relayerFeeField: '0',
    relayerField: '0',
    actionField,
    actionBinding,
    nullifier: ['0', '0'],
    outputCommitment: [outCm0, '0'],

    ask: '0',
    nk: '0',
    inputEnabled: ['0', '0'],
    inputOwnerCommitment: ['0', '0'],
    inputDiversifier: ['0', '0'],
    inputValue: ['0', '0'],
    inputRho: ['0', '0'],
    inputLeafIndex: ['0', '0'],
    inputSiblings: [
      new Array(32).fill('0'),
      new Array(32).fill('0'),
    ],
    inputDirectionBits: [directionBitsFor(0), directionBitsFor(0)],

    outputEnabled: ['1', '0'],
    outputOwnerCommitment: [outOwner0, '0'],
    outputValue: [outVal0, '0'],
    outputRho: [outRho0, '0'],
  };

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(circuitInputs, wasmPath, zkeyPath);
  assert.equal(publicSignals.length, 13);
  assert.equal(publicSignals[0], contextField);
  assert.equal(publicSignals[1], '84');
  assert.equal(publicSignals[2], actionKindField);

  const verified = await snarkjs.groth16.verify(vk, publicSignals, proof);
  assert.ok(verified, 'Deposit proof verified successfully');

  // Negative test: mutated public signal fails verification
  const badSignals = [...publicSignals];
  badSignals[3] = '5000001';
  const badVerified = await snarkjs.groth16.verify(vk, badSignals, proof);
  assert.ok(!badVerified, 'Mutated proof must fail verification');
});

test('action circuit: private transfer proof generation and verification', async () => {
  const vk = JSON.parse(readFileSync(vkPath, 'utf8'));

  const contextField = '42';
  const actionKindField = '2'; // PrivateTransfer
  const publicValueField = '0';
  const actionField = '654321';

  // Input 0: real note
  const inAsk0 = '11111';
  const inNk0 = '22222';
  const inVal0 = '10000000';
  const inRho0 = '33333';
  const inLeafIndex0 = '0';
  const inDiversifier0 = '7';
  const siblings0 = new Array(32).fill('0');

  const in0Res = await evalGadgets({
    contextField,
    ask: inAsk0,
    nk: inNk0,
    diversifier: inDiversifier0,
    rho: inRho0,
    value: inVal0,
    leafIndex: inLeafIndex0,
    siblings: siblings0,
    actionField,
  });

  const anchorRoot = in0Res.merkleRoot;
  const actionBinding = in0Res.actionBinding;
  const inOwner0 = in0Res.ownerCommitment;
  const inNf0 = in0Res.nullifier;

  // Output 0 (recipient): 6,000,000
  const out0Res = await evalGadgets({
    contextField,
    ask: '88888',
    nk: '99999',
    rho: '44444',
    value: '6000000',
  });
  const outOwner0 = out0Res.ownerCommitment;
  const outVal0 = '6000000';
  const outRho0 = '44444';
  const outCm0 = out0Res.noteCommitment;

  // Output 1 (change): 3,999,000 after a 1,000 relayer fee.
  const out1Res = await evalGadgets({
    contextField,
    ask: inAsk0,
    nk: inNk0,
    rho: '55555',
    value: '3999000',
  });
  const outOwner1 = out1Res.ownerCommitment;
  const outVal1 = '3999000';
  const outRho1 = '55555';
  const outCm1 = out1Res.noteCommitment;

  const circuitInputs = {
    contextField,
    assetField: '84',
    actionKindField,
    anchorRoot,
    publicValueField,
    relayerFeeField: '1000',
    relayerField: '9',
    actionField,
    actionBinding,
    nullifier: [inNf0, '0'],
    outputCommitment: [outCm0, outCm1],

    ask: inAsk0,
    nk: inNk0,
    inputEnabled: ['1', '0'],
    inputOwnerCommitment: [inOwner0, '0'],
    inputDiversifier: [inDiversifier0, '0'],
    inputValue: [inVal0, '0'],
    inputRho: [inRho0, '0'],
    inputLeafIndex: [inLeafIndex0, '0'],
    inputSiblings: [
      siblings0,
      new Array(32).fill('0'),
    ],
    inputDirectionBits: [directionBitsFor(inLeafIndex0), directionBitsFor(0)],

    outputEnabled: ['1', '1'],
    outputOwnerCommitment: [outOwner0, outOwner1],
    outputValue: [outVal0, outVal1],
    outputRho: [outRho0, outRho1],
  };

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(circuitInputs, wasmPath, zkeyPath);
  const verified = await snarkjs.groth16.verify(vk, publicSignals, proof);
  assert.ok(verified, 'Transfer proof verified successfully');
});

test('action circuit: withdrawal proof generation and verification', async () => {
  const vk = JSON.parse(readFileSync(vkPath, 'utf8'));

  const contextField = '42';
  const actionKindField = '3'; // Withdraw
  const publicValueField = '7000000';
  const actionField = '987654';

  // Input 0: real note of 10,000,000
  const inAsk0 = '11111';
  const inNk0 = '22222';
  const inVal0 = '10000000';
  const inRho0 = '33333';
  const inLeafIndex0 = '0';
  const inDiversifier0 = '11';
  const siblings0 = new Array(32).fill('0');

  const in0Res = await evalGadgets({
    contextField,
    ask: inAsk0,
    nk: inNk0,
    diversifier: inDiversifier0,
    rho: inRho0,
    value: inVal0,
    leafIndex: inLeafIndex0,
    siblings: siblings0,
    actionField,
  });

  const anchorRoot = in0Res.merkleRoot;
  const actionBinding = in0Res.actionBinding;
  const inOwner0 = in0Res.ownerCommitment;
  const inNf0 = in0Res.nullifier;

  // Change output note: 2,998,000 after public withdrawal and a 2,000 relayer fee.
  const out0Res = await evalGadgets({
    contextField,
    ask: inAsk0,
    nk: inNk0,
    rho: '66666',
    value: '2998000',
  });
  const outOwner0 = out0Res.ownerCommitment;
  const outVal0 = '2998000';
  const outRho0 = '66666';
  const outCm0 = out0Res.noteCommitment;

  const circuitInputs = {
    contextField,
    assetField: '84',
    actionKindField,
    anchorRoot,
    publicValueField,
    relayerFeeField: '2000',
    relayerField: '9',
    actionField,
    actionBinding,
    nullifier: [inNf0, '0'],
    outputCommitment: [outCm0, '0'],

    ask: inAsk0,
    nk: inNk0,
    inputEnabled: ['1', '0'],
    inputOwnerCommitment: [inOwner0, '0'],
    inputDiversifier: [inDiversifier0, '0'],
    inputValue: [inVal0, '0'],
    inputRho: [inRho0, '0'],
    inputLeafIndex: [inLeafIndex0, '0'],
    inputSiblings: [
      siblings0,
      new Array(32).fill('0'),
    ],
    inputDirectionBits: [directionBitsFor(inLeafIndex0), directionBitsFor(0)],

    outputEnabled: ['1', '0'],
    outputOwnerCommitment: [outOwner0, '0'],
    outputValue: [outVal0, '0'],
    outputRho: [outRho0, '0'],
  };

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(circuitInputs, wasmPath, zkeyPath);
  const verified = await snarkjs.groth16.verify(vk, publicSignals, proof);
  assert.ok(verified, 'Withdrawal proof verified successfully');
});

test('action circuit rejects a deposit bound to a nonzero anchor root', async () => {
  const contextField = '42';
  const actionField = '123456';
  const output = await evalGadgets({
    contextField,
    actionField,
    ask: '111',
    nk: '222',
    rho: '77777',
    value: '5000000',
  });
  const calculator = await getActionCalculator();

  await assert.rejects(
    calculator.calculateWitness({
      contextField,
      assetField: '84',
      actionKindField: '1',
      anchorRoot: '1',
      publicValueField: '5000000',
      relayerFeeField: '0',
      relayerField: '0',
      actionField,
      actionBinding: output.actionBinding,
      nullifier: ['0', '0'],
      outputCommitment: [output.noteCommitment, '0'],
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
      outputOwnerCommitment: [output.ownerCommitment, '0'],
      outputValue: ['5000000', '0'],
      outputRho: ['77777', '0'],
    }),
    /Assert Failed|Error/,
  );
});

test('action circuit rejects inputs controlled by different spending keys', async () => {
  const contextField = '42';
  const actionField = '654321';
  const first = await evalGadgets({
    contextField,
    actionField,
    ask: '11111',
    nk: '22222',
    rho: '33333',
    value: '4000000',
  });
  const second = await evalGadgets({
    contextField,
    actionField,
    ask: '77777',
    nk: '88888',
    rho: '44444',
    value: '6000000',
    leafIndex: '1',
  });
  const firstWithPath = await evalGadgets({
    contextField,
    actionField,
    ask: '11111',
    nk: '22222',
    rho: '33333',
    value: '4000000',
    siblings: [second.noteCommitment, ...new Array(31).fill('0')],
  });
  const secondWithPath = await evalGadgets({
    contextField,
    actionField,
    ask: '77777',
    nk: '88888',
    rho: '44444',
    value: '6000000',
    leafIndex: '1',
    siblings: [first.noteCommitment, ...new Array(31).fill('0')],
  });
  const secondNullifierUnderSharedNk = fieldDecimal(computeNullifier(
    fieldBytes(contextField),
    fieldBytes('22222'),
    fieldBytes('44444'),
    1n,
    fieldBytes(second.noteCommitment),
  ));
  assert.equal(firstWithPath.merkleRoot, secondWithPath.merkleRoot);
  const output = await evalGadgets({
    contextField,
    ask: '99999',
    nk: '10101',
    rho: '55555',
    value: '10000000',
  });
  const calculator = await getActionCalculator();

  await assert.rejects(
    calculator.calculateWitness({
      contextField,
      assetField: '84',
      actionKindField: '2',
      anchorRoot: firstWithPath.merkleRoot,
      publicValueField: '0',
      relayerFeeField: '0',
      relayerField: '9',
      actionField,
      actionBinding: first.actionBinding,
      nullifier: [firstWithPath.nullifier, secondNullifierUnderSharedNk],
      outputCommitment: [output.noteCommitment, '0'],
      ask: '11111',
      nk: '22222',
      inputEnabled: ['1', '1'],
      inputOwnerCommitment: [first.ownerCommitment, second.ownerCommitment],
    inputDiversifier: ['0', '0'],
      inputValue: ['4000000', '6000000'],
      inputRho: ['33333', '44444'],
      inputLeafIndex: ['0', '1'],
      inputSiblings: [
        [second.noteCommitment, ...new Array(31).fill('0')],
        [first.noteCommitment, ...new Array(31).fill('0')],
      ],
      inputDirectionBits: [directionBitsFor(0), directionBitsFor(1)],
      outputEnabled: ['1', '0'],
      outputOwnerCommitment: [output.ownerCommitment, '0'],
      outputValue: ['10000000', '0'],
      outputRho: ['55555', '0'],
    }),
    /Assert Failed|Error/,
  );
});

test('action circuit rejects duplicate real output commitments', async () => {
  const contextField = '42';
  const actionField = '654321';
  const input = await evalGadgets({
    contextField,
    actionField,
    ask: '11111',
    nk: '22222',
    rho: '33333',
    value: '10000000',
  });
  const output = await evalGadgets({
    contextField,
    ask: '88888',
    nk: '99999',
    rho: '44444',
    value: '5000000',
  });
  const calculator = await getActionCalculator();

  await assert.rejects(
    calculator.calculateWitness({
      contextField,
      assetField: '84',
      actionKindField: '2',
      anchorRoot: input.merkleRoot,
      publicValueField: '0',
      relayerFeeField: '0',
      relayerField: '9',
      actionField,
      actionBinding: input.actionBinding,
      nullifier: [input.nullifier, '0'],
      outputCommitment: [output.noteCommitment, output.noteCommitment],
      ask: '11111',
      nk: '22222',
      inputEnabled: ['1', '0'],
      inputOwnerCommitment: [input.ownerCommitment, '0'],
    inputDiversifier: ['0', '0'],
      inputValue: ['10000000', '0'],
      inputRho: ['33333', '0'],
      inputLeafIndex: ['0', '0'],
      inputSiblings: [new Array(32).fill('0'), new Array(32).fill('0')],
      inputDirectionBits: [directionBitsFor(0), directionBitsFor(0)],
      outputEnabled: ['1', '1'],
      outputOwnerCommitment: [output.ownerCommitment, output.ownerCommitment],
      outputValue: ['5000000', '5000000'],
      outputRho: ['44444', '44444'],
    }),
    /Assert Failed|Error/,
  );
});
