use private_balance_verifier::types::ProofBytes;
use private_balance_verifier::verify::verify_groth16_proof_bytes;
use serde::Deserialize;
use soroban_sdk::Env;
use std::fs;

#[derive(Deserialize)]
struct ProofVectorFile {
    proofs: Vec<ProofVectorItem>,
}

#[derive(Deserialize)]
struct ProofVectorItem {
    #[serde(rename = "publicSignals")]
    public_signals: Vec<String>,
    proof: SnarkJsProof,
}

#[derive(Deserialize)]
struct SnarkJsProof {
    pi_a: Vec<String>,
    pi_b: Vec<Vec<String>>,
    pi_c: Vec<String>,
}

fn field_str_to_bytes(s: &str) -> [u8; 32] {
    let n = num_bigint::BigUint::parse_bytes(s.as_bytes(), 10).expect("valid decimal field");
    let be = n.to_bytes_be();
    let mut out = [0u8; 32];
    out[32 - be.len()..].copy_from_slice(&be);
    out
}

fn proof_from_snarkjs(p: &SnarkJsProof) -> ProofBytes {
    let ax = field_str_to_bytes(&p.pi_a[0]);
    let ay = field_str_to_bytes(&p.pi_a[1]);
    let mut a = [0u8; 64];
    a[0..32].copy_from_slice(&ax);
    a[32..64].copy_from_slice(&ay);

    let bx_c0 = field_str_to_bytes(&p.pi_b[0][0]);
    let bx_c1 = field_str_to_bytes(&p.pi_b[0][1]);
    let by_c0 = field_str_to_bytes(&p.pi_b[1][0]);
    let by_c1 = field_str_to_bytes(&p.pi_b[1][1]);

    let mut b = [0u8; 128];
    b[0..32].copy_from_slice(&bx_c1);
    b[32..64].copy_from_slice(&bx_c0);
    b[64..96].copy_from_slice(&by_c1);
    b[96..128].copy_from_slice(&by_c0);

    let cx = field_str_to_bytes(&p.pi_c[0]);
    let cy = field_str_to_bytes(&p.pi_c[1]);
    let mut c = [0u8; 64];
    c[0..32].copy_from_slice(&cx);
    c[32..64].copy_from_slice(&cy);

    ProofBytes { a, b, c }
}

#[test]
fn test_adversarial_mutated_public_signal() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../vectors/proofs-v1.json");
    let json_str = fs::read_to_string(path).expect("read proofs-v1.json");
    let file: ProofVectorFile = serde_json::from_str(&json_str).expect("parse proofs-v1.json");

    let env = Env::default();
    let item = &file.proofs[0];
    let proof = proof_from_snarkjs(&item.proof);

    for i in 0..13 {
        println!("Testing mutation on public signal index {}", i);
        let mut signals = [[0u8; 32]; 13];
        for (signal, value) in signals.iter_mut().zip(&item.public_signals) {
            *signal = field_str_to_bytes(value);
        }
        // Mutate signal i within canonical range
        signals[i][31] ^= 1;

        let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            verify_groth16_proof_bytes(&env, &proof, &signals)
        }));
        if let Ok(Ok(valid)) = res {
            assert!(!valid, "Mutated public signal {} must fail verification", i);
        }
    }
}

#[test]
fn test_adversarial_non_canonical_signal_rejection() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../vectors/proofs-v1.json");
    let json_str = fs::read_to_string(path).expect("read proofs-v1.json");
    let file: ProofVectorFile = serde_json::from_str(&json_str).expect("parse proofs-v1.json");

    let env = Env::default();
    let item = &file.proofs[0];
    let proof = proof_from_snarkjs(&item.proof);

    let mut signals = [[0u8; 32]; 13];
    for (signal, value) in signals.iter_mut().zip(&item.public_signals) {
        *signal = field_str_to_bytes(value);
    }

    // Set signal 0 to 0xFF...FF (non-canonical Fr)
    signals[0] = [0xff; 32];

    let result = verify_groth16_proof_bytes(&env, &proof, &signals);
    assert!(
        result.is_err(),
        "Non-canonical public signal must be rejected before host call"
    );
}

#[test]
fn test_adversarial_corrupted_proof_points() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../vectors/proofs-v1.json");
    let json_str = fs::read_to_string(path).expect("read proofs-v1.json");
    let file: ProofVectorFile = serde_json::from_str(&json_str).expect("parse proofs-v1.json");

    let env = Env::default();
    let item = &file.proofs[0];
    let mut proof = proof_from_snarkjs(&item.proof);

    let mut signals = [[0u8; 32]; 13];
    for (signal, value) in signals.iter_mut().zip(&item.public_signals) {
        *signal = field_str_to_bytes(value);
    }

    // Mutate point C
    proof.c[0] ^= 1;
    let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        verify_groth16_proof_bytes(&env, &proof, &signals)
    }));
    if let Ok(Ok(valid)) = res {
        assert!(!valid, "Corrupted point proof must not verify");
    }
}
