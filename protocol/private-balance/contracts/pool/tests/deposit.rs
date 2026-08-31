mod common;

use common::{MockNativeTokenClient, register_pool};
use private_balance_pool::{DepositAction, OutputPackage, PrivateBalancePoolClient};
use private_balance_verifier::types::ProofBytes;
use serde::Deserialize;
use soroban_sdk::{BytesN, Env, address_payload::AddressPayload};
use std::fs;

#[derive(Deserialize)]
struct ProofVectorFile {
    proofs: std::vec::Vec<ProofVectorItem>,
}

#[derive(Deserialize)]
struct ProofVectorItem {
    #[serde(rename = "name")]
    _name: std::string::String,
    #[serde(rename = "publicSignals")]
    public_signals: std::vec::Vec<std::string::String>,
    proof: SnarkJsProof,
}

#[derive(Deserialize)]
struct SnarkJsProof {
    pi_a: std::vec::Vec<std::string::String>,
    pi_b: std::vec::Vec<std::vec::Vec<std::string::String>>,
    pi_c: std::vec::Vec<std::string::String>,
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
fn test_pool_initialization_and_deposit() {
    let env = Env::default();
    env.mock_all_auths();

    let fixture = register_pool(&env);
    let token_client = MockNativeTokenClient::new(&env, &fixture.asset);
    let pool_client = PrivateBalancePoolClient::new(&env, &fixture.pool_id);
    let user = AddressPayload::AccountIdPublicKeyEd25519(BytesN::from_array(&env, &[4; 32]))
        .to_address(&env);

    // Mint tokens to user
    token_client.mint(&user, &10_000_000);

    // Read proof vectors
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../vectors/proofs-v1.json");
    let json_str = fs::read_to_string(path).expect("read proofs-v1.json");
    let file: ProofVectorFile = serde_json::from_str(&json_str).expect("parse proofs-v1.json");
    let dep_item = &file.proofs[0]; // deposit_5000000

    let proof_bytes = proof_from_snarkjs(&dep_item.proof);
    let proof = proof_bytes.to_contract_proof(&env);

    let ctx_bytes = field_str_to_bytes(&dep_item.public_signals[0]);
    let out_cm0_bytes = field_str_to_bytes(&dep_item.public_signals[11]);

    let context_field = BytesN::from_array(&env, &ctx_bytes);
    let out_cm0 = BytesN::from_array(&env, &out_cm0_bytes);

    let config = pool_client.config();
    assert_eq!(config.protocol_version, 1);
    assert_eq!(config.context_field, context_field);
    assert!(!pool_client.deposits_paused());

    let action = DepositAction {
        asset: fixture.asset.clone(),
        action_nonce: BytesN::from_array(&env, &[0x11; 32]),
        anchor_root: BytesN::from_array(&env, &[0; 32]),
        nullifier_0: BytesN::from_array(&env, &[0; 32]),
        nullifier_1: BytesN::from_array(&env, &[0; 32]),
        output_0: OutputPackage {
            commitment: out_cm0,
            recipient_envelope: BytesN::from_array(&env, &[0xaa; 181]),
        },
        output_1: OutputPackage::dummy(&env),
        public_value: 5_000_000,
        deposit_source: user.clone(),
    };

    let mut tampered = action.clone();
    tampered.output_0.recipient_envelope = BytesN::from_array(&env, &[0xab; 181]);
    assert!(
        pool_client.try_deposit(&tampered, &proof).is_err(),
        "the proof must bind the complete output package",
    );
    assert_eq!(token_client.balance(&user), 10_000_000);
    assert_eq!(pool_client.archive_meta().action_count, 0);
    assert_eq!(pool_client.tree_state().next_index, 0);

    let mut malformed_dummy = action.clone();
    malformed_dummy.output_1.recipient_envelope = BytesN::from_array(&env, &[1; 181]);
    assert!(
        pool_client.try_deposit(&malformed_dummy, &proof).is_err(),
        "a zero commitment cannot carry nonzero package bytes",
    );

    // Deposit 5,000,000 stroops
    let action_index = pool_client.deposit(&action, &proof);

    assert_eq!(action_index, 0);

    // Verify token balances
    assert_eq!(token_client.balance(&user), 5_000_000);
    assert_eq!(token_client.balance(&fixture.pool_id), 5_000_000);

    // Verify archive meta and tree
    let meta = pool_client.archive_meta();
    assert_eq!(meta.action_count, 1);
    assert_ne!(meta.transcript_head.to_array(), [0; 32]);

    let tree = pool_client.tree_state();
    assert_eq!(tree.next_index, 2);
    assert!(env.as_contract(&fixture.pool_id, || {
        private_balance_pool::storage::known_root(&env, &tree.current_root).is_ok()
    }));
}
