export declare const BN254_FR_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export declare const BN254_FR_MODULUS_BYTES: Uint8Array<ArrayBuffer>;
export declare function isCanonicalField(bytes: Uint8Array): boolean;
export declare function bytesToField(bytes: Uint8Array): Uint8Array;
export declare function bigintTo32Bytes(n: bigint): Uint8Array;
export declare function bytesToBigint(bytes: Uint8Array): bigint;
export declare function fieldId(label: string, payload: Uint8Array): Uint8Array;
