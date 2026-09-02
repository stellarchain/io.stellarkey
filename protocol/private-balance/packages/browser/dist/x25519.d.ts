export type X25519Implementation = 'auto' | 'native' | 'portable';
declare const x25519PrivateKeyHandleBrand: unique symbol;
export interface X25519PrivateKeyHandle {
    readonly [x25519PrivateKeyHandleBrand]: true;
}
export declare function encodeX25519PrivateKeyPkcs8(privateKey: Uint8Array): Uint8Array;
export declare function importX25519PrivateKey(privateKey: Uint8Array): Promise<X25519PrivateKeyHandle>;
export declare function deriveX25519SharedSecretFromHandle(handle: X25519PrivateKeyHandle, publicKey: Uint8Array): Promise<Uint8Array>;
export declare function deriveX25519PublicKeyFromHandle(handle: X25519PrivateKeyHandle): Promise<Uint8Array>;
export declare function deriveX25519PublicKey(privateKey: Uint8Array): Uint8Array;
export declare function deriveX25519SharedSecret(privateKey: Uint8Array, publicKey: Uint8Array, implementation?: X25519Implementation): Promise<Uint8Array>;
export {};
