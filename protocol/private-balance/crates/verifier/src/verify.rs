use crate::types::{Proof, ProofBytes, VerificationKey};
use crate::vk::get_embedded_vk;
use num_bigint::BigUint;
use private_balance_protocol::field::is_canonical_field;
use soroban_sdk::{
    BytesN, Env,
    crypto::bn254::{Bn254Fr, Bn254G1Affine, Bn254G2Affine},
    vec,
};

const BN254_FQ_MODULUS_STR: &str =
    "21888242871839275222246405745257275088696311157297823662689037894645226208583";

fn negate_g1_y(y_bytes: &[u8; 32]) -> Result<[u8; 32], &'static str> {
    let q = BigUint::parse_bytes(BN254_FQ_MODULUS_STR.as_bytes(), 10).unwrap();
    let y = BigUint::from_bytes_be(y_bytes);
    if y >= q {
        return Err("Y coordinate not canonical in base field Fq");
    }
    if y == BigUint::from(0u32) {
        return Ok([0u8; 32]);
    }
    let neg_y = q - y;
    let neg_bytes = neg_y.to_bytes_be();
    let mut out = [0u8; 32];
    out[32 - neg_bytes.len()..].copy_from_slice(&neg_bytes);
    Ok(out)
}

pub fn verify_groth16_proof(
    env: &Env,
    proof: &Proof,
    public_signals: &[[u8; 32]; 13],
) -> Result<bool, &'static str> {
    let vk = get_embedded_vk();
    verify_groth16_proof_with_vk(env, &vk, proof, public_signals)
}

pub fn verify_groth16_proof_bytes(
    env: &Env,
    proof: &ProofBytes,
    public_signals: &[[u8; 32]; 13],
) -> Result<bool, &'static str> {
    let vk = get_embedded_vk();
    let contract_proof = proof.to_contract_proof(env);
    verify_groth16_proof_with_vk(env, &vk, &contract_proof, public_signals)
}

pub fn verify_groth16_proof_with_vk(
    env: &Env,
    vk: &VerificationKey,
    proof: &Proof,
    public_signals: &[[u8; 32]; 13],
) -> Result<bool, &'static str> {
    // 1. Validate public signals are canonical Fr elements
    for signal in public_signals.iter() {
        if !is_canonical_field(signal) {
            return Err("Public signal exceeds scalar field modulus");
        }
    }

    let bn254 = env.crypto().bn254();

    // 2. Compute Linear Combination K = IC[0] + sum signal[i-1] * IC[i].
    let ic0_affine = Bn254G1Affine::from_array(env, &vk.gamma_abc[0]);
    let mut k_acc = ic0_affine;

    for (i, public_signal) in public_signals.iter().enumerate() {
        let signal_fr = Bn254Fr::from_bytes(BytesN::from_array(env, public_signal));
        let ic_i_affine = Bn254G1Affine::from_array(env, &vk.gamma_abc[i + 1]);
        let term = bn254.g1_mul(&ic_i_affine, &signal_fr);
        k_acc = bn254.g1_add(&k_acc, &term);
    }

    // 3. Negate Proof A point: (-A.x, -A.y) -> (A.x, -A.y)
    let a_bytes = proof.a.to_array();
    let mut neg_a = [0u8; 64];
    neg_a[0..32].copy_from_slice(&a_bytes[0..32]);
    let mut a_y = [0u8; 32];
    a_y.copy_from_slice(&a_bytes[32..64]);
    let neg_y = negate_g1_y(&a_y)?;
    neg_a[32..64].copy_from_slice(&neg_y);

    let neg_a_g1 = Bn254G1Affine::from_array(env, &neg_a);
    let alpha_g1 = Bn254G1Affine::from_array(env, &vk.alpha_g1);
    let c_g1 = Bn254G1Affine::from_bytes(proof.c.clone());

    let b_g2 = Bn254G2Affine::from_bytes(proof.b.clone());
    let beta_g2 = Bn254G2Affine::from_array(env, &vk.beta_g2);
    let gamma_g2 = Bn254G2Affine::from_array(env, &vk.gamma_g2);
    let delta_g2 = Bn254G2Affine::from_array(env, &vk.delta_g2);

    // 4. Perform 4-point multi-pairing check
    let g1_vec = vec![env, neg_a_g1, alpha_g1, k_acc, c_g1];
    let g2_vec = vec![env, b_g2, beta_g2, gamma_g2, delta_g2];

    let result = bn254.pairing_check(g1_vec, g2_vec);
    Ok(result)
}
