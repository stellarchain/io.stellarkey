import { p2 } from './poseidon2.js';
import { equalBytes } from './hash.js';
export const TREE_DEPTH = 32;
export const DOMAIN_MERKLE = 'SKSB_MERKLE_NODE_V1';
const EMPTY_ROOT_HEXES = [
    '0000000000000000000000000000000000000000000000000000000000000000',
    '0f7c2789476dc071529b9e3b40c2ec7a80d6e713e9589457abc7b25191b67b29',
    '0d43ebf9e470ed8a96f853e933a0f4788114fb3ccc2e82a03305e89f25825d80',
    '24bc9221ecc1487fca1d18ef95fec226aad4c9d5e8da83e8cdd539950cf27d05',
    '0c12d256cb26917631491388432ee0db2b8dd5ed37e4ce9403506bcaee3ef157',
    '0357f785c10179e3117163d89cc483316f41c8fc644708a6645e1f00fd1facbd',
    '2706d06eb5f7abeaf81abaf30655c10b1440cb8dd9e57cf5923f6792bebfc01e',
    '1c7d88c18f76ebc6352d1a5e6fac337a9d93c9eb44bef2075d81a3661410b88d',
    '0a7489501fbf8f1d7867ec2095d443781279a038332a9b73c42202e483554ed6',
    '0e4646e28c25e7d0714a896be3b5acaf6c9904a847ae8ef52c890e8fef9dbc9c',
    '04d25dff536b2ccb34ecd8bc0bb2b52aaed25f2d6f97b09977d3b9c8bbb5d291',
    '0f671dfa78647b718b165884aaea767b768a022fb92aed7c499d8a810ab57165',
    '1b7981da3b6295881a39edcdeb3818eb8a81a3648b2f770d3d2d01ffb3b41ef2',
    '20152fa61dba4d8e5fb0905d2eaac53031a6660dd36061ab0bd5c481ca00f503',
    '2dac8eb58b489bd74c29903b587577a480bf4f14a17d1930f4826a2c120d2fa7',
    '1b2e05e523ce6f2ca56454a2009da3089c1a203b469b6b9099026277c5443698',
    '1ce1c933da4f4292af1d720984f1e338a4543896050721705009d0d1472d5cb4',
    '2aedbd2263c29d05fe25fab45e0e302a278edf9f3277d6b46c66c482abb90a08',
    '2852eb6024eb6d5b1b6b5d6936071fbe737576dc1d357b25e2f7b328c386f0cd',
    '00e15bc0b2b424ea06eba41ab1a54d1aa1daa901fa060b88b085910d70db2714',
    '04e44ef91546201b5773e875afe663998100a33d0f53d696849f995b4eed05e7',
    '1c77e58c802f130c845557decc519dbbda2c34a20df7cf28ede07be9ab742066',
    '2d74985d79db03f7ba598806a3f9fe4eae3a3bb7e292ddfc52112d351983d590',
    '226bf0a63692ab678e01ca37df94e03e9a652bdc932daa2de6e81896045b3375',
    '1d981537f02514ae15cb7ed1718653e5ed2b03b11b36ba9a3fc712e71bffdd6d',
    '2cc19110b437ead061a0ebf0340e79cceb397b4deed01bc109f8f1b8502ad098',
    '14ab202bdc00e9241e1c9926c5c5492c8eb6e776a4be09639cc66acbe24382e4',
    '19859c8232ddf1c519cc4aadf011c89efd90ca30b40b8a96fa557d4142299ab8',
    '28c184e7fbb8b63c6d88ac9f3ec43161e8b4ba171a8205ffadec8236971f71ea',
    '2fde26459b3f7e57e665c5f3a71a80c7488d2458403818ad939a89100eb118b7',
    '0084be1c34626938ca37c98f70d466b27c114132624f767b0979e4a4ee80fd77',
    '0268d5cc1e50f7ca209a3bdfa176e47ef2a0d0b4f0cb11b03ba6df0bf6a8d3b0',
    '047585958785546e518e72d1bbfb7c573205c35c332e0b876f60218918401a59',
];
export const EMPTY_ROOTS = EMPTY_ROOT_HEXES.map(value => Uint8Array.from(value.match(/../g) ?? [], byte => Number.parseInt(byte, 16)));
const hashMerkleParent = (left, right) => p2(DOMAIN_MERKLE, [left, right]);
export async function getEmptyRoots() {
    return EMPTY_ROOTS.map(root => root.slice());
}
export async function createEmptyTree() {
    return {
        nextIndex: 0,
        frontier: EMPTY_ROOTS.slice(0, TREE_DEPTH).map(root => root.slice()),
        currentRoot: EMPTY_ROOTS[TREE_DEPTH].slice(),
    };
}
export async function appendFrontier(tree, leaf, hash = hashMerkleParent) {
    if (leaf.length !== 32)
        throw new Error('Commitment must be 32 bytes');
    if (tree.nextIndex >= 2 ** TREE_DEPTH)
        throw new Error('Merkle tree full');
    let current = leaf.slice();
    let nodeIndex = tree.nextIndex;
    let level = 0;
    while ((nodeIndex & 1) === 1) {
        current = await hash(tree.frontier[level], current);
        nodeIndex = Math.floor(nodeIndex / 2);
        level += 1;
    }
    if (level < TREE_DEPTH)
        tree.frontier[level] = current;
    else
        tree.currentRoot = current;
    tree.nextIndex += 1;
}
export async function refreshTreeRoot(tree, hash = hashMerkleParent) {
    if (tree.nextIndex === 2 ** TREE_DEPTH)
        return tree.currentRoot.slice();
    let current = EMPTY_ROOTS[0].slice();
    let nodeIndex = tree.nextIndex;
    for (let level = 0; level < TREE_DEPTH; level += 1) {
        current = (nodeIndex & 1) === 1
            ? await hash(tree.frontier[level], current)
            : await hash(current, EMPTY_ROOTS[level]);
        nodeIndex = Math.floor(nodeIndex / 2);
    }
    tree.currentRoot = current;
    return current.slice();
}
export async function appendCommitment(tree, leaf) {
    await appendFrontier(tree, leaf);
    return refreshTreeRoot(tree);
}
export async function appendCommitments(tree, leaves) {
    for (const leaf of leaves)
        await appendFrontier(tree, leaf);
    return leaves.length === 0 ? tree.currentRoot.slice() : refreshTreeRoot(tree);
}
function nodeKey(level, index) {
    return `${level}:${index}`;
}
export class MerkleNodeStore {
    nodes = new Map();
    _nextIndex = 0;
    _currentRoot;
    constructor(emptyRoot) {
        this._currentRoot = Uint8Array.from(emptyRoot);
    }
    static async empty() {
        return new MerkleNodeStore(EMPTY_ROOTS[TREE_DEPTH]);
    }
    static async fromCommitments(commitments) {
        if (commitments.length > 2 ** TREE_DEPTH)
            throw new Error('Merkle tree full');
        const store = await MerkleNodeStore.empty();
        for (const [index, commitment] of commitments.entries()) {
            if (commitment.length !== 32)
                throw new Error('Commitment must be 32 bytes');
            store.nodes.set(nodeKey(0, index), Uint8Array.from(commitment));
        }
        let width = commitments.length;
        for (let level = 0; level < TREE_DEPTH && width > 0; level += 1) {
            const parentCount = Math.ceil(width / 2);
            for (let parentIndex = 0; parentIndex < parentCount; parentIndex += 1) {
                const left = store.nodes.get(nodeKey(level, parentIndex * 2)) ?? EMPTY_ROOTS[level];
                const right = store.nodes.get(nodeKey(level, parentIndex * 2 + 1)) ?? EMPTY_ROOTS[level];
                store.nodes.set(nodeKey(level + 1, parentIndex), await hashMerkleParent(left, right));
            }
            width = parentCount;
        }
        store._nextIndex = commitments.length;
        store._currentRoot = Uint8Array.from(store.nodes.get(nodeKey(TREE_DEPTH, 0)) ?? EMPTY_ROOTS[TREE_DEPTH]);
        return store;
    }
    get nextIndex() {
        return this._nextIndex;
    }
    get currentRoot() {
        return Uint8Array.from(this._currentRoot);
    }
    async append(leaf) {
        if (leaf.length !== 32)
            throw new Error('Commitment must be 32 bytes');
        if (this._nextIndex >= 2 ** TREE_DEPTH)
            throw new Error('Merkle tree full');
        let nodeIndex = this._nextIndex;
        this.nodes.set(nodeKey(0, nodeIndex), Uint8Array.from(leaf));
        for (let level = 0; level < TREE_DEPTH; level += 1) {
            const parentIndex = Math.floor(nodeIndex / 2);
            const leftIndex = parentIndex * 2;
            const rightIndex = leftIndex + 1;
            const left = this.nodes.get(nodeKey(level, leftIndex)) ?? EMPTY_ROOTS[level];
            const right = this.nodes.get(nodeKey(level, rightIndex)) ?? EMPTY_ROOTS[level];
            const parent = await hashMerkleParent(left, right);
            this.nodes.set(nodeKey(level + 1, parentIndex), parent);
            nodeIndex = parentIndex;
        }
        this._nextIndex += 1;
        this._currentRoot = Uint8Array.from(this.nodes.get(nodeKey(TREE_DEPTH, 0)) ?? EMPTY_ROOTS[TREE_DEPTH]);
        return this.currentRoot;
    }
    async getPath(leafIndex) {
        if (!Number.isSafeInteger(leafIndex) || leafIndex < 0 || leafIndex >= this._nextIndex) {
            throw new Error('Merkle leaf is not present');
        }
        const leaf = this.nodes.get(nodeKey(0, leafIndex));
        if (!leaf)
            throw new Error('Merkle leaf is not present');
        const siblings = [];
        const directionBits = [];
        let current = Uint8Array.from(leaf);
        for (let level = 0; level < TREE_DEPTH; level += 1) {
            const nodeIndex = Math.floor(leafIndex / 2 ** level);
            const direction = nodeIndex % 2;
            const siblingIndex = direction === 0 ? nodeIndex + 1 : nodeIndex - 1;
            const sibling = Uint8Array.from(this.nodes.get(nodeKey(level, siblingIndex)) ?? EMPTY_ROOTS[level]);
            siblings.push(sibling);
            directionBits.push(direction);
            current = direction === 0
                ? await hashMerkleParent(current, sibling)
                : await hashMerkleParent(sibling, current);
        }
        if (!equalBytes(current, this._currentRoot)) {
            throw new Error('Merkle node store is inconsistent with its current root');
        }
        return {
            leaf: Uint8Array.from(leaf),
            leafIndex,
            siblings,
            directionBits,
            root: Uint8Array.from(current),
        };
    }
}
