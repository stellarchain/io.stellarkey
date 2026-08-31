use crate::field::{bytes_to_field, is_canonical_field};
use alloc::vec::Vec;
use sha2::{Digest, Sha256};
use soroban_poseidon::poseidon2_hash as soroban_p2_hash;
use soroban_sdk::{Bytes, BytesN, Env, U256, crypto::bn254::Bn254Fr, vec};

use crate::constants::{
    DOMAIN_ACTION_BINDING, DOMAIN_MERKLE_NODE, DOMAIN_NOTE_COMMITMENT, DOMAIN_NULLIFIER,
    DOMAIN_OWNER,
};

pub const WIDTH: usize = 4;
pub const RATE: usize = 3;
pub const FULL_ROUNDS: usize = 8;
pub const PARTIAL_ROUNDS: usize = 56;
pub const TOTAL_ROUNDS: usize = FULL_ROUNDS + PARTIAL_ROUNDS;

const fn field_words(high: u128, low: u128) -> [u8; 32] {
    let high_bytes = high.to_be_bytes();
    let low_bytes = low.to_be_bytes();
    let mut out = [0u8; 32];
    let mut index = 0;
    while index < 16 {
        out[index] = high_bytes[index];
        out[index + 16] = low_bytes[index];
        index += 1;
    }
    out
}

const OWNER_FIELD: [u8; 32] = field_words(
    0xe87c9065d3f311d9f01a6beb1d6eefd,
    0x2a04031eca1b3dc2cb39e3aeab3b2164,
);
const NOTE_COMMITMENT_FIELD: [u8; 32] = field_words(
    0x1b3495c2e4327e523884b0abfced14ee,
    0x6d4057af8a09a62cfbf9e8b8be7c4492,
);
const NULLIFIER_FIELD: [u8; 32] = field_words(
    0x29ade88c360e72d459bee62ca32d22de,
    0x2c8eb235d802f58b46125971b92593ec,
);
const MERKLE_NODE_FIELD: [u8; 32] = field_words(
    0x285ff678051587f58b4061d5cae6418f,
    0x89d9e2dcfeda99a8f3aaf4faa5370e28,
);
const ACTION_BINDING_FIELD: [u8; 32] = field_words(
    0x2664569923168068021216d9a9aa3d72,
    0xfe2631dde8b61115af1a6865a31f5040,
);

pub fn domain_field(domain: &str) -> [u8; 32] {
    match domain {
        DOMAIN_OWNER => OWNER_FIELD,
        DOMAIN_NOTE_COMMITMENT => NOTE_COMMITMENT_FIELD,
        DOMAIN_NULLIFIER => NULLIFIER_FIELD,
        DOMAIN_MERKLE_NODE => MERKLE_NODE_FIELD,
        DOMAIN_ACTION_BINDING => ACTION_BINDING_FIELD,
        _ => bytes_to_field(&Sha256::digest(domain.as_bytes())),
    }
}

pub fn poseidon2_hash(inputs: &[[u8; 32]]) -> [u8; 32] {
    let env = Env::default();
    let mut vec_inputs = vec![&env];
    for inp in inputs {
        assert!(is_canonical_field(inp), "input exceeds field modulus");
        let bytes_sdk: Bytes = BytesN::from_array(&env, inp).into();
        let u = U256::from_be_bytes(&env, &bytes_sdk);
        vec_inputs.push_back(u);
    }

    let result = soroban_p2_hash::<4, Bn254Fr>(&env, &vec_inputs);
    let mut out = [0u8; 32];
    result.to_be_bytes().copy_into_slice(&mut out);
    out
}

pub fn p2(domain: &str, fields: &[[u8; 32]]) -> [u8; 32] {
    let mut all_inputs = Vec::with_capacity(1 + fields.len());
    all_inputs.push(domain_field(domain));
    all_inputs.extend_from_slice(fields);
    poseidon2_hash(&all_inputs)
}
