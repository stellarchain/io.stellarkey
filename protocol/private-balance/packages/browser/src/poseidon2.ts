import {
  BN254_FR_MODULUS,
  bigintTo32Bytes,
  bytesToBigint,
  bytesToField,
} from './field.js';
import { sha256Bytes, utf8 } from './hash.js';
import {
  POSEIDON2_DIAGONAL,
  POSEIDON2_ROUND_CONSTANTS,
} from './generated/poseidon2-parameters.js';

const RATE = 3;
const WIDTH = 4;
const FULL_ROUNDS_PER_SIDE = 4;
const PARTIAL_ROUNDS = 56;
const LENGTH_IV_FACTOR = 1n << 64n;
const PINNED_DOMAIN_FIELDS = new Map<string, string>([
  ['SKSB_OWNER_V1', '0e87c9065d3f311d9f01a6beb1d6eefd2a04031eca1b3dc2cb39e3aeab3b2164'],
  ['SKSB_NOTE_COMMITMENT_V1', '1b3495c2e4327e523884b0abfced14ee6d4057af8a09a62cfbf9e8b8be7c4492'],
  ['SKSB_NULLIFIER_V1', '29ade88c360e72d459bee62ca32d22de2c8eb235d802f58b46125971b92593ec'],
  ['SKSB_MERKLE_NODE_V1', '285ff678051587f58b4061d5cae6418f89d9e2dcfeda99a8f3aaf4faa5370e28'],
  ['SKSB_ACTION_BINDING_V1', '2664569923168068021216d9a9aa3d72fe2631dde8b61115af1a6865a31f5040'],
]);
const domainFieldCache = new Map<string, Uint8Array>();

function mod(value: bigint): bigint {
  const reduced = value % BN254_FR_MODULUS;
  return reduced >= 0n ? reduced : reduced + BN254_FR_MODULUS;
}

function sbox5(value: bigint): bigint {
  const squared = mod(value * value);
  return mod(squared * squared * value);
}

function externalMatrix(state: readonly bigint[]): bigint[] {
  const t0 = mod(state[0] + state[1]);
  const t1 = mod(state[2] + state[3]);
  const t2 = mod(2n * state[1] + t1);
  const t3 = mod(2n * state[3] + t0);
  const t4 = mod(4n * t1 + t3);
  const t5 = mod(4n * t0 + t2);
  return [mod(t3 + t5), t5, mod(t2 + t4), t4];
}

function internalMatrix(state: readonly bigint[]): bigint[] {
  const sum = mod(state[0] + state[1] + state[2] + state[3]);
  return state.map((value, index) => mod(value * POSEIDON2_DIAGONAL[index] + sum));
}

function permutation(input: readonly bigint[]): bigint[] {
  let state = externalMatrix(input.map(mod));

  for (let round = 0; round < FULL_ROUNDS_PER_SIDE; round += 1) {
    state = externalMatrix(
      state.map((value, index) => sbox5(value + POSEIDON2_ROUND_CONSTANTS[round * WIDTH + index])),
    );
  }

  for (let partial = 0; partial < PARTIAL_ROUNDS; partial += 1) {
    const round = FULL_ROUNDS_PER_SIDE + partial;
    state[0] = sbox5(state[0] + POSEIDON2_ROUND_CONSTANTS[round * WIDTH]);
    state = internalMatrix(state);
  }

  for (let finalRound = 0; finalRound < FULL_ROUNDS_PER_SIDE; finalRound += 1) {
    const round = FULL_ROUNDS_PER_SIDE + PARTIAL_ROUNDS + finalRound;
    state = externalMatrix(
      state.map((value, index) => sbox5(value + POSEIDON2_ROUND_CONSTANTS[round * WIDTH + index])),
    );
  }

  return state;
}

export function poseidon2Hash(inputs: readonly bigint[]): bigint {
  for (const input of inputs) {
    if (input < 0n || input >= BN254_FR_MODULUS) {
      throw new Error('Poseidon2 input is not a canonical BN254 field element');
    }
  }

  let state = [0n, 0n, 0n, BigInt(inputs.length) * LENGTH_IV_FACTOR];
  const blockCount = Math.max(1, Math.ceil(inputs.length / RATE));
  for (let block = 0; block < blockCount; block += 1) {
    for (let rateIndex = 0; rateIndex < RATE; rateIndex += 1) {
      const inputIndex = block * RATE + rateIndex;
      if (inputIndex < inputs.length) state[rateIndex] = mod(state[rateIndex] + inputs[inputIndex]);
    }
    state = permutation(state);
  }
  return state[0];
}

export function poseidonDomainField(domain: string): Uint8Array {
  if (!/^[\x20-\x7e]+$/.test(domain)) {
    throw new Error('Poseidon2 domain must be nonempty ASCII');
  }
  let field = domainFieldCache.get(domain);
  if (!field) {
    const pinned = PINNED_DOMAIN_FIELDS.get(domain);
    field = pinned
      ? Uint8Array.from(pinned.match(/../g) ?? [], byte => Number.parseInt(byte, 16))
      : bytesToField(sha256Bytes(utf8(domain)));
    domainFieldCache.set(domain, field);
  }
  return field.slice();
}

export function p2(domain: string, inputs: readonly Uint8Array[]): Uint8Array {
  const domainBigint = bytesToBigint(poseidonDomainField(domain));
  const inputBigints = [domainBigint, ...inputs.map(bytesToBigint)];

  const out = poseidon2Hash(inputBigints);
  return bigintTo32Bytes(out);
}
