import { type X25519Implementation } from './x25519.js';
export type StealthNetwork = 'testnet' | 'mainnet';
export interface StealthMetaAddress {
    scanPublicKey: Uint8Array;
    spendPublicKey: Uint8Array;
}
export interface StealthMetaKeys extends StealthMetaAddress {
    scanPrivateKey: Uint8Array;
    spendScalar: bigint;
    nonceKey: Uint8Array;
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
export declare const STEALTH_META_ADDRESS_PAYLOAD_BYTES = 64;
export declare const STEALTH_META_ADDRESS_ASCII_BYTES = 113;
export declare function deriveStealthRootKey(privacySessionRoot: Uint8Array): Uint8Array;
export declare function deriveStealthMetaKeys(rootKey: Uint8Array, network: StealthNetwork): StealthMetaKeys;
export declare function encodeStealthMetaAddress(address: StealthMetaAddress, network: StealthNetwork): string;
export declare function decodeStealthMetaAddress(encoded: string, network: StealthNetwork): Promise<StealthMetaAddress>;
export declare function groupStealthMetaAddress(address: string): string;
export declare function deriveStealthRecipient(address: StealthMetaAddress, ephemeralPrivateKey: Uint8Array, network: StealthNetwork, implementation?: X25519Implementation): Promise<StealthRecipient>;
export declare function deriveStealthRecipientKey(keys: StealthMetaKeys, ephemeralPublicKey: Uint8Array, network: StealthNetwork, implementation?: X25519Implementation): Promise<StealthRecipientKey>;
export declare function signWithEd25519Scalar(spendScalar: bigint, nonceKey: Uint8Array, message: Uint8Array): Uint8Array;
