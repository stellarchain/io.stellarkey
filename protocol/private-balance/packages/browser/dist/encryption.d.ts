import { NotePlaintext } from './note.js';
export declare const RECIPIENT_ENVELOPE_BYTES = 181;
export declare const OUTPUT_PACKAGE_BYTES = 213;
export declare const OUTGOING_ENVELOPE_BYTES = 157;
export declare const OUTGOING_NONCE_BYTES = 12;
export declare function sealOutgoingEnvelope(outgoingViewingKey: Uint8Array, ephemeralPublicKey: Uint8Array, plaintext: Uint8Array, aad: Uint8Array, nonce: Uint8Array): Promise<Uint8Array>;
export declare function openOutgoingEnvelope(outgoingViewingKey: Uint8Array, ephemeralPublicKey: Uint8Array, envelope: Uint8Array, aad: Uint8Array): Promise<Uint8Array | null>;
export declare function createOutputPackage(recipientHpkePk: Uint8Array, diversifier: Uint8Array, noteBytes: Uint8Array, contextHash: Uint8Array, cm: Uint8Array, actionNonce: Uint8Array, outputIndex: number): Promise<{
    recipientEnvelope: Uint8Array;
    outputPackage: Uint8Array;
}>;
export declare function openRecipientEnvelope(recipientHpkeSk: Uint8Array, recipientEnvelope: Uint8Array, contextHash: Uint8Array, contextField: Uint8Array, assetField: Uint8Array, cm: Uint8Array, actionNonce: Uint8Array, outputIndex: number, baseOwnerCommitment: Uint8Array): Promise<NotePlaintext | null>;
