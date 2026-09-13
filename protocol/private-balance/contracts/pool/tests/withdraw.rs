mod common;

use common::{MockNativeTokenClient, register_pool};
use private_balance_pool::{
    AssetStatus, OutputPackage, PoolError, PrivateBalancePoolClient, WithdrawAction,
};
use private_balance_protocol::constants::ROOT_WINDOW_LEDGERS;
use private_balance_verifier::types::ProofBytes;
use serde::Deserialize;
use soroban_sdk::{BytesN, Env, address_payload::AddressPayload, testutils::Ledger as _};
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
fn test_pool_withdrawal() {
    let env = Env::default();
    env.mock_all_auths();

    let fixture = register_pool(&env);
    let token_client = MockNativeTokenClient::new(&env, &fixture.asset);
    let pool_client = PrivateBalancePoolClient::new(&env, &fixture.pool_id);
    let recipient = AddressPayload::AccountIdPublicKeyEd25519(BytesN::from_array(&env, &[5; 32]))
        .to_address(&env);

    // Read proofs-v1.json
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../vectors/proofs-v1.json");
    let json_str = fs::read_to_string(path).expect("read proofs-v1.json");
    let file: ProofVectorFile = serde_json::from_str(&json_str).expect("parse proofs-v1.json");
    let wd_item = &file.proofs[2]; // withdraw_7000000_from_10m_note

    let proof_bytes = proof_from_snarkjs(&wd_item.proof);
    let proof = proof_bytes.to_contract_proof(&env);

    let ctx_bytes = field_str_to_bytes(&wd_item.public_signals[0]);
    let anchor_root_bytes = field_str_to_bytes(&wd_item.public_signals[3]);
    let nf0_bytes = field_str_to_bytes(&wd_item.public_signals[6]);
    let nf1_bytes = field_str_to_bytes(&wd_item.public_signals[7]);
    let out_cm0_bytes = field_str_to_bytes(&wd_item.public_signals[8]);
    let out_cm1_bytes = field_str_to_bytes(&wd_item.public_signals[9]);
    let out_cm2_bytes = field_str_to_bytes(&wd_item.public_signals[10]);

    let context_field = BytesN::from_array(&env, &ctx_bytes);
    let anchor_root = BytesN::from_array(&env, &anchor_root_bytes);
    let nf0 = BytesN::from_array(&env, &nf0_bytes);
    let nf1 = BytesN::from_array(&env, &nf1_bytes);
    let out_cm0 = BytesN::from_array(&env, &out_cm0_bytes);
    let out_cm1 = BytesN::from_array(&env, &out_cm1_bytes);
    let out_cm2 = BytesN::from_array(&env, &out_cm2_bytes);

    assert_eq!(pool_client.config().context_field, context_field);

    // Start underfunded to prove a failed external token call rolls back all pool state.
    token_client.mint(&fixture.pool_id, &6_000_000);

    // Register anchor_root as known
    env.as_contract(&fixture.pool_id, || {
        private_balance_pool::storage::add_known_root(&env, &anchor_root, ROOT_WINDOW_LEDGERS)
            .unwrap();
    });

    let action = WithdrawAction {
        action_nonce: BytesN::from_array(&env, &[0x33; 32]),
        anchor_root,
        nullifier_0: nf0.clone(),
        nullifier_1: nf1,
        output_0: OutputPackage {
            commitment: out_cm0,
            recipient_envelope: BytesN::from_array(&env, &[0xdd; 181]),
            outgoing_envelope: BytesN::from_array(&env, &[0xde; 157]),
        },
        output_1: OutputPackage {
            commitment: out_cm1,
            recipient_envelope: BytesN::from_array(&env, &[0xdf; 181]),
            outgoing_envelope: BytesN::from_array(&env, &[0xe0; 157]),
        },
        output_2: OutputPackage {
            commitment: out_cm2,
            recipient_envelope: BytesN::from_array(&env, &[0xe1; 181]),
            outgoing_envelope: BytesN::from_array(&env, &[0xe2; 157]),
        },
        asset_index: 0,
        public_value: 7_000_000,
        public_recipient: recipient.clone(),
    };

    assert_eq!(token_client.balance(&recipient), 0);
    assert!(!env.as_contract(&fixture.pool_id, || {
        private_balance_pool::nullifier::is_spent(&env, &nf0)
    }));

    assert!(
        pool_client.try_withdraw(&action, &proof).is_err(),
        "underfunded token movement must fail atomically",
    );
    assert_eq!(token_client.balance(&recipient), 0);
    assert_eq!(token_client.balance(&fixture.pool_id), 6_000_000);
    assert!(!env.as_contract(&fixture.pool_id, || {
        private_balance_pool::nullifier::is_spent(&env, &nf0)
    }));
    assert_eq!(pool_client.archive_meta().action_count, 0);
    assert_eq!(pool_client.tree_state().next_index, 0);

    token_client.mint(&fixture.pool_id, &4_000_000);
    pool_client.set_asset_status(&0, &AssetStatus::ExitOnly);

    // Execute withdraw of 7,000,000 stroops
    let action_index = pool_client.withdraw(&action, &proof);

    assert_eq!(action_index, 0);
    assert_eq!(token_client.balance(&recipient), 7_000_000);
    assert_eq!(token_client.balance(&fixture.pool_id), 3_000_000);
    assert!(env.as_contract(&fixture.pool_id, || {
        private_balance_pool::nullifier::is_spent(&env, &nf0)
    }));
    assert_eq!(pool_client.tree_state().next_index, 3);
}

#[test]
fn paused_idle_pool_can_refresh_current_root_and_withdraw() {
    let env = Env::default();
    env.mock_all_auths();

    let fixture = register_pool(&env);
    let token_client = MockNativeTokenClient::new(&env, &fixture.asset);
    let pool_client = PrivateBalancePoolClient::new(&env, &fixture.pool_id);
    let recipient = AddressPayload::AccountIdPublicKeyEd25519(BytesN::from_array(&env, &[5; 32]))
        .to_address(&env);

    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../vectors/proofs-v1.json");
    let json_str = fs::read_to_string(path).expect("read proofs-v1.json");
    let file: ProofVectorFile = serde_json::from_str(&json_str).expect("parse proofs-v1.json");
    let wd_item = &file.proofs[2];
    let proof = proof_from_snarkjs(&wd_item.proof).to_contract_proof(&env);
    let anchor_root = BytesN::from_array(&env, &field_str_to_bytes(&wd_item.public_signals[3]));
    let nf0 = BytesN::from_array(&env, &field_str_to_bytes(&wd_item.public_signals[6]));
    let nf1 = BytesN::from_array(&env, &field_str_to_bytes(&wd_item.public_signals[7]));
    let out_cm0 = BytesN::from_array(&env, &field_str_to_bytes(&wd_item.public_signals[8]));
    let out_cm1 = BytesN::from_array(&env, &field_str_to_bytes(&wd_item.public_signals[9]));
    let out_cm2 = BytesN::from_array(&env, &field_str_to_bytes(&wd_item.public_signals[10]));
    let action = WithdrawAction {
        action_nonce: BytesN::from_array(&env, &[0x33; 32]),
        anchor_root: anchor_root.clone(),
        nullifier_0: nf0,
        nullifier_1: nf1,
        output_0: OutputPackage {
            commitment: out_cm0,
            recipient_envelope: BytesN::from_array(&env, &[0xdd; 181]),
            outgoing_envelope: BytesN::from_array(&env, &[0xde; 157]),
        },
        output_1: OutputPackage {
            commitment: out_cm1,
            recipient_envelope: BytesN::from_array(&env, &[0xdf; 181]),
            outgoing_envelope: BytesN::from_array(&env, &[0xe0; 157]),
        },
        output_2: OutputPackage {
            commitment: out_cm2,
            recipient_envelope: BytesN::from_array(&env, &[0xe1; 181]),
            outgoing_envelope: BytesN::from_array(&env, &[0xe2; 157]),
        },
        asset_index: 0,
        public_value: 7_000_000,
        public_recipient: recipient.clone(),
    };

    token_client.mint(&fixture.pool_id, &10_000_000);
    let anchored = env.as_contract(&fixture.pool_id, || {
        let mut tree = private_balance_pool::storage::get_tree(&env);
        tree.current_root = anchor_root;
        private_balance_pool::storage::set_tree(&env, &tree);
        private_balance_pool::storage::add_known_root(&env, &tree.current_root, ROOT_WINDOW_LEDGERS)
            .unwrap()
    });
    pool_client.set_deposits_paused(&true);
    env.ledger()
        .set_sequence_number(anchored.valid_until_ledger + 1);

    assert_eq!(
        env.as_contract(&fixture.pool_id, || {
            private_balance_pool::storage::known_root(&env, &action.anchor_root)
        }),
        Err(PoolError::RootExpired),
        "the setup must reproduce the expired current root",
    );
    let refreshed = pool_client.touch_root();
    assert!(
        env.auths().is_empty(),
        "root refresh must stay permissionless"
    );
    assert_eq!(refreshed.created_at_ledger, env.ledger().sequence());
    assert_eq!(
        refreshed.valid_until_ledger,
        env.ledger().sequence() + ROOT_WINDOW_LEDGERS,
    );
    assert_eq!(
        pool_client.touch_root(),
        refreshed,
        "same-ledger refresh is idempotent"
    );
    assert!(pool_client.deposits_paused());

    // Let even the explicit refresh expire. The value-moving action must
    // refresh the current root atomically instead of depending on a separate
    // transaction or an enabled deposit path.
    env.ledger()
        .set_sequence_number(refreshed.valid_until_ledger + 1);
    assert_eq!(pool_client.withdraw(&action, &proof), 0);
    assert_eq!(token_client.balance(&recipient), 7_000_000);
}

#[test]
fn full_input_exit_survives_saturation_and_shares_replay_protection() {
    use private_balance_protocol::constants::TREE_CAPACITY;
    use private_balance_pool::storage;
    let env = Env::default();
    env.mock_all_auths();
    let fixture = register_pool(&env);
    let pool = PrivateBalancePoolClient::new(&env, &fixture.pool_id);
    let token = MockNativeTokenClient::new(&env, &fixture.asset);
    let recipient = AddressPayload::AccountIdPublicKeyEd25519(BytesN::from_array(&env, &[5; 32])).to_address(&env);
    let vectors: ProofVectorFile = serde_json::from_str(&fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../../vectors/proofs-v1.json")).unwrap()).unwrap();
    let vector = &vectors.proofs[3];
    let field = |index: usize| BytesN::from_array(&env, &field_str_to_bytes(&vector.public_signals[index]));
    let action = WithdrawAction {
        action_nonce: BytesN::from_array(&env, &[0x44; 32]),
        anchor_root: field(3), nullifier_0: field(6), nullifier_1: field(7),
        output_0: OutputPackage { commitment: field(8), recipient_envelope: BytesN::from_array(&env, &[0xdd; 181]), outgoing_envelope: BytesN::from_array(&env, &[0xde; 157]) },
        output_1: OutputPackage { commitment: field(9), recipient_envelope: BytesN::from_array(&env, &[0xdf; 181]), outgoing_envelope: BytesN::from_array(&env, &[0xe0; 157]) },
        output_2: OutputPackage { commitment: field(10), recipient_envelope: BytesN::from_array(&env, &[0xe1; 181]), outgoing_envelope: BytesN::from_array(&env, &[0xe2; 157]) },
        asset_index: 0, public_value: 10_000_000, public_recipient: recipient.clone(),
    };
    let proof = proof_from_snarkjs(&vector.proof).to_contract_proof(&env);
    let normal_proof = proof_from_snarkjs(&vectors.proofs[2].proof).to_contract_proof(&env);
    env.as_contract(&fixture.pool_id, || {
        let mut tree = storage::get_tree(&env);
        tree.current_root = action.anchor_root.clone();
        tree.next_index = TREE_CAPACITY;
        storage::set_tree(&env, &tree);
        let mut meta = storage::get_meta(&env);
        meta.action_count = 1u128 << 100;
        storage::set_meta(&env, &meta);
    });
    pool.set_deposits_paused(&true);
    pool.set_asset_status(&0, &AssetStatus::ExitOnly);
    let full = pool.tree_state();
    let before_meta = pool.archive_meta();
    // A normal withdrawal proof cannot authorize the no-append mode.
    assert_eq!(pool.try_full_input_exit(&action, &normal_proof), Err(Ok(PoolError::InvalidProof)));
    assert_eq!(pool.try_withdraw(&action, &proof), Err(Ok(PoolError::TreeFull)));
    // Token failure must roll back the archive, nullifiers, and root renewal.
    assert!(pool.try_full_input_exit(&action, &proof).is_err());
    assert_eq!(pool.archive_meta(), before_meta);
    assert_eq!(pool.tree_state(), full);
    token.mint(&fixture.pool_id, &10_000_000);
    let index = pool.full_input_exit(&action, &proof);
    assert_eq!(index, 1u128 << 100);
    assert_eq!(pool.tree_state(), full);
    assert_eq!(pool.archive_meta().action_count, index + 1);
    assert_eq!(token.balance(&recipient), 10_000_000);
    let record = env.as_contract(&fixture.pool_id, || storage::get_archive_record(&env, index).unwrap());
    assert_eq!(record.starting_leaf_index, TREE_CAPACITY);
    assert_eq!(record.action_kind, 4);
    assert_eq!(pool.try_full_input_exit(&action, &proof), Err(Ok(PoolError::NullifierAlreadySpent)));
    assert_eq!(pool.try_withdraw(&action, &normal_proof), Err(Ok(PoolError::NullifierAlreadySpent)));
}
