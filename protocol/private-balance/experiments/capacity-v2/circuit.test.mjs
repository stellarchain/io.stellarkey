import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import calculator from '../../circuits/node_modules/circom_runtime/js/witness_calculator.js';
import { scenario, action, note, fullCrossFixture } from './fixtures.mjs';
import { Forest } from './model.mjs';

const small = await calculator(readFileSync(new URL('./build/small/action_js/action.wasm', import.meta.url)));
const full = await calculator(readFileSync(new URL('./build/full/action_js/action.wasm', import.meta.url)));
const { frames } = scenario();
const witness = (wc, input) => wc.calculateWitness(input, true);

test('full-depth proof paths hide distinct 17-level source subtrees', async () => {
  await witness(full, fullCrossFixture().input);
});

test('real witnesses allow rollover, a cross-subtree spend, and zero-append exit', async () => {
  for (const { input } of frames) await witness(small, input);
});
test('full-depth witness binds a position beyond u64 privately', async () => {
  const tree = new Forest(17, 47);
  const inputNote = note(100n, 9001n);
  const position = (1n << 80n) + 42n;
  tree.setSyntheticLeaf(position, inputNote.cm);
  const input = action(tree, 4, [{ note: inputNote, position }], [note(0n, 9002n), note(0n, 9003n), note(0n, 9004n)], 9n);
  await witness(full, input);
  const bad = structuredClone(input);
  bad.inputLeafIndex[0] = String(position + 1n);
  await assert.rejects(witness(full, bad));
});
test('exit rejects hidden change, forged value, wrong owner and wrong membership', async () => {
  const exit = frames[3].input;
  for (const mutate of [
    x => { x.outputValue[0] = '1'; },
    x => { x.publicValueField = String(BigInt(x.publicValueField) + 1n); },
    x => { x.ask = '999'; },
    x => { x.anchorRoot = '1'; },
    x => { x.inputSiblings[0][1][0] = '1'; },
    x => { x.inputPositions[0][1] = '0'; },
    x => { x.nullifier[0] = '1'; },
  ]) {
    const bad = structuredClone(exit); mutate(bad);
    await assert.rejects(witness(small, bad));
  }
});
test('exit mode cannot retain valid hidden change from a normal withdrawal', async () => {
  const tree = new Forest(1, 1), n = note(100n, 11001n);
  tree.append([n.cm, note(0n, 11002n).cm, note(0n, 11003n).cm]);
  const outputs = [note(40n, 11004n), note(0n, 11005n), note(0n, 11006n)];
  await witness(small, action(tree, 3, [{ note: n, position: 0n }], outputs, 11n));
  await assert.rejects(witness(small, action(tree, 4, [{ note: n, position: 0n }], outputs, 12n)));
});
