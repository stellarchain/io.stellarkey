use private_balance_protocol::poseidon2::{p2, poseidon2_hash};
use soroban_poseidon::poseidon2_hash as soroban_p2_hash;
use soroban_sdk::{Env, U256, crypto::bn254::Bn254Fr, vec};

#[test]
fn test_poseidon2_parity_with_soroban_sdk() {
    let env = Env::default();

    // 1. Empty
    let empty: [[u8; 32]; 0] = [];
    let h_rust = poseidon2_hash(&empty);
    let h_soroban = soroban_p2_hash::<4, Bn254Fr>(&env, &vec![&env]);
    let mut soroban_bytes = [0u8; 32];
    h_soroban.to_be_bytes().copy_into_slice(&mut soroban_bytes);
    assert_eq!(h_rust, soroban_bytes, "Empty input hash mismatch");

    // 2. Single [1]
    let mut one = [0u8; 32];
    one[31] = 1;
    let h_rust_1 = poseidon2_hash(&[one]);
    let h_soroban_1 = soroban_p2_hash::<4, Bn254Fr>(&env, &vec![&env, U256::from_u32(&env, 1)]);
    h_soroban_1
        .to_be_bytes()
        .copy_into_slice(&mut soroban_bytes);
    assert_eq!(h_rust_1, soroban_bytes, "Single input hash mismatch");

    // 3. Three elements [1, 2, 3]
    let mut two = [0u8; 32];
    two[31] = 2;
    let mut three = [0u8; 32];
    three[31] = 3;
    let h_rust_3 = poseidon2_hash(&[one, two, three]);
    let h_soroban_3 = soroban_p2_hash::<4, Bn254Fr>(
        &env,
        &vec![
            &env,
            U256::from_u32(&env, 1),
            U256::from_u32(&env, 2),
            U256::from_u32(&env, 3),
        ],
    );
    h_soroban_3
        .to_be_bytes()
        .copy_into_slice(&mut soroban_bytes);
    assert_eq!(h_rust_3, soroban_bytes, "Three input hash mismatch");

    // 4. Four elements [1, 2, 3, 4] (multi-round)
    let mut four = [0u8; 32];
    four[31] = 4;
    let h_rust_4 = poseidon2_hash(&[one, two, three, four]);
    let h_soroban_4 = soroban_p2_hash::<4, Bn254Fr>(
        &env,
        &vec![
            &env,
            U256::from_u32(&env, 1),
            U256::from_u32(&env, 2),
            U256::from_u32(&env, 3),
            U256::from_u32(&env, 4),
        ],
    );
    h_soroban_4
        .to_be_bytes()
        .copy_into_slice(&mut soroban_bytes);
    assert_eq!(h_rust_4, soroban_bytes, "Four input hash mismatch");
}

#[test]
fn test_domain_separated_p2() {
    let mut a = [0u8; 32];
    a[31] = 10;
    let mut b = [0u8; 32];
    b[31] = 20;
    let h = p2("SKSB_MERKLE_NODE_V1", &[a, b]);
    assert_ne!(h, [0u8; 32]);
}
