import test from 'node:test';
import assert from 'node:assert/strict';
import * as snarkjs from 'snarkjs';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { computeDummyNullifier, computeNullifier } from '@stellarkey/private-balance/note';

const buildDir = join(import.meta.dirname, '../build');
const wasmPath = process.env.PRIVATE_BALANCE_ACTION_WASM_PATH
  ?? join(buildDir, 'action_js/action.wasm');
const zkeyPath = join(buildDir, 'action_dev.zkey');
const vkPath = join(buildDir, 'verification_key.json');
const helperWasmPath = join(buildDir, 'gadgets_helper_js/gadgets_helper.wasm');

let wcHelper;
let actionCalculator;
const positionsFor = (leafIndex) => {
  let value = BigInt(leafIndex);
  return Array.from({ length: 64 }, () => {
    const position = value % 3n;
    value /= 3n;
    return position.toString();
  });
};
const emptySiblings = () => Array.from({ length: 64 }, () => ['0', '0']);
const fieldBytes = value => Uint8Array.from(
  Buffer.from(BigInt(value).toString(16).padStart(64, '0'), 'hex'),
);
const fieldDecimal = value => BigInt(`0x${Buffer.from(value).toString('hex')}`).toString();
const dummyNullifier = (contextField, secret) => fieldDecimal(computeDummyNullifier(
  fieldBytes(contextField),
  fieldBytes(secret),
));

async function getHelper() {
  if (!wcHelper) {
    const wasm = readFileSync(helperWasmPath);
    const wcModule = await import('../node_modules/circom_runtime/js/witness_calculator.js');
    wcHelper = await wcModule.default(wasm);
  }
  return wcHelper;
}

async function normalizeActionInputs(input) {
  const normalized = {
    ...input,
    outputCommitment: [...input.outputCommitment],
    outputOwnerCommitment: [...input.outputOwnerCommitment],
    outputValue: [...input.outputValue],
    outputRho: [...input.outputRho],
    actionAssetField: input.actionAssetField ?? input.assetField,
    assetField: String(input.actionKindField) === '2' && !input.preservePublicAsset
      ? '0'
      : input.assetField,
  };
  delete normalized.preservePublicAsset;
  const privateFee = normalized.relayerFeeField ?? '0';
  delete normalized.relayerFeeField;
  if (normalized.outputCommitment.length === 2) {
    const feeOutput = await evalGadgets({
      contextField: normalized.contextField,
      assetField: normalized.actionAssetField,
      ask: '919191',
      nk: '929292',
      rho: '939393',
      value: privateFee,
    });
    normalized.outputCommitment.push(feeOutput.noteCommitment);
    normalized.outputOwnerCommitment.push(feeOutput.ownerCommitment);
    normalized.outputValue.push(String(privateFee));
    normalized.outputRho.push('939393');
  }
  return normalized;
}

async function getActionCalculator() {
  if (!actionCalculator) {
    const wasm = readFileSync(wasmPath);
    const wcModule = await import('../node_modules/circom_runtime/js/witness_calculator.js');
    const rawCalculator = await wcModule.default(wasm);
    actionCalculator = {
      async calculateWitness(input) {
        return rawCalculator.calculateWitness(await normalizeActionInputs(input));
      },
    };
  }
  return actionCalculator;
}

async function evalGadgets({ contextField, assetField = '84', ask = '0', nk = '0', diversifier = '0', rho = '0', value = '0', leafIndex = '0', siblings = emptySiblings() }) {
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

test('action circuit: every deposit exposes two nonzero nullifiers and commitments', async () => {
  const contextField = '42';
  const actionField = '123456';
  const realOutput = await evalGadgets({
    contextField,
    ask: '111',
    nk: '222',
    rho: '77777',
    value: '5000000',
    actionField,
  });
  const dummyOutput = await evalGadgets({
    contextField,
    ask: '333',
    nk: '444',
    rho: '88888',
    value: '0',
    actionField,
  });
  const calculator = await getActionCalculator();
  const nullifiers = [
    dummyNullifier(contextField, '901'),
    dummyNullifier(contextField, '902'),
  ];
  const commitments = [realOutput.noteCommitment, dummyOutput.noteCommitment];
  assert.ok(nullifiers.every(value => value !== '0'));
  assert.ok(commitments.every(value => value !== '0'));

  await calculator.calculateWitness({
    contextField,
    assetField: '84',
    actionKindField: '1',
    anchorRoot: '0',
    publicValueField: '5000000',
    relayerFeeField: '0',
    actionField,
    nullifier: nullifiers,
    outputCommitment: commitments,
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
    outputOwnerCommitment: [realOutput.ownerCommitment, dummyOutput.ownerCommitment],
    outputValue: ['5000000', '0'],
    outputRho: ['77777', '88888'],
  });
});

async function buildOneInputTransfer(inputLane = 0, outputLane = 0, actionAssetField = '84') {
  const contextField = '42';
  const actionField = '7654321';
  const ask = '11111';
  const nk = '22222';
  const input = await evalGadgets({
    contextField,
    assetField: actionAssetField,
    actionField,
    ask,
    nk,
    diversifier: '7',
    rho: '33333',
    value: '10000000',
  });
  const realOutput = await evalGadgets({
    contextField,
    assetField: actionAssetField,
    actionField,
    ask: '88888',
    nk: '99999',
    rho: '44444',
    value: '10000000',
  });
  const dummyOutput = await evalGadgets({
    contextField,
    assetField: actionAssetField,
    actionField,
    ask: '55555',
    nk: '66666',
    rho: '77777',
    value: '0',
  });
  const dummyInputLane = 1 - inputLane;
  const dummySecret = '908';
  const atLane = (real, dummy, realLane) => realLane === 0 ? [real, dummy] : [dummy, real];

  return {
    contextField,
    assetField: actionAssetField,
    actionKindField: '2',
    anchorRoot: input.merkleRoot,
    publicValueField: '0',
    relayerFeeField: '0',
    actionField,
    nullifier: atLane(
      input.nullifier,
      dummyNullifier(contextField, dummySecret),
      inputLane,
    ),
    outputCommitment: atLane(
      realOutput.noteCommitment,
      dummyOutput.noteCommitment,
      outputLane,
    ),
    ask,
    nk,
    inputReal: atLane('1', '0', inputLane),
    inputDummySecret: atLane('0', dummySecret, inputLane),
    inputOwnerCommitment: atLane(input.ownerCommitment, '0', inputLane),
    inputDiversifier: atLane('7', '0', inputLane),
    inputValue: atLane('10000000', '0', inputLane),
    inputRho: atLane('33333', '0', inputLane),
    inputLeafIndex: ['0', '0'],
    inputSiblings: [emptySiblings(), emptySiblings()],
    inputPositions: [positionsFor(0), positionsFor(0)],
    outputOwnerCommitment: atLane(
      realOutput.ownerCommitment,
      dummyOutput.ownerCommitment,
      outputLane,
    ),
    outputValue: atLane('10000000', '0', outputLane),
    outputRho: atLane('44444', '77777', outputLane),
  };
}

test('action circuit hides a transfer asset while binding three private-asset outputs', async () => {
  const witness = await buildOneInputTransfer(0, 0);
  const third = await evalGadgets({
    contextField: witness.contextField,
    assetField: '84',
    ask: '31337',
    nk: '31338',
    rho: '31339',
    value: '0',
  });
  witness.actionAssetField = '84';
  witness.assetField = '0';
  delete witness.relayerFeeField;
  witness.outputCommitment.push(third.noteCommitment);
  witness.outputOwnerCommitment.push(third.ownerCommitment);
  witness.outputValue.push('0');
  witness.outputRho.push('31339');

  await (await getActionCalculator()).calculateWitness(witness);
});

test('action circuit rejects a public transfer asset and an invalid private asset', async () => {
  const calculator = await getActionCalculator();
  const canonical = await normalizeActionInputs(await buildOneInputTransfer(0, 0));
  await assert.rejects(
    calculator.calculateWitness({ ...canonical, assetField: '84', preservePublicAsset: true }),
    /Assert Failed|Error/,
  );
  await assert.rejects(
    calculator.calculateWitness(await normalizeActionInputs(
      await buildOneInputTransfer(0, 0, '0'),
    )),
    /Assert Failed|Error/,
  );
  await assert.rejects(
    calculator.calculateWitness({ ...canonical, actionAssetField: '85' }),
    /Assert Failed|Error/,
  );
});

test('action circuit: real input and output roles can occupy either lane', async () => {
  const calculator = await getActionCalculator();
  for (const inputLane of [0, 1]) {
    for (const outputLane of [0, 1]) {
      const witness = await buildOneInputTransfer(inputLane, outputLane);
      assert.ok(witness.nullifier.every(value => value !== '0'));
      assert.ok(witness.outputCommitment.every(value => value !== '0'));
      await calculator.calculateWitness(witness);
    }
  }
});

test('action circuit: two-input consolidation accepts both input permutations', async () => {
  const contextField = '42';
  const actionField = '8765432';
  const ask = '11111';
  const nk = '22222';
  const firstLeaf = await evalGadgets({
    contextField, actionField, ask, nk, diversifier: '7', rho: '30001', value: '4000000',
  });
  const secondLeaf = await evalGadgets({
    contextField, actionField, ask, nk, diversifier: '8', rho: '30002', value: '6000000', leafIndex: '1',
  });
  const first = await evalGadgets({
    contextField,
    actionField,
    ask,
    nk,
    diversifier: '7',
    rho: '30001',
    value: '4000000',
    siblings: [[secondLeaf.noteCommitment, '0'], ...emptySiblings().slice(1)],
  });
  const second = await evalGadgets({
    contextField,
    actionField,
    ask,
    nk,
    diversifier: '8',
    rho: '30002',
    value: '6000000',
    leafIndex: '1',
    siblings: [[firstLeaf.noteCommitment, '0'], ...emptySiblings().slice(1)],
  });
  assert.equal(first.merkleRoot, second.merkleRoot);
  const realOutput = await evalGadgets({
    contextField, actionField, ask, nk, rho: '40001', value: '10000000',
  });
  const dummyOutput = await evalGadgets({
    contextField, actionField, ask: '55555', nk: '66666', rho: '40002', value: '0',
  });
  const calculator = await getActionCalculator();
  const lanes = [
    {
      owner: [first.ownerCommitment, second.ownerCommitment],
      diversifier: ['7', '8'], value: ['4000000', '6000000'], rho: ['30001', '30002'],
      leafIndex: ['0', '1'],
      siblings: [
        [[secondLeaf.noteCommitment, '0'], ...emptySiblings().slice(1)],
        [[firstLeaf.noteCommitment, '0'], ...emptySiblings().slice(1)],
      ],
      positions: [positionsFor(0), positionsFor(1)],
      nullifier: [first.nullifier, second.nullifier],
    },
    {
      owner: [second.ownerCommitment, first.ownerCommitment],
      diversifier: ['8', '7'], value: ['6000000', '4000000'], rho: ['30002', '30001'],
      leafIndex: ['1', '0'],
      siblings: [
        [[firstLeaf.noteCommitment, '0'], ...emptySiblings().slice(1)],
        [[secondLeaf.noteCommitment, '0'], ...emptySiblings().slice(1)],
      ],
      positions: [positionsFor(1), positionsFor(0)],
      nullifier: [second.nullifier, first.nullifier],
    },
  ];
  for (const lane of lanes) {
    await calculator.calculateWitness({
      contextField,
      assetField: '84',
      actionKindField: '2',
      anchorRoot: first.merkleRoot,
      publicValueField: '0',
      relayerFeeField: '0',
      actionField,
      nullifier: lane.nullifier,
      outputCommitment: [realOutput.noteCommitment, dummyOutput.noteCommitment],
      ask,
      nk,
      inputReal: ['1', '1'],
      inputDummySecret: ['0', '0'],
      inputOwnerCommitment: lane.owner,
      inputDiversifier: lane.diversifier,
      inputValue: lane.value,
      inputRho: lane.rho,
      inputLeafIndex: lane.leafIndex,
      inputSiblings: lane.siblings,
      inputPositions: lane.positions,
      outputOwnerCommitment: [realOutput.ownerCommitment, dummyOutput.ownerCommitment],
      outputValue: ['10000000', '0'],
      outputRho: ['40001', '40002'],
    });
  }
});

test('action circuit: full withdrawal still emits two randomized dummy commitments', async () => {
  const witness = await buildOneInputTransfer(1, 0);
  const firstDummy = await evalGadgets({
    contextField: witness.contextField,
    actionField: witness.actionField,
    ask: '70001',
    nk: '70002',
    rho: '70003',
    value: '0',
  });
  const secondDummy = await evalGadgets({
    contextField: witness.contextField,
    actionField: witness.actionField,
    ask: '70004',
    nk: '70005',
    rho: '70006',
    value: '0',
  });
  witness.actionKindField = '3';
  witness.publicValueField = '10000000';
  witness.outputCommitment = [firstDummy.noteCommitment, secondDummy.noteCommitment];
  witness.outputOwnerCommitment = [firstDummy.ownerCommitment, secondDummy.ownerCommitment];
  witness.outputValue = ['0', '0'];
  witness.outputRho = ['70003', '70006'];
  assert.ok(witness.outputCommitment.every(value => value !== '0'));
  await (await getActionCalculator()).calculateWitness(witness);
});

test('action circuit rejects malformed input selectors and lane witnesses', async () => {
  const calculator = await getActionCalculator();
  const canonical = await buildOneInputTransfer(0, 0);
  const cases = [
    { ...canonical, inputReal: ['2', '0'] },
    { ...canonical, inputValue: ['10000000', '1'] },
    { ...canonical, outputValue: ['10000000', '1'] },
    { ...canonical, inputValue: ['0', '0'] },
    { ...canonical, outputValue: ['0', '0'] },
    { ...canonical, nullifier: [canonical.nullifier[0], fieldDecimal(fieldBytes(123))] },
    {
      ...canonical,
      outputCommitment: [
        canonical.outputCommitment[0],
        fieldDecimal(fieldBytes(BigInt(canonical.outputCommitment[1]) + 1n)),
      ],
    },
    { ...canonical, nullifier: [canonical.nullifier[0], canonical.nullifier[0]] },
    { ...canonical, anchorRoot: fieldDecimal(fieldBytes(BigInt(canonical.anchorRoot) + 1n)) },
    { ...canonical, outputValue: ['9999999', '0'] },
  ];
  for (const malformed of cases) {
    await assert.rejects(calculator.calculateWitness(malformed), /Assert Failed|Error/);
  }
});

test('full-input exits reject value in every output lane even with balanced conservation', async () => {
  const calculator = await getActionCalculator();
  const witness = await normalizeActionInputs(await buildOneInputTransfer());
  witness.actionKindField = '4';
  witness.assetField = witness.actionAssetField;
  witness.publicValueField = '10000000';
  for (let lane = 0; lane < 3; lane++) {
    const output = await evalGadgets({ contextField: witness.contextField,
      ask: String(70001 + lane), nk: String(71001 + lane),
      rho: String(72001 + lane), value: '0' });
    witness.outputOwnerCommitment[lane] = output.ownerCommitment;
    witness.outputRho[lane] = String(72001 + lane);
    witness.outputCommitment[lane] = output.noteCommitment;
    witness.outputValue[lane] = '0';
  }
  await calculator.calculateWitness(witness);
  for (let lane = 0; lane < 3; lane++) {
    const malformed = structuredClone(witness);
    const output = await evalGadgets({ contextField: witness.contextField,
      ask: String(70001 + lane), nk: String(71001 + lane),
      rho: String(72001 + lane), value: '1' });
    malformed.publicValueField = '9999999';
    malformed.outputValue[lane] = '1';
    malformed.outputCommitment[lane] = output.noteCommitment;
    await assert.rejects(calculator.calculateWitness(malformed), /Assert Failed|Error/);
    // The same balanced witness is valid for an ordinary change-producing withdrawal.
    malformed.actionKindField = '3';
    await calculator.calculateWitness(malformed);
  }
  await assert.rejects(calculator.calculateWitness({ ...witness, publicValueField: '9999999' }), /Assert Failed|Error/);
  await assert.rejects(calculator.calculateWitness({ ...witness, actionKindField: '5' }), /Assert Failed|Error/);
});

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
  const outOwner0 = helperRes.ownerCommitment;
  const outVal0 = '5000000';
  const outRho0 = '77777';
  const outCm0 = helperRes.noteCommitment;
  const dummyOutput = await evalGadgets({
    contextField,
    actionField,
    ask: '333',
    nk: '444',
    rho: '88888',
    value: '0',
  });

  const circuitInputs = {
    contextField,
    assetField: '84',
    actionKindField,
    anchorRoot,
    publicValueField,
    relayerFeeField: '0',
    actionField,
    nullifier: [
      dummyNullifier(contextField, '901'),
      dummyNullifier(contextField, '902'),
    ],
    outputCommitment: [outCm0, dummyOutput.noteCommitment],

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

    outputOwnerCommitment: [outOwner0, dummyOutput.ownerCommitment],
    outputValue: [outVal0, '0'],
    outputRho: [outRho0, '88888'],
  };

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    await normalizeActionInputs(circuitInputs),
    wasmPath,
    zkeyPath,
  );
  assert.equal(publicSignals.length, 11);
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

  const mutatedActionSignals = [...publicSignals];
  mutatedActionSignals[5] = (BigInt(mutatedActionSignals[5]) + 1n).toString();
  assert.equal(
    await snarkjs.groth16.verify(vk, mutatedActionSignals, proof),
    false,
    'The nonzero actionField constraint must give it a nonzero proof-binding IC coefficient',
  );
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
  const siblings0 = emptySiblings();

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
    actionField,
    nullifier: [inNf0, dummyNullifier(contextField, '903')],
    outputCommitment: [outCm0, outCm1],

    ask: inAsk0,
    nk: inNk0,
    inputReal: ['1', '0'],
    inputDummySecret: ['0', '903'],
    inputOwnerCommitment: [inOwner0, '0'],
    inputDiversifier: [inDiversifier0, '0'],
    inputValue: [inVal0, '0'],
    inputRho: [inRho0, '0'],
    inputLeafIndex: [inLeafIndex0, '0'],
    inputSiblings: [
      siblings0,
      emptySiblings(),
    ],
    inputPositions: [positionsFor(inLeafIndex0), positionsFor(0)],

    outputOwnerCommitment: [outOwner0, outOwner1],
    outputValue: [outVal0, outVal1],
    outputRho: [outRho0, outRho1],
  };

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    await normalizeActionInputs(circuitInputs),
    wasmPath,
    zkeyPath,
  );
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
  const siblings0 = emptySiblings();

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
  const dummyOutput = await evalGadgets({
    contextField,
    actionField,
    ask: '333',
    nk: '444',
    rho: '77777',
    value: '0',
  });

  const circuitInputs = {
    contextField,
    assetField: '84',
    actionKindField,
    anchorRoot,
    publicValueField,
    relayerFeeField: '2000',
    actionField,
    nullifier: [inNf0, dummyNullifier(contextField, '904')],
    outputCommitment: [outCm0, dummyOutput.noteCommitment],

    ask: inAsk0,
    nk: inNk0,
    inputReal: ['1', '0'],
    inputDummySecret: ['0', '904'],
    inputOwnerCommitment: [inOwner0, '0'],
    inputDiversifier: [inDiversifier0, '0'],
    inputValue: [inVal0, '0'],
    inputRho: [inRho0, '0'],
    inputLeafIndex: [inLeafIndex0, '0'],
    inputSiblings: [
      siblings0,
      emptySiblings(),
    ],
    inputPositions: [positionsFor(inLeafIndex0), positionsFor(0)],

    outputOwnerCommitment: [outOwner0, dummyOutput.ownerCommitment],
    outputValue: [outVal0, '0'],
    outputRho: [outRho0, '77777'],
  };

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    await normalizeActionInputs(circuitInputs),
    wasmPath,
    zkeyPath,
  );
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
  const dummyOutput = await evalGadgets({
    contextField,
    actionField,
    ask: '333',
    nk: '444',
    rho: '88888',
    value: '0',
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
      actionField,
      nullifier: [
        dummyNullifier(contextField, '905'),
        dummyNullifier(contextField, '906'),
      ],
      outputCommitment: [output.noteCommitment, dummyOutput.noteCommitment],
      ask: '0',
      nk: '0',
      inputReal: ['0', '0'],
      inputDummySecret: ['905', '906'],
      inputOwnerCommitment: ['0', '0'],
    inputDiversifier: ['0', '0'],
      inputValue: ['0', '0'],
      inputRho: ['0', '0'],
      inputLeafIndex: ['0', '0'],
      inputSiblings: [emptySiblings(), emptySiblings()],
      inputPositions: [positionsFor(0), positionsFor(0)],
      outputOwnerCommitment: [output.ownerCommitment, dummyOutput.ownerCommitment],
      outputValue: ['5000000', '0'],
      outputRho: ['77777', '88888'],
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
    siblings: [[second.noteCommitment, '0'], ...emptySiblings().slice(1)],
  });
  const secondWithPath = await evalGadgets({
    contextField,
    actionField,
    ask: '77777',
    nk: '88888',
    rho: '44444',
    value: '6000000',
    leafIndex: '1',
    siblings: [[first.noteCommitment, '0'], ...emptySiblings().slice(1)],
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
  const dummyOutput = await evalGadgets({
    contextField,
    actionField,
    ask: '333',
    nk: '444',
    rho: '66666',
    value: '0',
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
      actionField,
      nullifier: [firstWithPath.nullifier, secondNullifierUnderSharedNk],
      outputCommitment: [output.noteCommitment, dummyOutput.noteCommitment],
      ask: '11111',
      nk: '22222',
      inputReal: ['1', '1'],
      inputDummySecret: ['0', '0'],
      inputOwnerCommitment: [first.ownerCommitment, second.ownerCommitment],
    inputDiversifier: ['0', '0'],
      inputValue: ['4000000', '6000000'],
      inputRho: ['33333', '44444'],
      inputLeafIndex: ['0', '1'],
      inputSiblings: [
        [[second.noteCommitment, '0'], ...emptySiblings().slice(1)],
        [[first.noteCommitment, '0'], ...emptySiblings().slice(1)],
      ],
      inputPositions: [positionsFor(0), positionsFor(1)],
      outputOwnerCommitment: [output.ownerCommitment, dummyOutput.ownerCommitment],
      outputValue: ['10000000', '0'],
      outputRho: ['55555', '66666'],
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
      actionField,
      nullifier: [input.nullifier, dummyNullifier(contextField, '907')],
      outputCommitment: [output.noteCommitment, output.noteCommitment],
      ask: '11111',
      nk: '22222',
      inputReal: ['1', '0'],
      inputDummySecret: ['0', '907'],
      inputOwnerCommitment: [input.ownerCommitment, '0'],
    inputDiversifier: ['0', '0'],
      inputValue: ['10000000', '0'],
      inputRho: ['33333', '0'],
      inputLeafIndex: ['0', '0'],
      inputSiblings: [emptySiblings(), emptySiblings()],
      inputPositions: [positionsFor(0), positionsFor(0)],
      outputOwnerCommitment: [output.ownerCommitment, output.ownerCommitment],
      outputValue: ['5000000', '5000000'],
      outputRho: ['44444', '44444'],
    }),
    /Assert Failed|Error/,
  );
});
