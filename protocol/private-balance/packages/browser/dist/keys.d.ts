export declare const DOMAIN_ROOT = "SKSB_ROOT_V1";
export declare const DOMAIN_ASK = "SKSB_ASK_V1";
export declare const DOMAIN_NK = "SKSB_NK_V1";
export declare const DOMAIN_HPKE_IKM = "SKSB_HPKE_IKM_V1";
export declare const DOMAIN_OWNER = "SKSB_OWNER_V1";
export declare const DOMAIN_DIVERSIFIED_OWNER = "SKSB_DIVERSIFIED_OWNER_V2";
export declare const DOMAIN_ADDRESS_KEY = "SKSB_ADDRESS_KEY_V2";
export declare const DOMAIN_STORAGE_KEY = "SKSB_STORAGE_KEY_V1";
export interface ExpandedSpendingKey {
    ask: Uint8Array;
    nk: Uint8Array;
    baseOwnerCommitment: Uint8Array;
    ownerCommitment: Uint8Array;
    hpkePrivateKey: Uint8Array;
    hpkePublicKey: Uint8Array;
}
export interface FullViewingKey {
    baseOwnerCommitment: Uint8Array;
    ownerCommitment: Uint8Array;
    nk: Uint8Array;
    hpkePrivateKey: Uint8Array;
    hpkePublicKey: Uint8Array;
}
export interface DiversifiedAddressKeys {
    diversifier: Uint8Array;
    ownerCommitment: Uint8Array;
    hpkePrivateKey: Uint8Array;
    hpkePublicKey: Uint8Array;
}
export declare function deriveDiversifiedAddressKeys(baseOwnerCommitment: Uint8Array, incomingViewingKey: Uint8Array, diversifier: Uint8Array): Promise<DiversifiedAddressKeys>;
export declare function derivePrivacySessionRoot(rawStellarSeed: Uint8Array, protocolVersion: number, networkId: Uint8Array, realmId: Uint8Array, poolId: Uint8Array, accountPublicKeyBytes: Uint8Array): Uint8Array;
export declare function derivePrivateStorageKey(privacySessionRoot: Uint8Array, deploymentBindingHash: Uint8Array): Uint8Array;
export declare function deriveExpandedSpendingKey(privacySessionRoot: Uint8Array, protocolVersion: number, networkId: Uint8Array, realmId: Uint8Array, poolId: Uint8Array, accountPublicKeyBytes: Uint8Array, contextField: Uint8Array): Promise<ExpandedSpendingKey>;
export declare function deriveKeysFromSeed(rawStellarSeed: Uint8Array, protocolVersion: number, networkId: Uint8Array, realmId: Uint8Array, poolId: Uint8Array, accountPublicKeyBytes: Uint8Array, contextField: Uint8Array): Promise<ExpandedSpendingKey>;
export declare function toViewingKey(esk: ExpandedSpendingKey): FullViewingKey;
