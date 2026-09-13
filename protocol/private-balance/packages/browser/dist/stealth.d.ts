import { type X25519Implementation } from './x25519.js';
export type StealthNetwork = 'testnet' | 'mainnet';
export interface StealthMetaAddress {
    deploymentBindingHash: Uint8Array;
    scanPublicKey: Uint8Array;
    spendPublicKey: Uint8Array;
}
export interface StealthMetaKeys extends StealthMetaAddress {
    scanPrivateKey: Uint8Array;
    spendScalar: bigint;
    nonceKey: Uint8Array;
    network: StealthNetwork;
}
/** Sensitive recognition material, without one-time spending authority. */
export interface StealthViewingKeys extends StealthMetaAddress {
    scanPrivateKey: Uint8Array;
    network: StealthNetwork;
}
export interface StealthRecipient {
    publicKey: Uint8Array;
    ephemeralPublicKey: Uint8Array;
}
export interface StealthRecipientKey {
    publicKey: Uint8Array;
    spendScalar: bigint;
    nonceKey: Uint8Array;
}
export declare const STEALTH_META_ADDRESS_PAYLOAD_BYTES = 96;
export declare const STEALTH_META_ADDRESS_ASCII_BYTES = 164;
export declare function deriveStealthRootKey(privacySessionRoot: Uint8Array): Uint8Array;
export declare function deriveStealthMetaKeys(rootKey: Uint8Array, network: StealthNetwork, deploymentBindingHash: Uint8Array): StealthMetaKeys;
export declare function deriveStealthViewingKeys(rootKey: Uint8Array, network: StealthNetwork, deploymentBindingHash: Uint8Array): StealthViewingKeys;
export declare function encodeStealthMetaAddress(address: StealthMetaAddress, network: StealthNetwork): string;
export declare function decodeStealthMetaAddress(encoded: string, network: StealthNetwork, expectedDeploymentBindingHash?: Uint8Array): Promise<StealthMetaAddress>;
export declare function groupStealthMetaAddress(address: string): string;
export declare function deriveStealthRecipient(address: StealthMetaAddress, ephemeralPrivateKey: Uint8Array, network: StealthNetwork, implementation?: X25519Implementation): Promise<StealthRecipient>;
export declare function deriveStealthRecipientKey(keys: StealthMetaKeys, ephemeralPublicKey: Uint8Array, network: StealthNetwork, implementation?: X25519Implementation): Promise<StealthRecipientKey>;
export declare function deriveStealthRecipientPublicKey(keys: StealthViewingKeys, ephemeralPublicKey: Uint8Array, network: StealthNetwork, implementation?: X25519Implementation): Promise<Uint8Array>;
export declare function signWithEd25519Scalar(spendScalar: bigint, nonceKey: Uint8Array, message: Uint8Array): Uint8Array;
