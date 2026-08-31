use private_balance_verifier::types::ProofBytes;
use private_balance_verifier::verify::verify_groth16_proof_bytes;
use private_balance_verifier::vk::get_embedded_vk_hash;
use serde::Deserialize;
use soroban_sdk::Env;
use std::fs;

#[derive(Deserialize)]
struct ProofVectorFile {
    proofs: Vec<ProofVectorItem>,
}

#[derive(Deserialize)]
struct ProofVectorItem {
    name: String,
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

    // SnarkJS pi_b is [[x.c0, x.c1], [y.c0, y.c1]]
    // Soroban CAP-0074 format is x.c1, x.c0, y.c1, y.c0
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
fn test_embedded_vk_hash() {
    let hash = get_embedded_vk_hash();
    assert_ne!(hash, [0u8; 32]);
    println!("Embedded VK Hash: {}", hex::encode(hash));
}

#[test]
fn test_verify_vectors() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../vectors/proofs-v1.json");
    let json_str = fs::read_to_string(path).expect("read proofs-v1.json");
    let file: ProofVectorFile = serde_json::from_str(&json_str).expect("parse proofs-v1.json");

    for item in file.proofs {
        println!("Testing proof vector: {}", item.name);
        let env = Env::default();
        env.cost_estimate().budget().reset_unlimited();

        assert_eq!(item.public_signals.len(), 13);
        let mut signals = [[0u8; 32]; 13];
        for (signal, value) in signals.iter_mut().zip(&item.public_signals) {
            *signal = field_str_to_bytes(value);
        }

        let proof = proof_from_snarkjs(&item.proof);
        let valid = verify_groth16_proof_bytes(&env, &proof, &signals).expect("verifier run");
        assert!(valid, "Proof must verify successfully in Soroban verifier!");
    }
}
