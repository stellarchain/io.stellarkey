// Local synthetic research model. No wallet storage, RPC or production imports.
import { createHash } from 'node:crypto';
import { poseidon2Hash } from '../../packages/browser/dist/poseidon2.js';
import { BN254_FR_MODULUS } from '../../packages/browser/dist/field.js';

const U128_MAX = (1n << 128n) - 1n;
const field = x => {
  if (typeof x !== 'bigint' || x < 0n || x >= BN254_FR_MODULUS) throw new Error('invalid field');
  return x;
};
const decimal = x => {
  if (typeof x !== 'string' || !/^(0|[1-9][0-9]*)$/.test(x)) throw new Error('invalid decimal');
  return BigInt(x);
};
export const hash = values => poseidon2Hash(values.map(field));

export function rootFromPath(leaf, position, siblings) {
  let node = field(leaf);
  for (const pair of siblings) {
    if (pair.length !== 2) throw new Error('invalid path');
    const children = [...pair];
    children.splice(Number(position % 3n), 0, node);
    node = hash(children);
    position /= 3n;
  }
  if (position !== 0n) throw new Error('position outside path');
  return node;
}

export function recordHash(r) {
  return createHash('sha256').update(JSON.stringify([
    'StellarKey capacity-v2 synthetic archive', r.index, r.kind, r.start,
    r.commitments, r.nullifiers, r.payload, r.root, r.previous,
  ])).digest('hex');
}

export class Forest {
  constructor(innerDepth, outerDepth) {
    if (![innerDepth, outerDepth].every(x => Number.isInteger(x) && x > 0) || innerDepth + outerDepth > 64) throw new Error('invalid depth');
    this.innerDepth = innerDepth;
    this.depth = innerDepth + outerDepth;
    this.capacity = 3n ** BigInt(this.depth);
    this.next = 0n;
    this.actions = 0n;
    this.transcript = '0'.repeat(64);
    this.spent = new Set();
    this.nodes = Array.from({ length: this.depth + 1 }, () => new Map());
    this.zeros = [0n];
    for (let i = 0; i < this.depth; i++) this.zeros.push(hash(Array(3).fill(this.zeros[i])));
  }
  get root() { return this.nodes[this.depth].get(0n) ?? this.zeros[this.depth]; }
  checkpoint() { return { root: String(this.root), next: String(this.next), actions: String(this.actions), transcript: this.transcript }; }
  setSyntheticLeaf(position, leaf) {
    if (typeof position !== 'bigint' || position < 0n || position >= this.capacity) throw new Error('invalid position');
    this.nodes[0].set(position, field(leaf));
    for (let level = 0; level < this.depth; level++) {
      const base = position - position % 3n;
      const children = [0n, 1n, 2n].map(offset => this.nodes[level].get(base + offset) ?? this.zeros[level]);
      position /= 3n;
      this.nodes[level + 1].set(position, hash(children));
    }
  }
  append(commitments) {
    if (commitments.length !== 3) throw new Error('expected three outputs');
    commitments.forEach(field);
    if (commitments.some(x => x === 0n) || new Set(commitments).size !== 3) throw new Error('invalid outputs');
    // Crossing an inner-tree boundary carries into the authenticated outer path.
    if (this.next + 3n > this.capacity) throw new Error('capacity exhausted');
    for (const commitment of commitments) this.setSyntheticLeaf(this.next++, commitment);
  }
  path(position) {
    const leaf = this.nodes[0].get(position);
    if (leaf === undefined) throw new Error('missing leaf');
    const globalPosition = position;
    const siblings = [];
    for (let level = 0; level < this.depth; level++) {
      const trit = position % 3n;
      const base = position - trit;
      siblings.push([0n, 1n, 2n].filter(x => x !== trit).map(x => this.nodes[level].get(base + x) ?? this.zeros[level]));
      position /= 3n;
    }
    const innerCapacity = 3n ** BigInt(this.innerDepth);
    return { leaf, siblings, subtree: globalPosition / innerCapacity, localPosition: globalPosition % innerCapacity };
  }
  // Models the post-proof state transition only. This method does not verify a
  // spend proof or move tokens. The independent Soroban harness does both.
  record(kind, commitments, nullifiers, payload = []) {
    if (![1, 2, 3, 4].includes(kind)) throw new Error('invalid kind');
    if (nullifiers.length !== 2 || new Set(nullifiers).size !== 2) throw new Error('invalid nullifiers');
    nullifiers.forEach(field);
    if (nullifiers.some(x => x === 0n || this.spent.has(x))) throw new Error('spent or invalid nullifier');
    if (this.actions === U128_MAX) throw new Error('action counter exhausted');
    if (kind === 4 && commitments.length !== 0) throw new Error('exit has no outputs');
    if (!Array.isArray(payload) || (payload.length !== 0 && payload.length !== commitments.length)
      || payload.some(x => typeof x !== 'string' || x.length > 1024 || !/^(?:[0-9a-f]{2})+$/.test(x))) throw new Error('invalid payload');
    const start = this.next;
    if (kind !== 4) this.append(commitments);
    const record = { index: String(this.actions), kind, start: String(start), commitments: commitments.map(String), nullifiers: nullifiers.map(String), payload: [...payload], root: String(this.root), previous: this.transcript };
    record.hash = recordHash(record);
    nullifiers.forEach(x => this.spent.add(x));
    this.actions++;
    this.transcript = record.hash;
    return record;
  }
}

export function recover(innerDepth, outerDepth, records, trustedCheckpoint) {
  // Fresh isolated state is published only after complete replay/checkpoint checks.
  const candidate = new Forest(innerDepth, outerDepth);
  for (const record of records) {
    if (record.index !== String(candidate.actions) || record.start !== String(candidate.next) || record.previous !== candidate.transcript || recordHash(record) !== record.hash) throw new Error('archive corruption');
    const computed = candidate.record(record.kind, record.commitments.map(decimal), record.nullifiers.map(decimal), record.payload);
    if (computed.root !== record.root || computed.hash !== record.hash) throw new Error('archive root mismatch');
  }
  const actual = candidate.checkpoint();
  if (Object.keys(actual).some(k => actual[k] !== trustedCheckpoint[k])) throw new Error('checkpoint mismatch');
  return candidate;
}
