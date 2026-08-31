export declare const TREE_DEPTH = 32;
export declare const DOMAIN_MERKLE = "SKSB_MERKLE_NODE_V1";
export declare const EMPTY_ROOTS: readonly Uint8Array[];
export interface MerkleTree {
    nextIndex: number;
    frontier: Uint8Array[];
    currentRoot: Uint8Array;
}
export interface MerklePathWitness {
    leaf: Uint8Array;
    leafIndex: number;
    siblings: Uint8Array[];
    directionBits: number[];
    root: Uint8Array;
}
export type MerkleHash = (left: Uint8Array, right: Uint8Array) => Uint8Array | Promise<Uint8Array>;
export declare function getEmptyRoots(): Promise<Uint8Array[]>;
export declare function createEmptyTree(): Promise<MerkleTree>;
export declare function appendFrontier(tree: MerkleTree, leaf: Uint8Array, hash?: MerkleHash): Promise<void>;
export declare function refreshTreeRoot(tree: MerkleTree, hash?: MerkleHash): Promise<Uint8Array>;
export declare function appendCommitment(tree: MerkleTree, leaf: Uint8Array): Promise<Uint8Array>;
export declare function appendCommitments(tree: MerkleTree, leaves: Uint8Array[]): Promise<Uint8Array>;
export declare class MerkleNodeStore {
    private readonly nodes;
    private _nextIndex;
    private _currentRoot;
    private constructor();
    static empty(): Promise<MerkleNodeStore>;
    static fromCommitments(commitments: readonly Uint8Array[]): Promise<MerkleNodeStore>;
    get nextIndex(): number;
    get currentRoot(): Uint8Array;
    append(leaf: Uint8Array): Promise<Uint8Array>;
    getPath(leafIndex: number): Promise<MerklePathWitness>;
}
