import { NotePlaintext } from './note.js';
export declare const RECIPIENT_ENVELOPE_BYTES = 181;
export declare const OUTPUT_PACKAGE_BYTES = 213;
export declare function createOutputPackage(recipientHpkePk: Uint8Array, diversifier: Uint8Array, noteBytes: Uint8Array, contextHash: Uint8Array, cm: Uint8Array, actionNonce: Uint8Array, outputIndex: number): Promise<{
    recipientEnvelope: Uint8Array;
    outputPackage: Uint8Array;
}>;
export declare function openRecipientEnvelope(recipientHpkeSk: Uint8Array, recipientEnvelope: Uint8Array, contextHash: Uint8Array, contextField: Uint8Array, assetField: Uint8Array, cm: Uint8Array, actionNonce: Uint8Array, outputIndex: number, baseOwnerCommitment: Uint8Array): Promise<NotePlaintext | null>;
