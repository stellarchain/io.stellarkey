export interface SnarkJsProof {
    pi_a: string[];
    pi_b: string[][];
    pi_c: string[];
    protocol: string;
    curve: string;
}
export interface ProofResult {
    proof: SnarkJsProof;
    publicSignals: string[];
    sorobanProofBytes: Uint8Array;
}
export declare function encodeProofForSoroban(proof: SnarkJsProof): Uint8Array;
export declare function proveAction(circuitInputs: any, wasmPathOrBuffer: string | Uint8Array, zkeyPathOrBuffer: string | Uint8Array): Promise<ProofResult>;
export declare function verifyProofLocally(vk: any, publicSignals: string[], proof: SnarkJsProof): Promise<boolean>;
