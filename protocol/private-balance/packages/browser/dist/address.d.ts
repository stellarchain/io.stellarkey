export declare const PRIVATE_ADDRESS_PAYLOAD_BYTES = 100;
export declare const ADDRESS_DIVERSIFIER_BYTES = 4;
export declare const PRIVATE_ADDRESS_ASCII_BYTES = 170;
export type PrivateAddressPrefix = 'tks' | 'sks';
export interface PrivateAddress {
    deploymentBindingHash: Uint8Array;
    diversifier: Uint8Array;
    ownerCommitment: Uint8Array;
    hpkePublicKey: Uint8Array;
}
export declare function encodePrivateAddress(address: PrivateAddress, prefix: string): string;
export declare function decodePrivateAddress(encoded: string, expectedPrefix: string, expectedDeploymentBindingHash?: Uint8Array): Promise<PrivateAddress>;
export declare function groupPrivateAddress(address: string): string;
