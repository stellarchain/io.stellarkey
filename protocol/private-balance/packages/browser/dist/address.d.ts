export declare const ADDRESS_DIVERSIFIER_BYTES = 4;
export declare const PRIVATE_ADDRESS_DEPLOYMENT_TAG_BYTES = 16;
export declare const PRIVATE_ADDRESS_PAYLOAD_BYTES = 84;
export declare const PRIVATE_ADDRESS_CHECKSUM_BYTES = 4;
export declare const PRIVATE_ADDRESS_DECODED_BYTES = 89;
export declare const PRIVATE_ADDRESS_MAINNET_ASCII_BYTES = 127;
export declare const PRIVATE_ADDRESS_TESTNET_ASCII_BYTES = 128;
/** Current Testnet deployment width; use the network-specific constants when decoding either network. */
export declare const PRIVATE_ADDRESS_ASCII_BYTES = 128;
declare const MAINNET_PREFIX = "skpay_";
declare const TESTNET_PREFIX = "tskpay_";
export type PrivateAddressPrefix = typeof MAINNET_PREFIX | typeof TESTNET_PREFIX;
export interface PrivateAddress {
    deploymentTag: Uint8Array;
    diversifier: Uint8Array;
    ownerCommitment: Uint8Array;
    hpkePublicKey: Uint8Array;
}
export declare function derivePrivateAddressDeploymentTag(deploymentBindingHash: Uint8Array): Uint8Array;
export declare function encodePrivateAddress(address: PrivateAddress, prefix: string): string;
export declare function decodePrivateAddress(encoded: string, expectedPrefix: string, expectedDeploymentBindingHash?: Uint8Array): Promise<PrivateAddress>;
export declare function groupPrivateAddress(address: string): string;
export {};
