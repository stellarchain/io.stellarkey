use crate::types::{Proof, ProofBytes, VerificationKey};
use crate::vk::get_embedded_vk;
use private_balance_protocol::field::is_canonical_field;
use soroban_sdk::{
    BytesN, Env, Vec,
    crypto::bn254::{Bn254Fr, Bn254G1Affine, Bn254G2Affine},
    vec,
};

const BN254_FQ_MODULUS_BYTES: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x97, 0x81, 0x6a, 0x91, 0x68, 0x71, 0xca, 0x8d, 0x3c, 0x20, 0x8c, 0x16, 0xd8, 0x7c, 0xfd, 0x47,
];

fn negate_g1_y(y_bytes: &[u8; 32]) -> Result<[u8; 32], &'static str> {
    if y_bytes >= &BN254_FQ_MODULUS_BYTES {
        return Err("Y coordinate not canonical in base field Fq");
    }
    if y_bytes == &[0u8; 32] {
        return Ok([0u8; 32]);
    }
    let mut output = BN254_FQ_MODULUS_BYTES;
    let mut borrow = 0i16;
    for index in (0..32).rev() {
        let difference = i16::from(output[index]) - i16::from(y_bytes[index]) - borrow;
        if difference < 0 {
            output[index] = (difference + 256) as u8;
            borrow = 1;
        } else {
            output[index] = difference as u8;
            borrow = 0;
        }
    }
    debug_assert_eq!(borrow, 0);
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    use num_bigint::BigUint;
    use rand::{RngCore, SeedableRng, rngs::StdRng};

    #[test]
    fn g1_negation_matches_biguint_reference() {
        let modulus = BigUint::from_bytes_be(&BN254_FQ_MODULUS_BYTES);
        let mut rng = StdRng::seed_from_u64(0x424e_3235_3447_31);
        for _ in 0..10_000 {
            let mut candidate = [0u8; 32];
            rng.fill_bytes(&mut candidate);
            let y = BigUint::from_bytes_be(&candidate) % &modulus;
            let raw = y.to_bytes_be();
            candidate = [0u8; 32];
            candidate[32 - raw.len()..].copy_from_slice(&raw);

            let expected = if y == BigUint::from(0u32) {
                [0u8; 32]
            } else {
                let raw = (&modulus - y).to_bytes_be();
                let mut output = [0u8; 32];
                output[32 - raw.len()..].copy_from_slice(&raw);
                output
            };
            assert_eq!(negate_g1_y(&candidate).unwrap(), expected);
        }
        assert!(negate_g1_y(&[0xff; 32]).is_err());
    }
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
    let mut points = Vec::new(env);
    let mut scalars = Vec::new(env);
    for (i, public_signal) in public_signals.iter().enumerate() {
        points.push_back(Bn254G1Affine::from_array(env, &vk.gamma_abc[i + 1]));
        scalars.push_back(Bn254Fr::from_bytes(BytesN::from_array(env, public_signal)));
    }
    let terms = bn254.g1_msm(points, scalars);
    let k_acc = bn254.g1_add(&ic0_affine, &terms);

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
