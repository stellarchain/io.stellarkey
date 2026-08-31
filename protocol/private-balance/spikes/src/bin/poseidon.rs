use ark_bn254::Fr;
use ark_ff::{BigInteger, PrimeField};
use num_bigint::BigUint;
use soroban_poseidon::{Poseidon2Sponge, poseidon2_hash};
use soroban_sdk::{Bytes, BytesN, Env, U256, crypto::bn254::Bn254Fr, vec};

fn u256_to_hex(u: &U256) -> std::string::String {
    let bytes = u.to_be_bytes();
    let mut out = [0u8; 32];
    bytes.copy_into_slice(&mut out);
    hex::encode(out)
}

pub fn bytes_to_field_be(bytes: &[u8]) -> [u8; 32] {
    let bi = BigUint::from_bytes_be(bytes);
    let fr = Fr::from(bi);
    let raw = fr.into_bigint().to_bytes_be();
    let mut out = [0u8; 32];
    let offset = 32 - raw.len();
    out[offset..].copy_from_slice(&raw);
    out
}

fn main() {
    println!("Running Poseidon2 BN254 t=4 spike...");
    let env = Env::default();

    // 1. Empty input
    let empty_inputs = vec![&env];
    let h_empty = poseidon2_hash::<4, Bn254Fr>(&env, &empty_inputs);
    let h_empty_hex = u256_to_hex(&h_empty);
    println!("Poseidon2([]) = 0x{}", h_empty_hex);

    // 2. Single input [1]
    let single_input = vec![&env, U256::from_u32(&env, 1)];
    let h_single = poseidon2_hash::<4, Bn254Fr>(&env, &single_input);
    let h_single_hex = u256_to_hex(&h_single);
    println!("Poseidon2([1]) = 0x{}", h_single_hex);

    // 3. Three inputs [1, 2, 3] (full single rate block)
    let three_inputs = vec![
        &env,
        U256::from_u32(&env, 1),
        U256::from_u32(&env, 2),
        U256::from_u32(&env, 3),
    ];
    let h_three = poseidon2_hash::<4, Bn254Fr>(&env, &three_inputs);
    let h_three_hex = u256_to_hex(&h_three);
    println!("Poseidon2([1, 2, 3]) = 0x{}", h_three_hex);

    // 4. Four inputs [1, 2, 3, 4] (multi-round absorb: 3 then 1)
    let four_inputs = vec![
        &env,
        U256::from_u32(&env, 1),
        U256::from_u32(&env, 2),
        U256::from_u32(&env, 3),
        U256::from_u32(&env, 4),
    ];
    let h_four = poseidon2_hash::<4, Bn254Fr>(&env, &four_inputs);
    let h_four_hex = u256_to_hex(&h_four);
    println!("Poseidon2([1, 2, 3, 4]) = 0x{}", h_four_hex);

    // 5. Check Sponge instance matches top-level function
    let mut sponge = Poseidon2Sponge::<4, Bn254Fr>::new(&env);
    let h_sponge_four = sponge.compute_hash(&four_inputs);
    assert_eq!(h_four, h_sponge_four);
    println!("✓ Sponge matches top-level function");

    // 6. Check domain-separated hash: P2(domain, fields) = Poseidon2([domainField, ...fields])
    // Domain field for SKSB_MERKLE_NODE_V1: SHA-256("SKSB_MERKLE_NODE_V1") mod Fr
    let domain_bytes = sha2::Sha256::digest(b"SKSB_MERKLE_NODE_V1");
    let domain_field_bytes = bytes_to_field_be(&domain_bytes);
    let domain_bytes_sdk: Bytes = BytesN::from_array(&env, &domain_field_bytes).into();
    let domain_u256 = U256::from_be_bytes(&env, &domain_bytes_sdk);
    // Hash left=1, right=2
    let node_inputs = vec![
        &env,
        domain_u256,
        U256::from_u32(&env, 1),
        U256::from_u32(&env, 2),
    ];
    let h_node = sponge.compute_hash(&node_inputs);
    println!(
        "P2('SKSB_MERKLE_NODE_V1', [1, 2]) = 0x{}",
        u256_to_hex(&h_node)
    );

    println!("✓ Poseidon2 spike completed successfully!");
}

use sha2::Digest;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_poseidon_spike() {
        main();
    }
}
