export declare const PRIVATE_ADDRESS_PAYLOAD_BYTES = 68;
export declare const ADDRESS_DIVERSIFIER_BYTES = 4;
export declare const PRIVATE_ADDRESS_ASCII_BYTES = 119;
export type PrivateAddressPrefix = 'tks' | 'sks';
export interface PrivateAddress {
    diversifier: Uint8Array;
    ownerCommitment: Uint8Array;
    hpkePublicKey: Uint8Array;
}
export declare function encodePrivateAddress(address: PrivateAddress, prefix: string): string;
export declare function decodePrivateAddress(encoded: string, expectedPrefix: string): Promise<PrivateAddress>;
export declare function groupPrivateAddress(address: string): string;
