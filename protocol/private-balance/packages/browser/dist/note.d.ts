export declare const NOTE_PLAINTEXT_BYTES = 128;
export declare const MEMO_BYTES = 32;
export declare const MAX_NOTE_VALUE: bigint;
export declare const DOMAIN_NOTE = "SKSB_NOTE_COMMITMENT_V1";
export declare const DOMAIN_NULLIFIER = "SKSB_NULLIFIER_V1";
export interface NotePlaintext {
    protocolVersion: number;
    flags: number;
    value: bigint;
    diversifier: Uint8Array;
    ownerCommitment: Uint8Array;
    rho: Uint8Array;
    memoLength: number;
    memo: Uint8Array;
    reserved: Uint8Array;
}
export declare function encodeNotePlaintext(note: NotePlaintext): Uint8Array;
export declare function decodeNotePlaintext(bytes: Uint8Array): NotePlaintext;
export declare function computeCommitment(contextField: Uint8Array, assetField: Uint8Array, ownerCommitment: Uint8Array, value: bigint, rho: Uint8Array): Uint8Array;
export declare function computeNullifier(contextField: Uint8Array, nk: Uint8Array, rho: Uint8Array, leafIndex: bigint, cm: Uint8Array): Uint8Array;
