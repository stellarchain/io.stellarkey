// All material here is deliberately non-usable synthetic test data. It is never
// loaded from a wallet, exported to application assets, or printed by the runner.
import { hash, Forest } from './model.mjs';

const D = {
  owner: 6572291656506234975797969757609184236602078616932335549748672120887455719780n,
  diversified: 14648730730437137655665581460901063522972457499366870315302424102560973417853n,
  note: 12305356573583967990145829509939363390395175012772578063495555266515310494866n,
  nullifier: 18852096319358378764148341035066066019156424927623416075041018694204746208236n,
  dummy: 11079287110993094273924039464477300343037036643499336743423997609200409937317n,
};
export const CONTEXT = 424242n; // Distinct from v1 fixtures and deployed contexts.
export const ASSET = 84n;
export const ACTION_DOMAIN = 987654321n;
const ASK = 111n;
const NK = 222n;
const owner = hash([D.diversified, hash([D.owner, CONTEXT, ASK, NK]), 7n]);
const decimalize = x => Array.isArray(x) ? x.map(decimalize) : typeof x === 'bigint' ? String(x) : x;
export const nullifier = (note, position) => hash([D.nullifier, CONTEXT, NK, note.rho, position, note.cm]);
export function note(value, rho) {
  return { value, rho, owner, cm: hash([D.note, CONTEXT, ASSET, owner, value, rho]) };
}
export function action(tree, kind, inputs, outputs, nonce) {
  const value = kind === 1 ? outputs.reduce((sum, n) => sum + n.value, 0n)
    : kind === 2 ? 0n : inputs.reduce((sum, n) => sum + n.note.value, 0n) - outputs.reduce((sum, n) => sum + n.value, 0n);
  const lanes = [0, 1].map(i => {
    const input = inputs[i];
    const secret = nonce * 10n + BigInt(i + 1);
    if (!input) return { real: 0n, secret, owner: 0n, diversifier: 0n, value: 0n, rho: 0n, position: 0n, siblings: Array.from({ length: tree.depth }, () => [0n, 0n]), positions: Array(tree.depth).fill(0n), nf: hash([D.dummy, CONTEXT, secret]) };
    const path = tree.path(input.position);
    if (path.leaf !== input.note.cm) throw new Error('fixture membership mismatch');
    let position = input.position;
    const positions = Array.from({ length: tree.depth }, () => { const trit = position % 3n; position /= 3n; return trit; });
    return { real: 1n, secret: 0n, owner: input.note.owner, diversifier: 7n, value: input.note.value, rho: input.note.rho, position: input.position, siblings: path.siblings, positions, nf: nullifier(input.note, input.position) };
  });
  const input = {
    contextField: CONTEXT, assetField: kind === 2 ? 0n : ASSET, actionKindField: BigInt(kind),
    anchorRoot: kind === 1 ? 0n : tree.root, publicValueField: value,
    actionField: 0n, nullifier: lanes.map(l => l.nf), outputCommitment: outputs.map(n => n.cm),
    actionAssetField: ASSET, ask: inputs.length ? ASK : 0n, nk: inputs.length ? NK : 0n,
    inputReal: lanes.map(l => l.real), inputDummySecret: lanes.map(l => l.secret),
    inputOwnerCommitment: lanes.map(l => l.owner), inputDiversifier: lanes.map(l => l.diversifier),
    inputValue: lanes.map(l => l.value), inputRho: lanes.map(l => l.rho), inputLeafIndex: lanes.map(l => l.position),
    inputSiblings: lanes.map(l => l.siblings), inputPositions: lanes.map(l => l.positions),
    outputOwnerCommitment: outputs.map(n => n.owner), outputValue: outputs.map(n => n.value), outputRho: outputs.map(n => n.rho),
  };
  input.actionField = hash([ACTION_DOMAIN, input.contextField, input.assetField, input.actionKindField, input.anchorRoot, input.publicValueField, ...input.nullifier, ...input.outputCommitment]);
  return Object.fromEntries(Object.entries(input).map(([k, v]) => [k, decimalize(v)]));
}

export function scenario(inner = 1, outer = 1) {
  const tree = new Forest(inner, outer);
  const a = note(40n, 1001n), b = note(60n, 1002n), c = note(100n, 1003n);
  const outputs = (real, base) => [real, note(0n, base), note(0n, base + 1n)];
  const first = outputs(a, 2000n), second = outputs(b, 3000n), third = outputs(c, 4000n);
  const frames = [];
  const push = (name, kind, inputs, outs, nonce) => {
    const input = action(tree, kind, inputs, outs, nonce);
    const record = tree.record(kind, kind === 4 ? [] : outs.map(n => n.cm), input.nullifier.map(BigInt));
    frames.push({ name, input, record, checkpoint: tree.checkpoint() });
  };
  push('deposit-a', 1, [], first, 1n);
  push('deposit-b-rollover', 1, [], second, 2n);
  const alternateExit = action(tree, 4, [{ note: a, position: 0n }, { note: b, position: 3n }],
    [note(0n, 6000n), note(0n, 6001n), note(0n, 6002n)], 6n);
  push('cross-subtree-transfer', 2, [{ note: a, position: 0n }, { note: b, position: 3n }], third, 3n);
  // On the 1+1 tree this is exactly full. The exit must neither change its root
  // nor append the three proof-bound zero-value dummy output commitments.
  push('full-input-exit', 4, [{ note: c, position: 6n }], outputs(note(0n, 5000n), 5001n), 4n);
  return { frames, tree, alternateExit };
}

export function fullCrossFixture() {
  const tree = new Forest(17, 47);
  const a = note(40n, 12001n), b = note(60n, 12002n);
  const second = 3n ** 17n;
  tree.setSyntheticLeaf(0n, a.cm);
  tree.setSyntheticLeaf(second, b.cm);
  return { tree, input: action(tree, 4, [{ note: a, position: 0n }, { note: b, position: second }],
    [note(0n, 12003n), note(0n, 12004n), note(0n, 12005n)], 12n) };
}
