import { bigintTo32Bytes, bytesToBigint } from './field.js';
import { equalBytes } from './hash.js';
import { poseidon2Hash } from './poseidon2.js';

export const TREE_ARITY = 3;
export const TREE_INNER_DEPTH = 17;
export const TREE_OUTER_DEPTH = 47;
export const TREE_DEPTH = TREE_INNER_DEPTH + TREE_OUTER_DEPTH;
export const TREE_CAPACITY = 3n ** BigInt(TREE_DEPTH);
export const TREE_FRONTIER_WIDTH = TREE_ARITY - 1;
export const TREE_FRONTIER_SIZE = TREE_DEPTH * TREE_FRONTIER_WIDTH;

export type MerkleChildren = readonly [Uint8Array, Uint8Array, Uint8Array];
export type MerkleSiblings = readonly [Uint8Array, Uint8Array];

export function hashMerkleNode(children: MerkleChildren): Uint8Array {
  for (const child of children) {
    if (!(child instanceof Uint8Array) || child.length !== 32) {
      throw new Error('Merkle child must be 32 bytes');
    }
  }
  return bigintTo32Bytes(poseidon2Hash(children.map(bytesToBigint)));
}

const computedEmptyRoots: Uint8Array[] = [new Uint8Array(32)];
for (let level = 0; level < TREE_DEPTH; level += 1) {
  const empty = computedEmptyRoots[level];
  computedEmptyRoots.push(hashMerkleNode([empty, empty, empty]));
}

export const EMPTY_ROOTS: readonly Uint8Array[] = computedEmptyRoots;

export interface MerkleTree {
  nextIndex: bigint;
  // Two partial subtrees per level, flattened as level * 2 + child position.
  frontier: Uint8Array[];
  currentRoot: Uint8Array;
}

export interface MerklePathWitness {
  leaf: Uint8Array;
  leafIndex: bigint;
  siblings: [Uint8Array, Uint8Array][];
  positions: number[];
  root: Uint8Array;
}

export type MerkleHash = (
  children: MerkleChildren,
) => Uint8Array | Promise<Uint8Array>;

function frontierOffset(level: number, position: 0 | 1): number {
  return level * TREE_FRONTIER_WIDTH + position;
}

function initialFrontier(): Uint8Array[] {
  return Array.from({ length: TREE_FRONTIER_SIZE }, (_, index) => (
    EMPTY_ROOTS[Math.floor(index / TREE_FRONTIER_WIDTH)].slice()
  ));
}

export async function getEmptyRoots(): Promise<Uint8Array[]> {
  return EMPTY_ROOTS.map(root => root.slice());
}

export async function createEmptyTree(): Promise<MerkleTree> {
  return {
    nextIndex: 0n,
    frontier: initialFrontier(),
    currentRoot: EMPTY_ROOTS[TREE_DEPTH].slice(),
  };
}

export async function appendFrontier(
  tree: MerkleTree,
  leaf: Uint8Array,
  hash: MerkleHash = hashMerkleNode,
): Promise<void> {
  if (leaf.length !== 32) throw new Error('Commitment must be 32 bytes');
  if (tree.frontier.length !== TREE_FRONTIER_SIZE) throw new Error('Invalid Merkle frontier');
  if (typeof tree.nextIndex !== 'bigint' || tree.nextIndex < 0n) throw new Error('Invalid Merkle index');
  if (tree.nextIndex >= TREE_CAPACITY) throw new Error('Merkle tree full');

  let current: Uint8Array = leaf.slice();
  let nodeIndex = tree.nextIndex;
  let level = 0;
  for (;;) {
    const position = Number(nodeIndex % 3n);
    if (position === 0) {
      tree.frontier[frontierOffset(level, 0)] = current;
      break;
    }
    if (position === 1) {
      tree.frontier[frontierOffset(level, 1)] = current;
      break;
    }
    current = await hash([
      tree.frontier[frontierOffset(level, 0)],
      tree.frontier[frontierOffset(level, 1)],
      current,
    ]);
    nodeIndex = nodeIndex / 3n;
    level += 1;
    if (level === TREE_DEPTH) {
      tree.currentRoot = current;
      break;
    }
  }
  tree.nextIndex += 1n;
}

export async function refreshTreeRoot(
  tree: MerkleTree,
  hash: MerkleHash = hashMerkleNode,
): Promise<Uint8Array> {
  if (typeof tree.nextIndex !== 'bigint' || tree.nextIndex < 0n || tree.nextIndex > TREE_CAPACITY) throw new Error('Invalid Merkle index');
  if (tree.nextIndex === TREE_CAPACITY) return tree.currentRoot.slice();
  if (tree.frontier.length !== TREE_FRONTIER_SIZE) throw new Error('Invalid Merkle frontier');
  let current: Uint8Array = EMPTY_ROOTS[0].slice();
  let nodeIndex = tree.nextIndex;
  for (let level = 0; level < TREE_DEPTH; level += 1) {
    const empty = EMPTY_ROOTS[level];
    const position = Number(nodeIndex % 3n);
    current = position === 0
      ? await hash([current, empty, empty])
      : position === 1
        ? await hash([tree.frontier[frontierOffset(level, 0)], current, empty])
        : await hash([
          tree.frontier[frontierOffset(level, 0)],
          tree.frontier[frontierOffset(level, 1)],
          current,
        ]);
    nodeIndex = nodeIndex / 3n;
  }
  tree.currentRoot = current;
  return current.slice();
}

export async function appendCommitment(tree: MerkleTree, leaf: Uint8Array): Promise<Uint8Array> {
  await appendFrontier(tree, leaf);
  return refreshTreeRoot(tree);
}

export async function appendCommitments(tree: MerkleTree, leaves: Uint8Array[]): Promise<Uint8Array> {
  for (const leaf of leaves) await appendFrontier(tree, leaf);
  return leaves.length === 0 ? tree.currentRoot.slice() : refreshTreeRoot(tree);
}

function nodeKey(level: number, index: bigint): string {
  return `${level}:${index}`;
}

export class MerkleNodeStore {
  private readonly nodes = new Map<string, Uint8Array>();
  private _nextIndex = 0n;
  private _currentRoot: Uint8Array;

  private constructor(emptyRoot: Uint8Array) {
    this._currentRoot = Uint8Array.from(emptyRoot);
  }

  public static async empty(): Promise<MerkleNodeStore> {
    return new MerkleNodeStore(EMPTY_ROOTS[TREE_DEPTH]);
  }

  public static async fromCommitments(commitments: readonly Uint8Array[]): Promise<MerkleNodeStore> {
    if (commitments.length > TREE_CAPACITY) throw new Error('Merkle tree full');
    const store = await MerkleNodeStore.empty();
    for (const commitment of commitments) await store.append(commitment);
    return store;
  }

  public get nextIndex(): bigint {
    return this._nextIndex;
  }

  public get currentRoot(): Uint8Array {
    return Uint8Array.from(this._currentRoot);
  }

  public async append(leaf: Uint8Array): Promise<Uint8Array> {
    if (leaf.length !== 32) throw new Error('Commitment must be 32 bytes');
    if (this._nextIndex >= TREE_CAPACITY) throw new Error('Merkle tree full');
    let nodeIndex = this._nextIndex;
    this.nodes.set(nodeKey(0, nodeIndex), Uint8Array.from(leaf));

    for (let level = 0; level < TREE_DEPTH; level += 1) {
      const parentIndex = nodeIndex / 3n;
      const firstChildIndex = parentIndex * 3n;
      const children = [0, 1, 2].map(offset => (
        this.nodes.get(nodeKey(level, firstChildIndex + BigInt(offset))) ?? EMPTY_ROOTS[level]
      )) as [Uint8Array, Uint8Array, Uint8Array];
      const parent = hashMerkleNode(children);
      this.nodes.set(nodeKey(level + 1, parentIndex), parent);
      nodeIndex = parentIndex;
    }

    this._nextIndex += 1n;
    this._currentRoot = Uint8Array.from(
      this.nodes.get(nodeKey(TREE_DEPTH, 0n)) ?? EMPTY_ROOTS[TREE_DEPTH],
    );
    return this.currentRoot;
  }

  public async getPath(leafIndex: bigint): Promise<MerklePathWitness> {
    if (typeof leafIndex !== 'bigint' || leafIndex < 0n || leafIndex >= this._nextIndex) {
      throw new Error('Merkle leaf is not present');
    }
    const leaf = this.nodes.get(nodeKey(0, leafIndex));
    if (!leaf) throw new Error('Merkle leaf is not present');

    const siblings: [Uint8Array, Uint8Array][] = [];
    const positions: number[] = [];
    let current: Uint8Array = Uint8Array.from(leaf);
    let nodeIndex = leafIndex;
    for (let level = 0; level < TREE_DEPTH; level += 1) {
      const position = Number(nodeIndex % 3n);
      const firstChildIndex = nodeIndex - BigInt(position);
      const children = [0, 1, 2].map(offset => (
        offset === position
          ? current
          : Uint8Array.from(
            this.nodes.get(nodeKey(level, firstChildIndex + BigInt(offset))) ?? EMPTY_ROOTS[level],
          )
      )) as [Uint8Array, Uint8Array, Uint8Array];
      siblings.push(children.filter((_, index) => index !== position) as [Uint8Array, Uint8Array]);
      positions.push(position);
      current = hashMerkleNode(children);
      nodeIndex = nodeIndex / 3n;
    }
    if (!equalBytes(current, this._currentRoot)) {
      throw new Error('Merkle node store is inconsistent with its current root');
    }
    return {
      leaf: Uint8Array.from(leaf),
      leafIndex,
      siblings,
      positions,
      root: Uint8Array.from(current),
    };
  }
}
