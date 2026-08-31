export declare function utf8(value: string): Uint8Array;
export declare function concatBytes(...chunks: Uint8Array[]): Uint8Array;
export declare function sha256Bytes(...chunks: Uint8Array[]): Uint8Array;
export declare function sha512Bytes(...chunks: Uint8Array[]): Uint8Array;
export declare function hmacSha512(key: Uint8Array, ...chunks: Uint8Array[]): Uint8Array;
export declare function equalBytes(left: Uint8Array, right: Uint8Array): boolean;
