mod common;

use common::{MockNativeTokenClient, register_pool};
use private_balance_pool::{
    OutputPackage, PrivateBalancePoolClient, SpentNullifier, TransferAction, storage::DataKey,
};
use private_balance_protocol::constants::ROOT_WINDOW_LEDGERS;
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
fn test_pool_private_transfer() {
    let env = Env::default();
    env.mock_all_auths();

    let fixture = register_pool(&env);
    let pool_client = PrivateBalancePoolClient::new(&env, &fixture.pool_id);
    let token_client = MockNativeTokenClient::new(&env, &fixture.asset);
    let relayer = AddressPayload::AccountIdPublicKeyEd25519(BytesN::from_array(&env, &[6; 32]))
        .to_address(&env);
    token_client.mint(&fixture.pool_id, &1_000);

    // Read proofs-v1.json
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../vectors/proofs-v1.json");
    let json_str = fs::read_to_string(path).expect("read proofs-v1.json");
    let file: ProofVectorFile = serde_json::from_str(&json_str).expect("parse proofs-v1.json");
    let tr_item = &file.proofs[1]; // transfer_10m_to_6m_and_4m

    let proof_bytes = proof_from_snarkjs(&tr_item.proof);
    let proof = proof_bytes.to_contract_proof(&env);

    let ctx_bytes = field_str_to_bytes(&tr_item.public_signals[0]);
    let anchor_root_bytes = field_str_to_bytes(&tr_item.public_signals[3]);
    let nf0_bytes = field_str_to_bytes(&tr_item.public_signals[9]);
    let out_cm0_bytes = field_str_to_bytes(&tr_item.public_signals[11]);
    let out_cm1_bytes = field_str_to_bytes(&tr_item.public_signals[12]);

    let context_field = BytesN::from_array(&env, &ctx_bytes);
    let anchor_root = BytesN::from_array(&env, &anchor_root_bytes);
    let nf0 = BytesN::from_array(&env, &nf0_bytes);
    let out_cm0 = BytesN::from_array(&env, &out_cm0_bytes);
    let out_cm1 = BytesN::from_array(&env, &out_cm1_bytes);

    assert_eq!(pool_client.config().context_field, context_field);

    // Register the anchor_root as a known historical root in pool storage for this test
    env.as_contract(&fixture.pool_id, || {
        private_balance_pool::storage::add_known_root(&env, &anchor_root, ROOT_WINDOW_LEDGERS)
            .unwrap();
    });

    let action = TransferAction {
        asset: fixture.asset.clone(),
        action_nonce: BytesN::from_array(&env, &[0x22; 32]),
        anchor_root,
        nullifier_0: nf0.clone(),
        nullifier_1: BytesN::from_array(&env, &[0; 32]),
        output_0: OutputPackage {
            commitment: out_cm0,
            recipient_envelope: BytesN::from_array(&env, &[0xbb; 181]),
        },
        output_1: OutputPackage {
            commitment: out_cm1,
            recipient_envelope: BytesN::from_array(&env, &[0xcc; 181]),
        },
        public_value: 0,
        relayer_fee: 1_000,
        relayer: relayer.clone(),
    };

    let mut duplicate_nullifier = action.clone();
    duplicate_nullifier.nullifier_1 = nf0.clone();
    assert!(
        pool_client
            .try_transfer(&duplicate_nullifier, &proof)
            .is_err(),
        "duplicate real nullifiers must fail before proof verification",
    );

    // First, verify nullifier is not spent
    assert!(!env.as_contract(&fixture.pool_id, || {
        private_balance_pool::nullifier::is_spent(&env, &nf0)
    }));

    // Execute transfer
    let action_index = pool_client.transfer(&action, &proof);

    assert_eq!(action_index, 0);
    assert_eq!(token_client.balance(&relayer), 1_000);
    assert_eq!(token_client.balance(&fixture.pool_id), 0);

    // Verify nullifier is now marked spent
    assert!(env.as_contract(&fixture.pool_id, || {
        private_balance_pool::nullifier::is_spent(&env, &nf0)
    }));
    let marker: SpentNullifier = env.as_contract(&fixture.pool_id, || {
        env.storage()
            .persistent()
            .get(&DataKey::Nullifier(nf0.clone()))
            .expect("spent nullifier marker")
    });
    assert_eq!(marker.spent_at_action, 0);
    assert_eq!(marker.spent_at_ledger, env.ledger().sequence());
    assert_eq!(pool_client.tree_state().next_index, 2);

    // Verify double spend attempt fails
    let res = pool_client.try_transfer(&action, &proof);
    assert!(res.is_err(), "Double spending same nullifier must fail!");
    assert_eq!(pool_client.archive_meta().action_count, 1);
    assert_eq!(pool_client.tree_state().next_index, 2);
}
