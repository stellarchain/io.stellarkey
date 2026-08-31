export declare function encodeBech32m(hrp: string, payload: Uint8Array): string;
export declare function decodeBech32m(encoded: string, expectedHrp: string, expectedPayloadBytes: number): Uint8Array;
export declare function groupBech32m(encoded: string): string;
