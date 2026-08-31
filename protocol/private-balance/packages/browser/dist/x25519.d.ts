export type X25519Implementation = 'auto' | 'native' | 'portable';
export declare function deriveX25519PublicKey(privateKey: Uint8Array): Uint8Array;
export declare function deriveX25519SharedSecret(privateKey: Uint8Array, publicKey: Uint8Array, implementation?: X25519Implementation): Promise<Uint8Array>;
