// snarkjs does not publish TypeScript declarations for its browser bundle.
// @ts-expect-error -- runtime shape is validated before use below.
import * as snarkjs from 'snarkjs';

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
  sorobanProofBytes: Uint8Array; // 256 bytes
}

const BN254_BASE_MODULUS =
  21888242871839275222246405745257275088696311157297823662689037894645226208583n;

function fieldStrToBytes(s: string): Uint8Array {
  if (!/^(?:0|[1-9][0-9]*)$/.test(s)) throw new Error('Invalid proof field spelling');
  let n = BigInt(s);
  if (n >= BN254_BASE_MODULUS) throw new Error('Proof coordinate is outside BN254 Fq');
  const out = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return out;
}

export function encodeProofForSoroban(proof: SnarkJsProof): Uint8Array {
  if (proof.protocol !== 'groth16' || proof.curve !== 'bn128') {
    throw new Error('Only Groth16 proofs on bn128 are supported');
  }
  if (
    proof.pi_a.length !== 3 ||
    proof.pi_b.length !== 3 ||
    proof.pi_b.some((coordinate) => coordinate.length !== 2) ||
    proof.pi_c.length !== 3 ||
    proof.pi_a[2] !== '1' ||
    proof.pi_b[2][0] !== '1' ||
    proof.pi_b[2][1] !== '0' ||
    proof.pi_c[2] !== '1'
  ) {
    throw new Error('Malformed Groth16 proof points');
  }
  const ax = fieldStrToBytes(proof.pi_a[0]);
  const ay = fieldStrToBytes(proof.pi_a[1]);

  const bxC0 = fieldStrToBytes(proof.pi_b[0][0]);
  const bxC1 = fieldStrToBytes(proof.pi_b[0][1]);
  const byC0 = fieldStrToBytes(proof.pi_b[1][0]);
  const byC1 = fieldStrToBytes(proof.pi_b[1][1]);

  const cx = fieldStrToBytes(proof.pi_c[0]);
  const cy = fieldStrToBytes(proof.pi_c[1]);

  const out = new Uint8Array(256);
  // Point A (64 bytes)
  out.set(ax, 0);
  out.set(ay, 32);

  // Point B (128 bytes) - CAP-0074 Soroban format: x.c1, x.c0, y.c1, y.c0
  out.set(bxC1, 64);
  out.set(bxC0, 96);
  out.set(byC1, 128);
  out.set(byC0, 160);

  // Point C (64 bytes)
  out.set(cx, 192);
  out.set(cy, 224);

  return out;
}

export async function proveAction(
  circuitInputs: any,
  wasmPathOrBuffer: string | Uint8Array,
  zkeyPathOrBuffer: string | Uint8Array
): Promise<ProofResult> {
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    circuitInputs,
    wasmPathOrBuffer,
    zkeyPathOrBuffer
  );

  const sorobanProofBytes = encodeProofForSoroban(proof);

  return {
    proof,
    publicSignals,
    sorobanProofBytes,
  };
}

export async function verifyProofLocally(
  vk: any,
  publicSignals: string[],
  proof: SnarkJsProof
): Promise<boolean> {
  return snarkjs.groth16.verify(vk, publicSignals, proof);
}
