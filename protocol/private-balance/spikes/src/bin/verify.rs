use ark_bn254::{Bn254, Fr, G1Affine, G2Affine};
use ark_ec::AffineRepr;
use ark_ff::{BigInteger, PrimeField};
use ark_groth16::Groth16;
use ark_relations::gr1cs::{ConstraintSynthesizer, ConstraintSystemRef, SynthesisError};
use ark_relations::utils::linear_combination::LinearCombination;
use ark_snark::{CircuitSpecificSetupSNARK, SNARK};
use ark_std::rand::SeedableRng;
use ark_std::rand::rngs::StdRng;
use soroban_sdk::{
    BytesN, Env, Vec as SorobanVec,
    crypto::bn254::{Bn254Fr, Bn254G1Affine, Bn254G2Affine},
    vec,
};

/// A dummy prototype circuit with 10 public inputs representing the V1 action signals.
#[derive(Clone)]
struct PrototypeActionCircuit {
    pub public_signals: [Fr; 10],
    pub secret: Fr,
}

impl ConstraintSynthesizer<Fr> for PrototypeActionCircuit {
    fn generate_constraints(self, cs: ConstraintSystemRef<Fr>) -> Result<(), SynthesisError> {
        let mut pub_vars = std::vec::Vec::new();
        for s in self.public_signals.iter() {
            let v = cs.new_input_variable(|| Ok(*s))?;
            pub_vars.push(v);
        }
        let sec_var = cs.new_witness_variable(|| Ok(self.secret))?;
        let pub0 = pub_vars[0];
        cs.enforce_r1cs_constraint(
            move || LinearCombination::from(sec_var),
            move || LinearCombination::from(sec_var),
            move || LinearCombination::from(pub0),
        )?;
        Ok(())
    }
}

pub fn fr_to_bytes_be(f: &Fr) -> [u8; 32] {
    let mut bytes = [0u8; 32];
    let bi = f.into_bigint();
    let raw = bi.to_bytes_be();
    let offset = 32 - raw.len();
    bytes[offset..].copy_from_slice(&raw);
    bytes
}

pub fn g1_to_bytes_be(p: &G1Affine) -> [u8; 64] {
    let mut out = [0u8; 64];
    if p.is_zero() {
        return out;
    }
    let x = p.x.into_bigint().to_bytes_be();
    let y = p.y.into_bigint().to_bytes_be();
    out[32 - x.len()..32].copy_from_slice(&x);
    out[64 - y.len()..64].copy_from_slice(&y);
    out
}

pub fn g2_to_bytes_be(p: &G2Affine) -> [u8; 128] {
    let mut out = [0u8; 128];
    if p.is_zero() {
        return out;
    }
    // CAP-0074: X.c1, X.c0, Y.c1, Y.c0
    let xc1 = p.x.c1.into_bigint().to_bytes_be();
    let xc0 = p.x.c0.into_bigint().to_bytes_be();
    let yc1 = p.y.c1.into_bigint().to_bytes_be();
    let yc0 = p.y.c0.into_bigint().to_bytes_be();
    out[32 - xc1.len()..32].copy_from_slice(&xc1);
    out[64 - xc0.len()..64].copy_from_slice(&xc0);
    out[96 - yc1.len()..96].copy_from_slice(&yc1);
    out[128 - yc0.len()..128].copy_from_slice(&yc0);
    out
}

fn main() {
    println!("Running BN254 Groth16 verifier spike with Soroban host functions...");
    let mut rng = StdRng::seed_from_u64(0x42);
    let secret = Fr::from(7u64);
    let mut public_signals = [Fr::from(0u64); 10];
    public_signals[0] = secret * secret; // 49
    for (i, signal) in public_signals.iter_mut().enumerate().skip(1) {
        *signal = Fr::from(i as u64 + 100);
    }

    let circuit_setup = PrototypeActionCircuit {
        public_signals,
        secret,
    };

    let (pk, vk) = Groth16::<Bn254>::setup(circuit_setup.clone(), &mut rng).unwrap();
    let proof = Groth16::<Bn254>::prove(&pk, circuit_setup, &mut rng).unwrap();

    // Verify natively with Arkworks first
    let pvk = ark_groth16::prepare_verifying_key(&vk);
    let native_ok = Groth16::<Bn254>::verify_proof(&pvk, &proof, &public_signals).unwrap();
    assert!(native_ok, "Native Arkworks verification failed");
    println!("✓ Arkworks native verification passed");

    // Verify through Soroban host functions
    let env = Env::default();
    let bn254 = env.crypto().bn254();

    // Convert proof and VK to Soroban representation
    let proof_a_bytes = g1_to_bytes_be(&proof.a);
    let proof_b_bytes = g2_to_bytes_be(&proof.b);
    let proof_c_bytes = g1_to_bytes_be(&proof.c);

    let vk_alpha_bytes = g1_to_bytes_be(&vk.alpha_g1);
    let vk_beta_bytes = g2_to_bytes_be(&vk.beta_g2);
    let vk_gamma_bytes = g2_to_bytes_be(&vk.gamma_g2);
    let vk_delta_bytes = g2_to_bytes_be(&vk.delta_g2);

    let mut vk_ic: std::vec::Vec<Bn254G1Affine> = std::vec::Vec::new();
    for ic in vk.gamma_abc_g1.iter() {
        let b = g1_to_bytes_be(ic);
        vk_ic.push(Bn254G1Affine::from_array(&env, &b));
    }

    // Compute linear combination L = IC[0] + sum(public_signals[i] * IC[i+1])
    let mut acc = vk_ic[0].clone();
    for (i, s) in public_signals.iter().enumerate() {
        let s_bytes = fr_to_bytes_be(s);
        let scalar = Bn254Fr::from_bytes(BytesN::from_array(&env, &s_bytes));
        let ic_point = &vk_ic[i + 1];
        let term = bn254.g1_mul(ic_point, &scalar);
        acc = bn254.g1_add(&acc, &term);
    }

    // Prepare pairings: e(-A, B) * e(alpha, beta) * e(L, gamma) * e(C, delta) == 1
    // Negate proof.a in G1: (x, -y mod q)
    let proof_a = Bn254G1Affine::from_array(&env, &proof_a_bytes);
    let neg_a = -proof_a;

    let g1_vec: SorobanVec<Bn254G1Affine> = vec![
        &env,
        neg_a.clone(),
        Bn254G1Affine::from_array(&env, &vk_alpha_bytes),
        acc.clone(),
        Bn254G1Affine::from_array(&env, &proof_c_bytes),
    ];

    let g2_vec: SorobanVec<Bn254G2Affine> = vec![
        &env,
        Bn254G2Affine::from_array(&env, &proof_b_bytes),
        Bn254G2Affine::from_array(&env, &vk_beta_bytes),
        Bn254G2Affine::from_array(&env, &vk_gamma_bytes),
        Bn254G2Affine::from_array(&env, &vk_delta_bytes),
    ];

    let pairing_result = bn254.pairing_check(g1_vec, g2_vec);
    assert!(pairing_result, "Soroban host BN254 pairing check failed");
    println!("✓ Soroban host BN254 Groth16 verification passed!");

    // Test negative case (valid on-curve point mutation e.g. 2*C)
    let proof_c = Bn254G1Affine::from_array(&env, &proof_c_bytes);
    let bad_c_point = bn254.g1_add(&proof_c, &proof_c); // 2*C is on-curve but invalid proof
    let bad_g1_vec: SorobanVec<Bn254G1Affine> = vec![
        &env,
        neg_a,
        Bn254G1Affine::from_array(&env, &vk_alpha_bytes),
        acc,
        bad_c_point,
    ];

    let bad_g2_vec: SorobanVec<Bn254G2Affine> = vec![
        &env,
        Bn254G2Affine::from_array(&env, &proof_b_bytes),
        Bn254G2Affine::from_array(&env, &vk_beta_bytes),
        Bn254G2Affine::from_array(&env, &vk_gamma_bytes),
        Bn254G2Affine::from_array(&env, &vk_delta_bytes),
    ];

    let bad_result = bn254.pairing_check(bad_g1_vec, bad_g2_vec);
    assert!(
        !bad_result,
        "Mutated proof should fail verification (return false)"
    );
    println!("✓ Negative verification test passed!");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_verifier_spike() {
        main();
    }
}
